'use strict';

const DEFAULT_SERVER_URL = 'https://niduka.southeastasia.cloudapp.azure.com';

const serverUrlInput = document.getElementById('serverUrl');
const saveBtn = document.getElementById('saveBtn');
const testBtn = document.getElementById('testBtn');
const presetAzure = document.getElementById('presetAzure');
const presetLocal = document.getElementById('presetLocal');
const statusMsg = document.getElementById('statusMessage');

// Load saved settings
document.addEventListener('DOMContentLoaded', async () => {
  const data = await chrome.storage.sync.get({ serverUrl: DEFAULT_SERVER_URL });
  serverUrlInput.value = data.serverUrl || DEFAULT_SERVER_URL;
});

// Quick preset buttons
presetAzure.addEventListener('click', () => {
  serverUrlInput.value = 'https://niduka.southeastasia.cloudapp.azure.com';
});

presetLocal.addEventListener('click', () => {
  serverUrlInput.value = 'http://localhost:3000';
});

// Save settings
saveBtn.addEventListener('click', async () => {
  let url = (serverUrlInput.value || '').trim().replace(/\/+$/, '');
  if (!url) {
    url = DEFAULT_SERVER_URL;
    serverUrlInput.value = url;
  }

  await chrome.storage.sync.set({ serverUrl: url });
  showStatus('Settings saved successfully.', 'var(--success)');
});

// Test connection
testBtn.addEventListener('click', async () => {
  let url = (serverUrlInput.value || '').trim().replace(/\/+$/, '');
  if (!url) {
    showStatus('Please enter a server URL first.', 'var(--error)');
    return;
  }

  showStatus('Testing connection to server...', 'var(--muted)');

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(`${url}/api/health`, {
      method: 'GET',
      signal: controller.signal
    }).catch(async () => {
      // Fallback to root if /api/health isn't available
      return await fetch(`${url}/`, { method: 'GET', signal: controller.signal });
    });
    clearTimeout(timeout);

    if (res && res.ok) {
      try {
        const json = await res.json();
        if (json.status === 'ok') {
          const keyStatus = json.geminiConfigured ? 'API Key Active' : 'API Key Missing';
          showStatus(`Connected! Model: ${json.model} (${keyStatus})`, 'var(--success)');
          return;
        }
      } catch (e) {}
      showStatus(`Connected! Server responded with HTTP ${res.status}.`, 'var(--success)');
    } else if (res) {
      showStatus(`Server reached with HTTP ${res.status}.`, 'var(--accent)');
    } else {
      showStatus(`Could not reach server.`, 'var(--error)');
    }
  } catch (err) {
    showStatus(`Connection failed: ${err.message}`, 'var(--error)');
  }
});

function showStatus(text, color) {
  statusMsg.textContent = text;
  statusMsg.style.color = color;
  clearTimeout(statusMsg._timeout);
  statusMsg._timeout = setTimeout(() => {
    statusMsg.textContent = '';
  }, 4000);
}
