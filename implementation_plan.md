# Implementation Plan: Stealth Gemini Drop & Copy Prank Webpage

## 1. Project Overview
A single-page "stealth" web application that appears as a completely blank, pure white screen.
- Dragging and dropping any document (e.g., PDF, image, text) silently uploads the file to the backend.
- The backend forwards the document along with a custom prompt to the Google Gemini API.
- The frontend silently receives the response without rendering any visible UI.
- A single micro-pixel at the top-right corner indicates system status via color codes.
- Clicking anywhere on the screen copies the full Gemini response directly to the user's clipboard.

---

## 2. Status Pixel State Machine Protocol
Positioned at `fixed; top: 0; right: 0; width: 2px; height: 2px; pointer-events: none;`.

| State | Pixel Color | Hex Code | Description |
|---|---|---|---|
| `IDLE` | Red | `#FF0000` | Ready for file upload; no response cached yet. |
| `PROCESSING` | Amber / Yellow | `#FFBF00` | File received; uploading to Gemini & awaiting AI response. |
| `READY_TO_COPY` | Green | `#00FF00` | Response received & stored in memory; click anywhere to copy. |
| `COPIED` | Cyan / Blue | `#00D4FF` | Response successfully copied to clipboard (persists or pulses). |
| `ERROR` | Purple / Magenta | `#800080` | Upload or Gemini API error (silent to UI, logged to DevTools console). |

---

## 3. Technology Stack
- **Runtime & Server**: Node.js v24 + Express.js.
- **File Uploads**: `multer` with in-memory storage (no unnecessary disk writes for privacy & speed).
- **Gemini API Integration**: Native REST API call with inline base64 data for files / `@google/genai` SDK, fallback support, configurable models (`gemini-2.5-flash`, `gemini-1.5-flash`, etc.).
- **Frontend**: Pure vanilla HTML5 / CSS3 / ES6 (zero external frameworks or CSS dependencies, guaranteed instantaneous zero-footprint load).
- **Clipboard API**: `navigator.clipboard.writeText` with textarea fallback for older browsers or non-secure contexts.

---

## 4. Architecture & Data Flow

```
[User Browser: Pure White Screen]
         |
         | (1) Drag-and-drop file anywhere
         v
[POST /api/analyze (multipart/form-data)]
         |
         | (2) Read file buffer into Base64 + MimeType
         v
[Google Gemini API: generateContent]
         | (Payload: inlineData + Prompt)
         |
         v
[Gemini Response: Generated Text]
         |
         | (3) JSON { success: true, response: text }
         v
[Frontend Memory: window._cachedResponse = text]
         |
         | (4) Pixel turns GREEN (#00FF00)
         v
[User Clicks Screen Anywhere]
         |
         | (5) navigator.clipboard.writeText(...)
         v
[Pixel turns CYAN (#00D4FF) -> Copied to Clipboard!]
```

---

## 5. Backend Configuration & Placeholders
The backend supports both direct hardcoding (as requested for quick personal prank use) and `.env` overrides:
- `GEMINI_API_KEY`: Placeholder string `"PASTE_YOUR_GEMINI_API_KEY_HERE"` or `process.env.GEMINI_API_KEY`.
- `SYSTEM_PROMPT`: Configurable default prompt placeholder (e.g., `"Summarize this document thoroughly and extract key insights."` or custom prank prompt).
- `GEMINI_MODEL`: Default `"gemini-2.5-flash"` (fast, generous token limits, native PDF support).
- `PORT`: Default `3000`.

---

## 6. Implementation Steps
1. **Initialize Git & Repository Setup**:
   - Repository already initialized (`git init`).
   - Create `.gitignore` to prevent leaking keys and ignore `node_modules`.
2. **Backend Server (`server.js`)**:
   - Initialize `package.json` with `express`, `multer`, `cors`, `dotenv`.
   - Setup `/api/analyze` endpoint accepting single file `file`.
   - Implement Gemini multimodal API caller supporting PDF, text, and image MIME types.
   - Serve static assets from `public/`.
3. **Frontend (`public/index.html`)**:
   - Pure white CSS (`#ffffff`).
   - 2x2px status indicator pixel in top-right corner.
   - Global dragover, drop, and paste event handlers.
   - Global click event handler for clipboard copy.
4. **Verification & Testing**:
   - Test drag-and-drop event handling.
   - Test mock / live Gemini responses.
   - Test clipboard copying across browsers.
   - Ensure zero visible UI elements or scrollbars.
