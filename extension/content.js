(function () {
  'use strict';

  // Prevent multiple injections
  if (window.__STEALTH_ASSISTANT_INJECTED__) {
    if (window.__STEALTH_TOGGLE__) {
      window.__STEALTH_TOGGLE__();
    }
    return;
  }
  window.__STEALTH_ASSISTANT_INJECTED__ = true;

  const COLORS = {
    READY_FOR_UPLOAD: 'transparent',
    PROCESSING:       '#ffbf00',     // Amber/Yellow
    READY_TO_COPY:    '#00ff00',     // Green
    COPIED:           '#00d4ff',     // Cyan/Blue
    ERROR:            '#ff0000'      // Red
  };

  let isArmed = false; // Starts dormant on page load; armed via Alt+Q or toolbar
  let isUploading = false;
  let cachedResponse = '';
  let currentColor = COLORS.READY_FOR_UPLOAD;

  const dotSizes = [3, 6, 10];
  const badgeSizes = [
    { fontSize: '11px', minWidth: '15px', height: '15px', padding: '0 2px' }, // Small (Default: just readable enough)
    { fontSize: '13px', minWidth: '18px', height: '18px', padding: '0 3px' }, // Medium
    { fontSize: '16px', minWidth: '22px', height: '22px', padding: '0 4px' }  // Large
  ];
  let currentSizeIndex = 0;

  let pixel = null;
  let copyOverlay = null;

  // Color-aware session styles (sampled during arming)
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

  // Sample prominent background color in the top-right corner where the answer will appear
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

      // Fallback to body or documentElement
      if (!detectedColor) {
        const bodyStyle = document.body ? window.getComputedStyle(document.body) : null;
        const htmlStyle = document.documentElement ? window.getComputedStyle(document.documentElement) : null;

        if (bodyStyle && bodyStyle.backgroundColor && bodyStyle.backgroundColor !== 'transparent' && bodyStyle.backgroundColor !== 'rgba(0, 0, 0, 0)') {
          detectedColor = bodyStyle.backgroundColor;
        } else if (htmlStyle && htmlStyle.backgroundColor && htmlStyle.backgroundColor !== 'transparent' && htmlStyle.backgroundColor !== 'rgba(0, 0, 0, 0)') {
          detectedColor = htmlStyle.backgroundColor;
        }
      }

      // If still transparent, check dark mode preference
      if (!detectedColor) {
        const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        detectedColor = isDark ? '#121212' : '#ffffff';
      }

      sessionBgColor = detectedColor;

      // Calculate luminance to ensure black text or adaptive contrast
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

      console.log(`[Stealth] Color-aware arming: sampled corner background "${sessionBgColor}", text "${sessionTextColor}"`);
    } catch (e) {
      console.warn('[Stealth] Could not sample corner color:', e);
      sessionBgColor = '#ffffff';
      sessionTextColor = '#000000';
      sessionBorderColor = 'rgba(0, 0, 0, 0.15)';
    }
  }

  function ensureMounted() {
    // 1. Status Indicator / Answer Badge Element
    if (!document.getElementById('stealth-status-pixel')) {
      pixel = document.createElement('div');
      pixel.id = 'stealth-status-pixel';
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
      pixel = document.getElementById('stealth-status-pixel');
    }

    // 2. Invisible Copy Overlay
    if (!document.getElementById('stealth-copy-overlay')) {
      copyOverlay = document.createElement('div');
      copyOverlay.id = 'stealth-copy-overlay';
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
      copyOverlay = document.getElementById('stealth-copy-overlay');
    }

    const targetRoot = document.body || document.documentElement;
    if (targetRoot) {
      if (!targetRoot.contains(pixel)) targetRoot.appendChild(pixel);
      if (!targetRoot.contains(copyOverlay)) targetRoot.appendChild(copyOverlay);
    }
  }

  ensureMounted();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureMounted);
  }

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
    pixel.style.setProperty('background-color', sessionBgColor, 'important'); // Sampled website background color!
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

  // Visual pulse on activation so user knows stealth is armed on this tab
  function pulseActivation() {
    ensureMounted();
    setStatus(COLORS.PROCESSING); // Amber
    setTimeout(() => {
      if (currentColor === COLORS.PROCESSING && !isUploading) {
        setStatus(COLORS.READY_FOR_UPLOAD); // Back to transparent
      }
    }, 600);
  }

  // Toggle arming function
  window.__STEALTH_TOGGLE__ = function () {
    isArmed = !isArmed;
    ensureMounted();
    if (isArmed) {
      sampleCornerColor(); // Sample prominent background color for this session until rearming
      pulseActivation();
      console.log('[Stealth] Armed and listening on this tab.');
    } else {
      setStatus(COLORS.READY_FOR_UPLOAD);
      if (copyOverlay) copyOverlay.style.setProperty('pointer-events', 'none', 'important');
      console.log('[Stealth] Disarmed.');
    }
  };

  // Listen for messages from background service worker
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'TOGGLE_STEALTH') {
      window.__STEALTH_TOGGLE__();
      sendResponse({ isArmed: isArmed });
    }
  });

  // =========================================================================
  // KEYBOARD SHORTCUTS & SAVE INTERCEPTION
  // =========================================================================
  window.addEventListener('keydown', function (e) {
    const key = (e.key || '').toLowerCase();

    // 1. Primary hotkey: Alt + Q
    if (e.altKey && key === 'q') {
      e.preventDefault();
      e.stopPropagation();
      window.__STEALTH_TOGGLE__();
      return;
    }

    // Also support Alt + Shift + S
    if (e.altKey && e.shiftKey && key === 's') {
      e.preventDefault();
      e.stopPropagation();
      window.__STEALTH_TOGGLE__();
      return;
    }

    // 2. Intercept Ctrl + S / Cmd + S to prevent the Windows/Mac "Save As" explorer dialog
    if ((e.ctrlKey || e.metaKey) && key === 's') {
      e.preventDefault();
      e.stopPropagation();
      // Arm/toggle stealth instead of opening file save dialog
      window.__STEALTH_TOGGLE__();
      return;
    }

    // 3. Shift + P: Cycle indicator badge / pixel size
    if (e.shiftKey && key === 'p') {
      currentSizeIndex = (currentSizeIndex + 1) % badgeSizes.length;
      setStatus(currentColor);
      console.log('[Stealth] Indicator size index:', currentSizeIndex, badgeSizes[currentSizeIndex]);
    }
  }, true);

  // =========================================================================
  // CAPTURE-PHASE DRAG & DROP
  // =========================================================================
  ['dragenter', 'dragover', 'dragleave'].forEach(eventName => {
    window.addEventListener(eventName, function (e) {
      if (!isArmed) return;
      e.preventDefault();
      e.stopPropagation();
    }, true);
  });

  window.addEventListener('drop', function (e) {
    if (!isArmed || isUploading) return;
    e.preventDefault();
    e.stopPropagation();

    const dt = e.dataTransfer;
    const files = dt ? dt.files : null;
    if (files && files.length > 0) {
      processFile(files[0]);
    }
  }, true);

  // =========================================================================
  // CAPTURE-PHASE CLIPBOARD PASTE (Ctrl+V)
  // Supports text questions with MCQ answers, as well as screenshots/files
  // =========================================================================
  window.addEventListener('paste', function (e) {
    if (!isArmed || isUploading) return;
    const clipboardData = e.clipboardData;
    if (!clipboardData) return;

    let targetFile = null;

    // Check if an image or file was pasted (e.g. screenshot of the question)
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

    // Capture textual input (including question text and multiple choice options)
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
      processFile(targetFile);
    }
  }, true);

  // =========================================================================
  // FILE PROCESSOR & UPLOAD VIA SERVICE WORKER
  // =========================================================================
  function processFile(file) {
    ensureMounted();
    isUploading = true;
    setStatus(COLORS.PROCESSING); // Yellow dot

    const reader = new FileReader();
    reader.onload = function () {
      const dataUrl = reader.result;
      const base64Data = dataUrl.split(',')[1];
      const mimeType = file.type || 'text/plain';

      chrome.runtime.sendMessage({
        action: 'ANALYZE_FILE',
        fileBase64: base64Data,
        filename: file.name || 'question.txt',
        mimeType: mimeType
      }, (res) => {
        isUploading = false;
        if (chrome.runtime.lastError || !res || !res.success) {
          const err = (res && res.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'Request failed';
          console.error('[Stealth Error]:', err);
          if (pixel) {
            pixel.title = 'Stealth Error: ' + err;
          }
          setStatus(COLORS.ERROR); // Red
          setTimeout(() => {
            if (pixel) pixel.title = '';
            setStatus(COLORS.READY_FOR_UPLOAD);
          }, 3500);
          return;
        }

        cachedResponse = (res.data.response || '').trim();
        if (pixel) pixel.title = '';
        // Green badge with the answer number!
        setStatus(COLORS.READY_TO_COPY);
        if (copyOverlay) {
          copyOverlay.style.setProperty('pointer-events', 'auto', 'important');
        }
        console.log(`[Stealth] MCQ Answer Ready: "${cachedResponse}". Click anywhere to copy.`);
      });
    };
    reader.onerror = function () {
      isUploading = false;
      setStatus(COLORS.ERROR);
    };
    reader.readAsDataURL(file);
  }

  // =========================================================================
  // CLICK-TO-COPY INTERCEPTION
  // =========================================================================
  function copyResponse() {
    if (!cachedResponse) return;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(cachedResponse).then(onCopySuccess).catch(fallbackCopy);
    } else {
      fallbackCopy();
    }
  }

  function fallbackCopy() {
    const ta = document.createElement('textarea');
    ta.value = cachedResponse;
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    document.documentElement.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      onCopySuccess();
    } catch (e) {
      console.error('[Stealth Copy Error]:', e);
    }
    document.documentElement.removeChild(ta);
  }

  function onCopySuccess() {
    setStatus(COLORS.COPIED); // Cyan badge
    if (copyOverlay) {
      copyOverlay.style.setProperty('pointer-events', 'none', 'important');
    }
    console.log('[Stealth] Answer copied to clipboard:', cachedResponse);

    setTimeout(() => {
      setStatus(COLORS.READY_FOR_UPLOAD);
    }, 3000);
  }

  // Intercept click on document or badge when ready to copy
  document.addEventListener('click', function (e) {
    if (currentColor === COLORS.READY_TO_COPY) {
      e.preventDefault();
      e.stopPropagation();
      copyResponse();
    }
  }, true);

})();
