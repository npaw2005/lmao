# Stealth Gemini Drop & Copy Prank Webpage 🤫

A single-page stealth web application that looks like a 100% blank white page with zero visible UI elements.

## 🎯 How It Works
1. **The Page**: When opened in any browser, the screen is entirely blank white (`#FFFFFF`).
2. **Status Indicator**: A micro 2x2px pixel sits at the very top-right corner (`top: 0; right: 0;`), invisible unless you look right at it.
   - 🔴 **Red**: Ready for file drop.
   - 🟡 **Amber/Yellow**: File uploaded; waiting for Gemini AI response.
   - 🟢 **Green**: Gemini response received & stored in memory; ready to copy!
   - 🔵 **Cyan/Blue**: Response copied to clipboard upon clicking anywhere.
   - 🟣 **Purple**: Error indicator.
3. **Drag & Drop**: Drag and drop any file (PDF, image, text document, etc.) anywhere onto the white screen. It uploads silently in the background.
4. **Click Anywhere**: Once the indicator turns green, click anywhere on the page to copy the full AI response to your clipboard.

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
```bash
npm start
```

Visit the stealth page at:
👉 **`http://localhost:3000`**

---

## 🕹️ Secret Controls & Tips
- **Toggle Indicator Size**: Press `Shift + P` on the webpage to cycle the top-right indicator pixel size (`2px` → `5px` → `10px` → `2px`) if using a high-DPI (4K/Retina) monitor.
- **File Paste**: You can also press `Ctrl + V` anywhere on the page if you have a file or image copied to your clipboard.
- **Demo Mode**: If no Gemini API key is configured, the server runs in simulated mode so you can test the prank flow immediately without any setup.
