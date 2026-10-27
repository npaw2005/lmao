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

  let isArmed = true;
  let isUploading = false;
  let cachedResponse = '';
  let currentColor = COLORS.READY_FOR_UPLOAD;
  let pixelSizes = [2, 5, 10];
  let currentSizeIndex = 0;

  let pixel = null;
  let copyOverlay = null;

  function createElements() {
    // 1. Status Indicator Pixel
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
        'width: ' + pixelSizes[currentSizeIndex] + 'px !important',
        'height: ' + pixelSizes[currentSizeIndex] + 'px !important',
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

    const targetRoot = document.documentElement || document.body;
    if (targetRoot) {
      if (!document.getElementById('stealth-status-pixel')) targetRoot.appendChild(pixel);
      if (!document.getElementById('stealth-copy-overlay')) targetRoot.appendChild(copyOverlay);
    }
  }

  createElements();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createElements);
  }

  function setStatus(color) {
    currentColor = color;
    if (pixel) {
      pixel.style.setProperty('background-color', color, 'important');
    }
  }

  // Brief activation pulse so user knows stealth is armed
  function pulseActivation() {
    setStatus('#ffbf00');
    setTimeout(() => {
      setStatus(COLORS.READY_FOR_UPLOAD);
    }, 600);
  }

  pulseActivation();

  // Toggle arming function
  window.__STEALTH_TOGGLE__ = function () {
    isArmed = !isArmed;
    if (isArmed) {
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
  // =========================================================================
  window.addEventListener('paste', function (e) {
    if (!isArmed || isUploading) return;
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

    // Support plain text question pastes (when not focused inside an editable text input)
    if (!targetFile) {
      const activeEl = document.activeElement;
      const isInput = activeEl && (
        activeEl.tagName === 'INPUT' || 
        activeEl.tagName === 'TEXTAREA' || 
        activeEl.isContentEditable
      );
      if (!isInput) {
        const text = clipboardData.getData('text/plain');
        if (text && text.trim().length > 0) {
          targetFile = new File([text], 'clipboard-text.txt', { type: 'text/plain' });
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
    createElements();
    isUploading = true;
    setStatus(COLORS.PROCESSING); // Yellow

    const reader = new FileReader();
    reader.onload = function () {
      const dataUrl = reader.result;
      const base64Data = dataUrl.split(',')[1];
      const mimeType = file.type || 'application/octet-stream';

      chrome.runtime.sendMessage({
        action: 'ANALYZE_FILE',
        fileBase64: base64Data,
        filename: file.name || 'clipboard-item.png',
        mimeType: mimeType
      }, (res) => {
        isUploading = false;
        if (chrome.runtime.lastError || !res || !res.success) {
          const err = (res && res.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'Request failed';
          console.error('[Stealth Error]:', err);
          setStatus(COLORS.ERROR); // Red
          setTimeout(() => setStatus(COLORS.READY_FOR_UPLOAD), 3000);
          return;
        }

        cachedResponse = res.data.response || 'No response';
        setStatus(COLORS.READY_TO_COPY); // Green
        if (copyOverlay) {
          copyOverlay.style.setProperty('pointer-events', 'auto', 'important');
        }
        console.log('[Stealth] AI response ready. Click anywhere to copy.');
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
    setStatus(COLORS.COPIED); // Cyan/Blue
    if (copyOverlay) {
      copyOverlay.style.setProperty('pointer-events', 'none', 'important');
    }
    console.log('[Stealth] Response copied to clipboard!');

    setTimeout(() => {
      setStatus(COLORS.READY_FOR_UPLOAD);
    }, 3000);
  }

  document.addEventListener('click', function (e) {
    if (currentColor === COLORS.READY_TO_COPY) {
      e.preventDefault();
      e.stopPropagation();
      copyResponse();
    }
  }, true);

  // Shortcut: Shift + P toggles indicator pixel size
  window.addEventListener('keydown', function (e) {
    if (e.shiftKey && e.key.toUpperCase() === 'P') {
      currentSizeIndex = (currentSizeIndex + 1) % pixelSizes.length;
      const newSize = pixelSizes[currentSizeIndex];
      if (pixel) {
        pixel.style.setProperty('width', newSize + 'px', 'important');
        pixel.style.setProperty('height', newSize + 'px', 'important');
      }
      console.log('[Stealth] Indicator size:', newSize + 'px');
    }
  }, true);

})();
