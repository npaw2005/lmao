// =========================================================================
// BACKGROUND SERVICE WORKER (Manifest V3)
// Handles 1-click webview screenshot capture, API forwarding, and stealth response
// =========================================================================

const DEFAULT_SERVER_URL = 'http://niduka.southeastasia.cloudapp.azure.com:8080';

// Handle extension install/startup: register context menu for optional selection backup
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'stealth-analyze-selection',
    title: 'Search Selection',
    contexts: ['selection']
  });
});

// Handle right-click context menu click on selected text
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'stealth-analyze-selection' && tab && tab.id) {
    const text = (info.selectionText || '').trim();
    if (text.length > 0) {
      try {
        await chrome.tabs.sendMessage(tab.id, { action: 'ANALYZE_EXPLICIT_TEXT', text: text });
      } catch (err) {
        try {
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
          setTimeout(() => {
            chrome.tabs.sendMessage(tab.id, { action: 'ANALYZE_EXPLICIT_TEXT', text: text }).catch(() => {});
          }, 50);
        } catch (e) {}
      }
    }
  }
});

// 1-Click Pinned Extension Icon Trigger: Captures the visible webview and sends to AI
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
    return;
  }
  await captureTabAndAnalyze(tab);
});

// Keyboard shortcut (Alt + Q): Also triggers the instant 1-click webview capture
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-stealth') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      await captureTabAndAnalyze(tab);
    }
  }
});

// Main Webview Screenshot Capture & AI Dispatcher
async function captureTabAndAnalyze(tab) {
  if (!tab || !tab.id || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
    return;
  }

  // 1. Ensure content script is mounted and trigger START_ANALYSIS (amber dot + sample corner color)
  try {
    await chrome.tabs.sendMessage(tab.id, { action: 'START_ANALYSIS' });
  } catch (err) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
      await new Promise(r => setTimeout(r, 60));
      await chrome.tabs.sendMessage(tab.id, { action: 'START_ANALYSIS' }).catch(() => {});
    } catch (injectErr) {
      console.error('[Background] Script injection failed:', injectErr);
    }
  }

  // 2. Capture the exact visible webview as a high-quality, lightweight JPEG
  let dataUrl;
  try {
    dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId || null, { format: 'jpeg', quality: 80 });
  } catch (capErr) {
    console.error('[Background] Failed to capture visible tab:', capErr);
    chrome.tabs.sendMessage(tab.id, {
      action: 'SHOW_ERROR',
      error: 'Capture failed: ' + (capErr.message || 'unknown error')
    }).catch(() => {});
    return;
  }

  if (!dataUrl || !dataUrl.includes(',')) {
    chrome.tabs.sendMessage(tab.id, {
      action: 'SHOW_ERROR',
      error: 'Empty screenshot capture data'
    }).catch(() => {});
    return;
  }

  const base64Data = dataUrl.split(',')[1];
  console.log(`[Background] Captured webview screenshot (${Math.round(base64Data.length * 0.75 / 1024)} KB). Sending to AI...`);

  // 3. Forward screenshot to remote backend server
  try {
    const result = await handleFileUpload({
      fileBase64: base64Data,
      filename: 'webview-screenshot.jpg',
      mimeType: 'image/jpeg'
    });

    const answer = (result && result.response) ? result.response.trim() : '';
    console.log(`[Background] AI Answer received: "${answer}"`);

    // 4. Send the answer to content script to display the color-aware answer badge
    chrome.tabs.sendMessage(tab.id, {
      action: 'SHOW_ANSWER',
      response: answer
    }).catch(() => {});

  } catch (apiErr) {
    console.error('[Background] Screenshot analysis failed:', apiErr);
    chrome.tabs.sendMessage(tab.id, {
      action: 'SHOW_ERROR',
      error: apiErr.message || 'Analysis failed'
    }).catch(() => {});
  }
}

async function getServerUrl() {
  const settings = await chrome.storage.sync.get({ serverUrl: DEFAULT_SERVER_URL });
  let url = (settings.serverUrl || DEFAULT_SERVER_URL).trim().replace(/\/+$/, '');

  // Auto-migrate old Azure URLs without port 8080
  if (url === 'https://niduka.southeastasia.cloudapp.azure.com' || url === 'http://niduka.southeastasia.cloudapp.azure.com') {
    url = DEFAULT_SERVER_URL; // 'http://niduka.southeastasia.cloudapp.azure.com:8080'
    chrome.storage.sync.set({ serverUrl: url }).catch(() => {});
  }

  // Ensure port 8080 uses http:// (not https://)
  if (url.startsWith('https://') && url.includes(':8080')) {
    url = url.replace('https://', 'http://');
    chrome.storage.sync.set({ serverUrl: url }).catch(() => {});
  }

  return url;
}

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ANALYZE_FILE') {
    handleFileUpload(request)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Keep message channel open for asynchronous sendResponse
  } else if (request.action === 'CAPTURE_WEBVIEW') {
    if (sender && sender.tab) {
      captureTabAndAnalyze(sender.tab);
    }
    sendResponse({ started: true });
    return false;
  }
});

async function handleFileUpload(request) {
  const { fileBase64, filename, mimeType, prompt } = request;
  const serverUrl = await getServerUrl();

  // Convert Base64 back into binary Blob
  const byteChars = atob(fileBase64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteNumbers[i] = byteChars.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  const fileBlob = new Blob([byteArray], { type: mimeType });

  const formData = new FormData();
  formData.append('file', fileBlob, filename || 'upload.bin');
  if (prompt) {
    formData.append('prompt', prompt);
  }

  console.log(`[Background] Forwarding "${filename}" (${fileBlob.size} bytes) to: ${serverUrl}/api/analyze`);

  let response;
  try {
    response = await fetch(`${serverUrl}/api/analyze`, {
      method: 'POST',
      body: formData
    });
  } catch (netErr) {
    console.error(`[Background] Network fetch failed connecting to ${serverUrl}:`, netErr);
    throw new Error(`Cannot connect to ${serverUrl} (${netErr.message}). Check extension Options or server status.`);
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Server ${serverUrl} returned HTTP ${response.status}: ${errorText || response.statusText}`);
  }

  const json = await response.json();
  return json;
}
