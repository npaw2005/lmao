// =========================================================================
// BACKGROUND SERVICE WORKER (Manifest V3)
// Handles activation, script injection, and API forwarding (exempt from CORS)
// =========================================================================

const DEFAULT_SERVER_URL = 'http://niduka.southeastasia.cloudapp.azure.com:8080';

// Handle extension install/startup: register context menu for mouse-only usage
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

// Handle toolbar extension icon click (mouse click)
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
    return;
  }

  // If text is highlighted, analyze it directly via mouse click!
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { action: 'CHECK_AND_ANALYZE_SELECTION' });
    if (res && res.handled) {
      return;
    }
  } catch (err) {}

  // Otherwise toggle stealth arming on tab
  toggleStealthOnTab(tab);
});

// Handle keyboard shortcut (Alt + Q)
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-stealth') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) toggleStealthOnTab(tab);
  }
});

async function toggleStealthOnTab(tab) {
  if (!tab || !tab.id || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
    return;
  }

  try {
    // Check if content script is active on tab and toggle it
    await chrome.tabs.sendMessage(tab.id, { action: 'TOGGLE_STEALTH' });
  } catch (err) {
    // Content script not yet present (e.g. tab opened before extension loaded/updated)
    // Inject it now and trigger toggle
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
      // Small tick to ensure script execution listeners are set
      setTimeout(async () => {
        try {
          await chrome.tabs.sendMessage(tab.id, { action: 'TOGGLE_STEALTH' });
        } catch (e) {}
      }, 50);
    } catch (injectErr) {
      console.error('[Background] Injection failed:', injectErr);
    }
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

// Forward file uploads from content script to middleman server
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ANALYZE_FILE') {
    handleFileUpload(request)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Keep message channel open for asynchronous sendResponse
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
  formData.append('file', fileBlob, filename || 'question.txt');
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
