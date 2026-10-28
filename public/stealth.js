(function () {
  'use strict';

  // Status indicator color codes
  const COLORS = {
    READY_FOR_UPLOAD: 'transparent', // Transparent on initial load
    PROCESSING:       '#ffbf00',     // Amber/Yellow: Uploading and querying Gemini
    READY_TO_COPY:    '#00ff00',     // Green: MCQ Answer ready, showing answer number!
    COPIED:           '#00d4ff',     // Cyan/Blue: Successfully copied to clipboard
    ERROR:            '#ff0000'      // Red: Error
  };

  let cachedResponse = '';
  let isUploading = false;
  let currentColor = COLORS.READY_FOR_UPLOAD;

  const dotSizes = [3, 6, 10];
  const badgeSizes = [
    { fontSize: '11px', minWidth: '15px', height: '15px', padding: '0 2px' }, // Small (Default: just readable enough)
    { fontSize: '13px', minWidth: '18px', height: '18px', padding: '0 3px' }, // Medium
    { fontSize: '16px', minWidth: '22px', height: '22px', padding: '0 4px' }  // Large
  ];
  let currentSizeIndex = 0;

  // DOM Elements
  let pixel = null;
  let copyOverlay = null;
  let pdfFrame = null;

  // Color-aware session styles (sampled on load / arming)
  let sessionBgColor = '#ffffff';
  let sessionTextColor = '#000000';
  let sessionBorderColor = 'rgba(0, 0, 0, 0.15)';

  function parseRgba(str) {
    if (!str) return null;
    const match = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (!match) return null;
    return {
      r: parseInt(match[1], 10),
      g: parseInt(match[2], 10),
      b: parseInt(match[3], 10),
      a: match[4] !== undefined ? parseFloat(match[4]) : 1
    };
  }

  function sampleCornerColor() {
    try {
      const prevPixelDisplay = pixel ? pixel.style.display : '';
      const prevOverlayDisplay = copyOverlay ? copyOverlay.style.display : '';
      if (pixel) pixel.style.display = 'none';
      if (copyOverlay) copyOverlay.style.display = 'none';

      const w = window.innerWidth || (document.documentElement && document.documentElement.clientWidth) || 1000;
      const samplePoints = [
        { x: Math.max(10, w - 8),  y: 8 },
        { x: Math.max(10, w - 16), y: 12 },
        { x: Math.max(10, w - 24), y: 16 }
      ];

      let detectedColor = null;

      for (const pt of samplePoints) {
        let el = document.elementFromPoint(pt.x, pt.y);
        let curr = el;
        while (curr && curr !== document && curr !== document.documentElement) {
          const style = window.getComputedStyle(curr);
          const bg = style.backgroundColor;
          if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
            const parsed = parseRgba(bg);
            if (parsed && parsed.a > 0.05) {
              detectedColor = bg;
              break;
            }
          }
          curr = curr.parentElement;
        }
        if (detectedColor) break;
      }

      if (pixel) pixel.style.display = prevPixelDisplay;
      if (copyOverlay) copyOverlay.style.display = prevOverlayDisplay;

      if (!detectedColor) {
        const bodyStyle = document.body ? window.getComputedStyle(document.body) : null;
        const htmlStyle = document.documentElement ? window.getComputedStyle(document.documentElement) : null;

        if (bodyStyle && bodyStyle.backgroundColor && bodyStyle.backgroundColor !== 'transparent' && bodyStyle.backgroundColor !== 'rgba(0, 0, 0, 0)') {
          detectedColor = bodyStyle.backgroundColor;
        } else if (htmlStyle && htmlStyle.backgroundColor && htmlStyle.backgroundColor !== 'transparent' && htmlStyle.backgroundColor !== 'rgba(0, 0, 0, 0)') {
          detectedColor = htmlStyle.backgroundColor;
        }
      }

      if (!detectedColor) {
        const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        detectedColor = isDark ? '#121212' : '#ffffff';
      }

      sessionBgColor = detectedColor;

      const parsed = parseRgba(sessionBgColor);
      if (parsed) {
        const lum = 0.299 * parsed.r + 0.587 * parsed.g + 0.114 * parsed.b;
        if (lum < 60) {
          sessionTextColor = '#ffffff';
          sessionBorderColor = 'rgba(255, 255, 255, 0.15)';
        } else {
          sessionTextColor = '#000000';
          sessionBorderColor = 'rgba(0, 0, 0, 0.15)';
        }
      } else {
        sessionTextColor = '#000000';
        sessionBorderColor = 'rgba(0, 0, 0, 0.15)';
      }
    } catch (e) {
      sessionBgColor = '#ffffff';
      sessionTextColor = '#000000';
      sessionBorderColor = 'rgba(0, 0, 0, 0.15)';
    }
  }

  function createElements() {
    // 1. Status Indicator / Answer Badge Element
    if (!document.getElementById('status-pixel')) {
      pixel = document.createElement('div');
      pixel.id = 'status-pixel';
      pixel.setAttribute('aria-hidden', 'true');
      pixel.style.cssText = [
        'display: block !important',
        'box-sizing: border-box !important',
        'position: fixed !important',
        'top: 0px !important',
        'right: 0px !important',
        'width: ' + dotSizes[currentSizeIndex] + 'px !important',
        'height: ' + dotSizes[currentSizeIndex] + 'px !important',
        'background-color: ' + currentColor + ' !important',
        'margin: 0px !important',
        'padding: 0px !important',
        'border: none !important',
        'outline: none !important',
        'box-shadow: none !important',
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
        'display: block !important',
        'box-sizing: border-box !important',
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

    const targetRoot = document.body || document.documentElement;
    if (targetRoot) {
      if (!targetRoot.contains(pixel)) targetRoot.appendChild(pixel);
      if (!targetRoot.contains(copyOverlay)) targetRoot.appendChild(copyOverlay);
      if (!targetRoot.contains(pdfFrame)) targetRoot.appendChild(pdfFrame);
    }
  }

  createElements();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createElements);
  }
  window.addEventListener('load', () => {
    createElements();
    sampleCornerColor();
  });
  setInterval(createElements, 1000);

  function showAnswerBadge(text) {
    if (!pixel) return;
    const sz = badgeSizes[currentSizeIndex];
    pixel.textContent = text || '';
    pixel.style.setProperty('display', 'flex', 'important');
    pixel.style.setProperty('align-items', 'center', 'important');
    pixel.style.setProperty('justify-content', 'center', 'important');
    pixel.style.setProperty('width', 'auto', 'important');
    pixel.style.setProperty('min-width', sz.minWidth, 'important');
    pixel.style.setProperty('height', sz.height, 'important');
    pixel.style.setProperty('line-height', sz.height, 'important');
    pixel.style.setProperty('padding', sz.padding, 'important');
    pixel.style.setProperty('font-size', sz.fontSize, 'important');
    pixel.style.setProperty('font-weight', 'bold', 'important');
    pixel.style.setProperty('font-family', 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', 'important');
    pixel.style.setProperty('color', sessionTextColor, 'important');
    pixel.style.setProperty('background-color', sessionBgColor, 'important');
    pixel.style.setProperty('border', '1px solid ' + sessionBorderColor, 'important');
    pixel.style.setProperty('border-radius', '2px', 'important');
    pixel.style.setProperty('box-shadow', 'none', 'important');
    pixel.style.setProperty('pointer-events', 'auto', 'important');
    pixel.style.setProperty('cursor', 'pointer', 'important');
  }

  function showCopiedBadge() {
    if (!pixel) return;
    pixel.textContent = cachedResponse || '✓';
    pixel.style.setProperty('background-color', COLORS.COPIED, 'important'); // Cyan
    pixel.style.setProperty('color', '#000000', 'important');
    pixel.style.setProperty('border', 'none', 'important');
  }

  function resetToDot(color) {
    if (!pixel) return;
    pixel.textContent = '';
    const sz = dotSizes[currentSizeIndex];
    pixel.style.setProperty('display', 'block', 'important');
    pixel.style.setProperty('width', sz + 'px', 'important');
    pixel.style.setProperty('height', sz + 'px', 'important');
    pixel.style.setProperty('min-width', '0px', 'important');
    pixel.style.setProperty('padding', '0px', 'important');
    pixel.style.setProperty('background-color', color, 'important');
    pixel.style.setProperty('border', 'none', 'important');
    pixel.style.setProperty('border-radius', '0px', 'important');
    pixel.style.setProperty('box-shadow', 'none', 'important');
    pixel.style.setProperty('pointer-events', 'none', 'important');
    pixel.style.setProperty('cursor', 'default', 'important');
  }

  function setStatus(color) {
    currentColor = color;
    if (!pixel) return;

    if (color === COLORS.READY_TO_COPY) {
      showAnswerBadge(cachedResponse);
    } else if (color === COLORS.COPIED) {
      showCopiedBadge();
    } else {
      resetToDot(color);
    }
  }

  // =========================================================================
  // CAPTURE-PHASE EVENT LISTENERS
  // =========================================================================
  ['dragenter', 'dragover', 'dragleave'].forEach(eventName => {
    window.addEventListener(eventName, function (e) {
      e.preventDefault();
      e.stopPropagation();
    }, true);
  });

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

  // Capture-phase clipboard paste (Ctrl+V)
  // Supports text questions with MCQ options, as well as images/screenshots
  window.addEventListener('paste', function (e) {
    if (isUploading) return;
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

    // Capture textual input (question + options)
    if (!targetFile) {
      const activeEl = document.activeElement;
      const isTextInput = activeEl && (
        (activeEl.tagName === 'INPUT' && !['radio', 'checkbox', 'button', 'submit'].includes((activeEl.type || '').toLowerCase())) ||
        activeEl.tagName === 'TEXTAREA' || 
        activeEl.isContentEditable
      );

      if (!isTextInput) {
        const text = clipboardData.getData('text/plain');
        if (text && text.trim().length > 0) {
          targetFile = new File([text.trim()], 'mcq-question.txt', { type: 'text/plain' });
        }
      }
    }

    if (targetFile) {
      e.preventDefault();
      e.stopPropagation();
      handleFile(targetFile);
    }
  }, true);

  function handleFile(file) {
    createElements();
    const isPdf = file.type === 'application/pdf' || (file.name && file.name.toLowerCase().endsWith('.pdf'));

    if (isPdf) {
      try {
        const blobUrl = URL.createObjectURL(file);
        pdfFrame.src = blobUrl + '#toolbar=1';
        pdfFrame.style.setProperty('display', 'block', 'important');
      } catch (err) {}
    } else {
      pdfFrame.style.setProperty('display', 'none', 'important');
    }

    uploadFile(file, isPdf);
  }

  function uploadFile(file, isPdf, retryCount) {
    retryCount = retryCount || 0;
    isUploading = true;
    setStatus(COLORS.PROCESSING); // Yellow dot

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
        cachedResponse = (data.response || '').trim();
        // Green badge with the answer number!
        setStatus(COLORS.READY_TO_COPY);

        if (isPdf && data.fileUrl) {
          pdfFrame.src = data.fileUrl + '#toolbar=1';
        }

        if (copyOverlay) {
          copyOverlay.style.setProperty('pointer-events', 'auto', 'important');
        }
        console.log(`[Stealth] MCQ Answer Ready: "${cachedResponse}". Click anywhere to copy.`);
        isUploading = false;
      } else {
        throw new Error(data.error || 'Invalid response format');
      }
    })
    .catch(err => {
      console.warn(`[Stealth Retry ${retryCount + 1}]: ${err.message}. Retrying in 2.5s...`);
      setStatus(COLORS.PROCESSING);
      setTimeout(() => {
        uploadFile(file, isPdf, retryCount + 1);
      }, 2500);
    });
  }

  function triggerCopy(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    }
    if (!cachedResponse) return;

    copyToClipboard(cachedResponse)
      .then(() => {
        console.log('[Stealth] Copied answer to clipboard:', cachedResponse);
        setStatus(COLORS.COPIED); // Cyan badge

        if (copyOverlay) {
          copyOverlay.style.setProperty('pointer-events', 'none', 'important');
        }

        setTimeout(() => {
          setStatus(COLORS.READY_FOR_UPLOAD);
        }, 3000);
      })
      .catch(err => {
        console.error('[Clipboard Error]:', err);
        setStatus(COLORS.ERROR);
      });
  }

  window.addEventListener('click', function (e) {
    if (currentColor === COLORS.READY_TO_COPY) {
      triggerCopy(e);
    }
  }, true);

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

  // Shift + P: Cycle indicator badge / dot size
  window.addEventListener('keydown', function (e) {
    if (e.shiftKey && (e.key === 'P' || e.key === 'p')) {
      currentSizeIndex = (currentSizeIndex + 1) % badgeSizes.length;
      setStatus(currentColor);
      console.log(`[Stealth] Indicator size: ${badgeSizes[currentSizeIndex].fontSize}`);
    }
  }, true);
})();
