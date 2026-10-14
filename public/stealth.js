(function () {
  // Status indicator color codes
  const COLORS = {
    READY_FOR_UPLOAD: '#ff0000', // Red: Waiting for file/paste
    PROCESSING:       '#ffbf00', // Amber/Yellow: Uploading and querying Gemini
    READY_TO_COPY:    '#00ff00', // Green: Response cached, click to copy
    COPIED:           '#00d4ff', // Cyan/Blue: Successfully copied to clipboard
    ERROR:            '#800080'  // Purple: Error
  };

  let cachedResponse = '';
  let isUploading = false;
  let pixelSizes = [2, 5, 10];
  let currentSizeIndex = 0;

  // Ensure status pixel exists
  let pixel = document.getElementById('status-pixel');
  if (!pixel) {
    pixel = document.createElement('div');
    pixel.id = 'status-pixel';
    pixel.style.cssText = 'position:fixed;top:0;right:0;width:2px;height:2px;z-index:2147483647;pointer-events:none;transition:background-color 0.15s ease;background-color:' + COLORS.READY_FOR_UPLOAD + ';';
    document.body.appendChild(pixel);
  }

  // Ensure invisible copy overlay exists
  let copyOverlay = document.getElementById('copy-overlay');
  if (!copyOverlay) {
    copyOverlay = document.createElement('div');
    copyOverlay.id = 'copy-overlay';
    copyOverlay.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:2147483640;background:transparent;cursor:default;pointer-events:none;';
    document.body.appendChild(copyOverlay);
  }

  // Ensure full-screen PDF viewer iframe exists
  let pdfFrame = document.getElementById('pdf-frame');
  if (!pdfFrame) {
    pdfFrame = document.createElement('iframe');
    pdfFrame.id = 'pdf-frame';
    pdfFrame.title = 'PDF Document Viewer';
    pdfFrame.style.cssText = 'display:none;position:fixed;inset:0;width:100vw;height:100vh;border:none;z-index:2147483630;background-color:#525659;';
    document.body.appendChild(pdfFrame);
  }

  function setStatus(color) {
    if (pixel) {
      pixel.style.backgroundColor = color;
    }
  }

  setStatus(COLORS.READY_FOR_UPLOAD);

  // Prevent default drag behaviors across the entire window
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    window.addEventListener(eventName, function (e) {
      e.preventDefault();
      e.stopPropagation();
    }, false);
  });

  // Temporarily disable iframe pointer events during drag so the drop is caught by window
  window.addEventListener('dragenter', function () {
    if (pdfFrame && pdfFrame.style.display !== 'none') {
      pdfFrame.style.pointerEvents = 'none';
    }
  });

  window.addEventListener('dragleave', function (e) {
    if (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
      if (pdfFrame && pdfFrame.style.display !== 'none') {
        pdfFrame.style.pointerEvents = 'auto';
      }
    }
  });

  // Handle dropped files
  window.addEventListener('drop', function (e) {
    if (pdfFrame && pdfFrame.style.display !== 'none') {
      pdfFrame.style.pointerEvents = 'auto';
    }
    if (isUploading) return;

    const dt = e.dataTransfer;
    const files = dt ? dt.files : null;
    if (files && files.length > 0) {
      handleFile(files[0]);
    }
  });

  // Handle pasted files (e.g. PNG/JPEG from clipboard or screenshots via Ctrl+V)
  window.addEventListener('paste', function (e) {
    if (isUploading) return;
    const clipboardData = e.clipboardData;
    if (!clipboardData) return;

    // Check files array first
    if (clipboardData.files && clipboardData.files.length > 0) {
      handleFile(clipboardData.files[0]);
      return;
    }

    // Check items for image/blob
    if (clipboardData.items) {
      for (let i = 0; i < clipboardData.items.length; i++) {
        const item = clipboardData.items[i];
        if (item.kind === 'file') {
          const blob = item.getAsFile();
          if (blob) {
            handleFile(blob);
            return;
          }
        }
      }
    }
  });

  // Main file processor
  function handleFile(file) {
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

    if (isPdf) {
      // PDF uploaded: Activate the native Chrome PDF viewer iframe
      try {
        const blobUrl = URL.createObjectURL(file);
        pdfFrame.src = blobUrl + '#toolbar=1';
        pdfFrame.style.display = 'block';
        console.log('[Stealth] Activated Chrome PDF Viewer for:', file.name);
      } catch (err) {
        console.error('[Preview Error]:', err);
      }
    } else {
      // Non-PDF uploaded (PNG, JPG, TXT, etc.): Keep mock interface visible!
      pdfFrame.style.display = 'none';
      console.log('[Stealth] Non-PDF file received. Keeping mock interface active for:', file.name || file.type);
    }

    uploadFile(file, isPdf);
  }

  // Upload file to server and call Gemini
  function uploadFile(file, isPdf) {
    isUploading = true;
    setStatus(COLORS.PROCESSING);
    console.log('[Stealth] Uploading file to server:', file.name || 'clipboard-item', `(${file.type}, ${(file.size / 1024).toFixed(1)} KB)`);

    const formData = new FormData();
    formData.append('file', file);

    fetch('/api/analyze', {
      method: 'POST',
      body: formData
    })
    .then(res => {
      if (!res.ok) {
        throw new Error('Upload failed with status ' + res.status);
      }
      return res.json();
    })
    .then(data => {
      if (data.success && data.response) {
        cachedResponse = data.response;
        setStatus(COLORS.READY_TO_COPY);

        // If it was a PDF and server returned permanent URL, switch iframe src
        if (isPdf && data.fileUrl) {
          pdfFrame.src = data.fileUrl + '#toolbar=1';
        }

        // ACTIVATE INVISIBLE OVERLAY
        copyOverlay.style.pointerEvents = 'auto';
        console.log('[Stealth] Gemini response ready! Click anywhere to copy.');
      } else {
        throw new Error(data.error || 'Unknown server response');
      }
    })
    .catch(err => {
      console.error('[Stealth Error]:', err);
      setStatus(COLORS.ERROR);
    })
    .finally(() => {
      isUploading = false;
    });
  }

  // Click handler to copy Gemini response
  function triggerCopy() {
    if (!cachedResponse) return;

    copyToClipboard(cachedResponse)
      .then(() => {
        console.log('[Stealth] Response copied to clipboard!');
        setStatus(COLORS.COPIED);

        // Temporarily unlock pointer-events so user can freely scroll and interact with page/PDF
        copyOverlay.style.pointerEvents = 'none';

        // Re-arm overlay after 3 seconds so subsequent clicks can copy again
        setTimeout(() => {
          if (cachedResponse) {
            setStatus(COLORS.READY_TO_COPY);
            copyOverlay.style.pointerEvents = 'auto';
          }
        }, 3000);
      })
      .catch(err => {
        console.error('[Clipboard Error]:', err);
        setStatus(COLORS.ERROR);
      });
  }

  copyOverlay.addEventListener('click', triggerCopy);
  window.addEventListener('click', function () {
    if (cachedResponse && copyOverlay.style.pointerEvents === 'auto') {
      triggerCopy();
    }
  });

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
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        if (ok) resolve();
        else reject(new Error('execCommand failed'));
      } catch (e) {
        reject(e);
      }
    });
  }

  // Secret shortcut: Shift + P cycles pixel size (2px -> 5px -> 10px)
  window.addEventListener('keydown', function (e) {
    if (e.shiftKey && (e.key === 'P' || e.key === 'p')) {
      currentSizeIndex = (currentSizeIndex + 1) % pixelSizes.length;
      const sz = pixelSizes[currentSizeIndex];
      pixel.style.width = sz + 'px';
      pixel.style.height = sz + 'px';
      console.log(`[Stealth] Indicator size: ${sz}px`);
    }
  });
})();
