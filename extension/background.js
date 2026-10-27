// =========================================================================
// BACKGROUND SERVICE WORKER (Manifest V3)
// Handles activation, script injection, and API forwarding (exempt from CORS)
// =========================================================================

const DEFAULT_SERVER_URL = 'https://niduka.southeastasia.cloudapp.azure.com';

// Handle toolbar extension icon click
chrome.action.onClicked.addListener(async (tab) => {
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

  // Retrieve configured server URL from storage
  const settings = await chrome.storage.sync.get({ serverUrl: DEFAULT_SERVER_URL });
  const serverUrl = (settings.serverUrl || DEFAULT_SERVER_URL).replace(/\/+$/, '');

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

  const response = await fetch(`${serverUrl}/api/analyze`, {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Server returned HTTP ${response.status}: ${errorText || response.statusText}`);
  }

  const json = await response.json();
  return json;
}
