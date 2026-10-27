# Stealth Gemini Drop & Copy Prank Webpage 🤫

A single-page stealth web application that looks like a 100% blank white page with zero visible UI elements.

## 🎯 How It Works
1. **The Camouflage Interface**:
   - Accessing `http://localhost:3000` loads the mock website from the [`interface/`](interface/index.html) directory (a modern, realistic engineering documentation and workspace portal).
   - You can customize or replace [`interface/index.html`](interface/index.html) with any mock website you want.
2. **Accepts Any File & Clipboard Pastes**:
   - **PDF Files**: When a `.pdf` is dropped, it switches full-screen to Chrome's native PDF viewer.
   - **Non-PDF Files (PNG, JPG, TXT, etc.)**: When dropped or pasted from clipboard (`Ctrl + V`), the mock interface **stays active**, allowing you to keep scrolling and reading naturally.
   - All files are saved locally in `./uploads/` and sent gracefully to Gemini.
3. **Status Indicator**: A micro 2x2px pixel sits at the very top-right corner (`top: 0; right: 0;`):
   - 🔴 **Red**: Ready for file drop or clipboard paste.
   - 🟡 **Amber/Yellow**: File uploaded; Gemini AI is analyzing the document or image.
   - 🟢 **Green**: Gemini response received & stored in memory; ready to copy!
   - 🔵 **Cyan/Blue**: Response copied to clipboard upon clicking anywhere.
   - 🟣 **Purple**: Upload error.
4. **Invisible Click-to-Copy Overlay & Scrolling**:
   - When the status pixel turns **Green**, an invisible overlay activates over the page.
   - Clicking anywhere on the screen copies the full AI response to your clipboard!
   - It flashes **Cyan**, then unlocks pointer events so you can scroll and read the page/PDF naturally.
   - Automatically re-arms after 3 seconds so subsequent clicks can copy again.

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Your Gemini API Key & Prompt
Open [`server.js`](server.js#L12-L21) and paste your Gemini API Key and desired prompt directly into the placeholders:

```javascript
// In server.js:
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "YOUR_GEMINI_API_KEY_HERE";

const DEFAULT_PROMPT = process.env.DEFAULT_PROMPT || 
  "Please analyze this uploaded document or file in detail. Provide a comprehensive summary, extract all key facts and insights, and answer any evident questions within the document.";

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
```

*(Alternatively, you can copy `.env.example` to `.env` and set `GEMINI_API_KEY` there!)*

### 3. Run the Server

**Standard Port (3000):**
```bash
npm start
```

**Custom Port, Model, and/or Camouflage URL:**
```bash
# Pass custom port, model, and custom camouflage URL in any order:
node server.js 8080 gemini-2.5-flash https://www.youtube.com

# Or launch with a custom URL on default port 3000:
node server.js https://www.youtube.com

# Or pass custom model on port 3000:
node server.js gemini-flash-latest

# Or using explicit flags:
node server.js --port 8080 --model gemini-3.5-flash-lite --url https://www.youtube.com
# Short flags:
node server.js -p 8080 -m gemini-3.5-flash-lite -u https://www.youtube.com
```

**HTTPS on Port 443 with Apache SSL Certs:**
```bash
# On Windows (Run as Administrator):
node server.js 443 gemini-3.5-flash-lite https://www.youtube.com

# On Linux/WSL (Run with sudo for ports < 1024):
sudo node server.js 443 gemini-3.5-flash-lite https://www.youtube.com
```
The server will automatically discover your Apache SSL certificates from:
`C:\Users\niduka\AppData\Roaming\Apache24\conf\ssl` (or `/mnt/c/Users/...`, or `./ssl/`).
Once loaded, you can access the page securely over HTTPS:
👉 **`https://localhost`** or **`https://niduka.southeastasia.cloudapp.azure.com`**

---

## 🧩 Chrome Manifest V3 Extension (Universal Stealth Mode)

Instead of running an iframe or proxy server for camouflage, you can use the **Chrome MV3 Extension** (`extension/`). This allows you to browse **any real website natively** (YouTube, Moodle, Wikipedia, Google Docs, etc.) with full login state, zero `X-Frame-Options` blocks, and zero proxy latency. The remote server acts solely as an API middleman.

### 🌟 Advantages Over Iframe / Reverse Proxy:
1. **Real Native Webpages**: Never breaks logins, sessions, OAuth, or modern web apps.
2. **Zero CORS or Navigation Errors**: Never triggers `refused to connect` or CSP errors.
3. **Completely On-Demand**: Triggered on any page by pressing <kbd>Alt + Q</kbd> or clicking the extension icon.
4. **Transparent on First Load**: The top-right micro indicator stays invisible until armed with <kbd>Alt + Q</kbd>.

### 📥 How to Install the Extension:
1. Open Google Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked**.
4. Select the `extension/` folder inside this repository.
5. *(Optional)* Right-click the extension icon in Chrome toolbar -> **Options** to configure your server URL (default: `https://niduka.southeastasia.cloudapp.azure.com` or `http://localhost:3000`).

### 🎮 Extension Controls:
- **<kbd>Alt + Q</kbd>** (or click toolbar icon): Arm/Disarm stealth mode on the current tab. Flashes a subtle amber pulse on arm, then stays transparent.
- **<kbd>Ctrl + V</kbd> or Drag & Drop**: Send screenshot, PDF, image, or copied text to Gemini AI.
- **Indicator Pixel States**:
  - Transparent: Idle / Ready.
  - 🟡 **Amber**: Uploading & AI analyzing.
  - 🟢 **Green**: Response ready!
  - 🔵 **Cyan**: Clicked anywhere and copied response to clipboard.
  - 🔴 **Red**: Network or processing error (clears automatically).
- **<kbd>Shift + P</kbd>**: Cycle indicator pixel size (`2px` → `5px` → `10px`).
- **Left Click**: When indicator turns green, clicking anywhere silently copies the AI response to your clipboard.

---

## 🕹️ Secret Controls & Tips
- **Toggle Indicator Size**: Press `Shift + P` on the webpage to cycle the top-right indicator pixel size (`2px` → `5px` → `10px` → `2px`) if using a high-DPI (4K/Retina) monitor.
- **File Paste**: You can also press `Ctrl + V` anywhere on the page if you have a file or image copied to your clipboard.
- **Demo Mode**: If no Gemini API key is configured, the server runs in simulated mode so you can test the prank flow immediately without any setup.
