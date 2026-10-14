(function () {
  'use strict';

  // Status indicator color codes
  const COLORS = {
    READY_FOR_UPLOAD: 'transparent', // Transparent on initial load (invisible until file is dropped)
    PROCESSING:       '#ffbf00',     // Amber/Yellow: Uploading and querying Gemini (stays yellow during retries)
    READY_TO_COPY:    '#00ff00',     // Green: Response cached, click to copy
    COPIED:           '#00d4ff',     // Cyan/Blue: Successfully copied to clipboard
    ERROR:            '#ff0000'      // Red: Fatal error only
  };

  let cachedResponse = '';
  let isUploading = false;
  let currentColor = COLORS.READY_FOR_UPLOAD;
  let pixelSizes = [2, 5, 10];
  let currentSizeIndex = 0;

  // DOM Elements with inline styles using !important
  let pixel = null;
  let copyOverlay = null;
  let pdfFrame = null;

  function createElements() {
    // 1. Status Pixel
    if (!document.getElementById('status-pixel')) {
      pixel = document.createElement('div');
      pixel.id = 'status-pixel';
      pixel.setAttribute('aria-hidden', 'true');
      pixel.style.cssText = [
        'position: fixed !important',
        'top: 0px !important',
        'right: 0px !important',
        'width: ' + pixelSizes[currentSizeIndex] + 'px !important',
        'height: ' + pixelSizes[currentSizeIndex] + 'px !important',
        'background-color: ' + currentColor + ' !important',
        'margin: 0px !important',
        'padding: 0px !important',
        'border: none !important',
        'outline: none !important',
        'box-shadow: none !important',
        'transform: none !important',
        'opacity: 1 !important',
        'visibility: visible !important',
        'z-index: 2147483647 !important',
        'pointer-events: none !important',
        'transition: background-color 0.15s ease !important'
      ].join(';');
    } else {
      pixel = document.getElementById('status-pixel');
    }

    // 2. Invisible Copy Overlay
    if (!document.getElementById('copy-overlay')) {
      copyOverlay = document.createElement('div');
      copyOverlay.id = 'copy-overlay';
      copyOverlay.setAttribute('aria-hidden', 'true');
      copyOverlay.style.cssText = [
        'position: fixed !important',
        'top: 0px !important',
        'left: 0px !important',
        'right: 0px !important',
        'bottom: 0px !important',
        'width: 100vw !important',
        'height: 100vh !important',
        'margin: 0px !important',
        'padding: 0px !important',
        'border: none !important',
        'background: transparent !important',
        'cursor: default !important',
        'z-index: 2147483646 !important',
        'pointer-events: none !important'
      ].join(';');
    } else {
      copyOverlay = document.getElementById('copy-overlay');
    }

    // 3. Full-screen PDF Frame
    if (!document.getElementById('pdf-frame')) {
      pdfFrame = document.createElement('iframe');
      pdfFrame.id = 'pdf-frame';
      pdfFrame.title = 'PDF Document Viewer';
      pdfFrame.setAttribute('aria-hidden', 'true');
      pdfFrame.style.cssText = [
        'display: none',
        'position: fixed !important',
        'top: 0px !important',
        'left: 0px !important',
        'right: 0px !important',
        'bottom: 0px !important',
        'width: 100vw !important',
        'height: 100vh !important',
        'margin: 0px !important',
        'padding: 0px !important',
        'border: none !important',
        'z-index: 2147483640 !important',
        'background-color: #525659 !important'
      ].join(';');
    } else {
      pdfFrame = document.getElementById('pdf-frame');
    }

    // Mount to document.documentElement or document.body
    const targetRoot = document.body || document.documentElement;
    if (targetRoot) {
      if (!document.getElementById('status-pixel')) targetRoot.appendChild(pixel);
      if (!document.getElementById('copy-overlay')) targetRoot.appendChild(copyOverlay);
      if (!document.getElementById('pdf-frame')) targetRoot.appendChild(pdfFrame);
    }
  }

  // Ensure elements are created and mounted
  createElements();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createElements);
  }
  window.addEventListener('load', createElements);

  // Periodic safety check in case frameworks (React/Vue/Moodle) re-render body
  setInterval(createElements, 1000);

  function setStatus(color) {
    currentColor = color;
    if (pixel) {
      pixel.style.setProperty('background-color', color, 'important');
    }
  }

  // =========================================================================
  // CAPTURE-PHASE EVENT LISTENERS
  // (Using useCapture=true ensures our listeners run BEFORE any complex framework)
  // =========================================================================

  // Prevent browser's default file-opening navigation
  ['dragenter', 'dragover', 'dragleave'].forEach(eventName => {
    window.addEventListener(eventName, function (e) {
      e.preventDefault();
      e.stopPropagation();
    }, true);
  });

  // Temporarily disable iframe pointer events during drag so window catches drop
  window.addEventListener('dragenter', function () {
    if (pdfFrame && pdfFrame.style.display !== 'none') {
      pdfFrame.style.setProperty('pointer-events', 'none', 'important');
    }
  }, true);

  window.addEventListener('dragleave', function (e) {
    if (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
      if (pdfFrame && pdfFrame.style.display !== 'none') {
        pdfFrame.style.setProperty('pointer-events', 'auto', 'important');
      }
    }
  }, true);

  // Handle dropped files in capture phase
  window.addEventListener('drop', function (e) {
    e.preventDefault();
    e.stopPropagation();

    if (pdfFrame && pdfFrame.style.display !== 'none') {
      pdfFrame.style.setProperty('pointer-events', 'auto', 'important');
    }
    if (isUploading) return;

    const dt = e.dataTransfer;
    const files = dt ? dt.files : null;
    if (files && files.length > 0) {
      handleFile(files[0]);
    }
  }, true);

  // Handle pasted files (images, PDFs, screenshots via Ctrl+V)
  window.addEventListener('paste', function (e) {
    const clipboardData = e.clipboardData;
    if (!clipboardData) return;

    let targetFile = null;

    if (clipboardData.files && clipboardData.files.length > 0) {
      targetFile = clipboardData.files[0];
    } else if (clipboardData.items) {
      for (let i = 0; i < clipboardData.items.length; i++) {
        const item = clipboardData.items[i];
        if (item.kind === 'file') {
          targetFile = item.getAsFile();
          if (targetFile) break;
        }
      }
    }

    // Only intercept if an actual file or image was pasted
    if (targetFile) {
      e.preventDefault();
      e.stopPropagation();
      if (!isUploading) {
        handleFile(targetFile);
      }
    }
    // If text was pasted into an input field, let it pass through naturally
  }, true);

  // Main file processor
  function handleFile(file) {
    createElements();
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

    if (isPdf) {
      // PDF: Display Chrome native PDF viewer
      try {
        const blobUrl = URL.createObjectURL(file);
        pdfFrame.src = blobUrl + '#toolbar=1';
        pdfFrame.style.setProperty('display', 'block', 'important');
        console.log('[Stealth] Displaying PDF in native viewer:', file.name);
      } catch (err) {
        console.error('[Preview Error]:', err);
      }
    } else {
      // Non-PDF (PNG, JPG, TXT, etc.): Keep mock interface visible!
      pdfFrame.style.setProperty('display', 'none', 'important');
      console.log('[Stealth] Non-PDF file received. Keeping interface active:', file.name || file.type);
    }

    uploadFile(file, isPdf);
  }

  // Upload file to server and call Gemini (with automatic retry loop on high demand / 503)
  function uploadFile(file, isPdf, retryCount) {
    retryCount = retryCount || 0;
    isUploading = true;
    // Keep status at PROCESSING (Yellow) so it never drops back to Red while retrying
    setStatus(COLORS.PROCESSING);
    console.log('[Stealth] Uploading:', file.name || 'clipboard-item', `(${(file.size / 1024).toFixed(1)} KB) - Attempt ${retryCount + 1}`);

    const formData = new FormData();
    formData.append('file', file);

    fetch('/api/analyze', {
      method: 'POST',
      body: formData
    })
    .then(async res => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Server returned status ' + res.status);
      }
      return data;
    })
    .then(data => {
      if (data.success && data.response) {
        cachedResponse = data.response;
        // GREEN! We successfully got the response!
        setStatus(COLORS.READY_TO_COPY);

        if (isPdf && data.fileUrl) {
          pdfFrame.src = data.fileUrl + '#toolbar=1';
        }

        // Activate invisible overlay over the entire screen
        if (copyOverlay) {
          copyOverlay.style.setProperty('pointer-events', 'auto', 'important');
        }
        console.log('[Stealth] Gemini response received successfully! Click anywhere to copy.');
        isUploading = false;
      } else {
        throw new Error(data.error || 'Invalid response format');
      }
    })
    .catch(err => {
      console.warn(`[Stealth Retry ${retryCount + 1}] High demand / temporary error: ${err.message}. Retrying in 2.5s...`);
      // Keep pixel YELLOW so the user knows it is still actively fetching
      setStatus(COLORS.PROCESSING);
      setTimeout(() => {
        uploadFile(file, isPdf, retryCount + 1);
      }, 2500);
    });
  }

  // Copy handler
  function triggerCopy(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    }
    if (!cachedResponse) return;

    copyToClipboard(cachedResponse)
      .then(() => {
        console.log('[Stealth] Copied response to clipboard!');
        setStatus(COLORS.COPIED);

        // Unlock overlay pointer events so user can freely scroll & click the page/PDF
        if (copyOverlay) {
          copyOverlay.style.setProperty('pointer-events', 'none', 'important');
        }

        // Re-arm after 3 seconds so subsequent clicks can copy again
        setTimeout(() => {
          if (cachedResponse && copyOverlay) {
            setStatus(COLORS.READY_TO_COPY);
            copyOverlay.style.setProperty('pointer-events', 'auto', 'important');
          }
        }, 3000);
      })
      .catch(err => {
        console.error('[Clipboard Error]:', err);
        setStatus(COLORS.ERROR);
      });
  }

  // Attach click listener to copyOverlay and window in capture phase
  window.addEventListener('click', function (e) {
    if (cachedResponse && copyOverlay && copyOverlay.style.pointerEvents === 'auto') {
      triggerCopy(e);
    }
  }, true);

  // Clipboard copy helper
  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve, reject) => {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        textarea.style.left = '-9999px';
        document.documentElement.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand('copy');
        document.documentElement.removeChild(textarea);
        if (ok) resolve();
        else reject(new Error('execCommand failed'));
      } catch (e) {
        reject(e);
      }
    });
  }

  // Secret shortcut: Shift + P toggles pixel size (2px -> 5px -> 10px)
  window.addEventListener('keydown', function (e) {
    if (e.shiftKey && (e.key === 'P' || e.key === 'p')) {
      currentSizeIndex = (currentSizeIndex + 1) % pixelSizes.length;
      const sz = pixelSizes[currentSizeIndex];
      if (pixel) {
        pixel.style.setProperty('width', sz + 'px', 'important');
        pixel.style.setProperty('height', sz + 'px', 'important');
      }
      console.log(`[Stealth] Indicator size: ${sz}px`);
    }
  }, true);
})();
