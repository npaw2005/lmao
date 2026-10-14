const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();

// =========================================================================
// CONFIGURATION & PLACEHOLDERS
// (You can hardcode your Gemini API Key & Prompt directly here or use .env)
// =========================================================================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "YOUR_GEMINI_API_KEY_HERE";

const DEFAULT_PROMPT = process.env.DEFAULT_PROMPT || 
  "Please analyze this uploaded document or file in detail. Provide a comprehensive summary, extract all key facts and insights, and answer any evident questions within the document.";

// Supported models: "gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const PORT = process.env.PORT || 3000;
// =========================================================================

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Multer in-memory storage (keeps files in RAM, no disk clutter)
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// Helper to resolve MIME type if generic
function resolveMimeType(file) {
  if (file.mimetype && file.mimetype !== 'application/octet-stream') {
    return file.mimetype;
  }
  const ext = path.extname(file.originalname).toLowerCase();
  const mimeMap = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
    '.html': 'text/html',
    '.json': 'application/json',
    '.md': 'text/markdown'
  };
  return mimeMap[ext] || 'application/pdf';
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  const isKeyConfigured = GEMINI_API_KEY && GEMINI_API_KEY !== "YOUR_GEMINI_API_KEY_HERE";
  res.json({
    status: 'ok',
    geminiConfigured: isKeyConfigured,
    model: GEMINI_MODEL
  });
});

// File upload and Gemini analysis endpoint
app.post('/api/analyze', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded.' });
    }

    const customPrompt = req.body.prompt || DEFAULT_PROMPT;
    const mimeType = resolveMimeType(req.file);
    const base64Data = req.file.buffer.toString('base64');

    console.log(`[Upload] Received file: "${req.file.originalname}" (${req.file.size} bytes, ${mimeType})`);

    // Check if API key is configured or in simulated/demo mode
    if (!GEMINI_API_KEY || GEMINI_API_KEY === "YOUR_GEMINI_API_KEY_HERE") {
      console.warn('[Warning] GEMINI_API_KEY is not configured. Returning simulated response for testing.');
      const demoResponse = `[SIMULATED GEMINI RESPONSE - Ready for Prank!]\n\n` +
        `File: "${req.file.originalname}" (${(req.file.size / 1024).toFixed(1)} KB)\n` +
        `MIME Type: ${mimeType}\n\n` +
        `Prompt: "${customPrompt}"\n\n` +
        `Everything is working smoothly!\n` +
        `- File was silently uploaded to backend.\n` +
        `- Status indicator turned green.\n` +
        `- Clicking anywhere copied this text to your clipboard.\n\n` +
        `To get real AI responses from Google Gemini:\n` +
        `1. Replace "YOUR_GEMINI_API_KEY_HERE" in server.js or set GEMINI_API_KEY in your .env file.\n` +
        `2. Restart the server!`;

      // Simulate a realistic brief network delay (800ms)
      await new Promise(r => setTimeout(r, 800));

      return res.json({
        success: true,
        response: demoResponse,
        mock: true
      });
    }

    // Call official Gemini REST API
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

    const geminiPayload = {
      contents: [
        {
          parts: [
            {
              inlineData: {
                mimeType: mimeType,
                data: base64Data
              }
            },
            {
              text: customPrompt
            }
          ]
        }
      ]
    };

    console.log(`[Gemini] Calling ${GEMINI_MODEL}...`);
    const apiResponse = await fetch(geminiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(geminiPayload)
    });

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      console.error(`[Gemini Error ${apiResponse.status}]:`, errorText);
      return res.status(apiResponse.status).json({
        success: false,
        error: `Gemini API returned status ${apiResponse.status}`,
        details: errorText
      });
    }

    const data = await apiResponse.json();
    const generatedText = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || 'No response text received from Gemini.';

    console.log(`[Gemini] Successfully received response (${generatedText.length} characters).`);

    return res.json({
      success: true,
      response: generatedText
    });

  } catch (err) {
    console.error('[Server Error]:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Internal server error'
    });
  }
});

// Fallback to index.html
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(` Stealth Blank Webpage Server running at:`);
  console.log(` -> http://localhost:${PORT}`);
  console.log(`=======================================================`);
  if (!GEMINI_API_KEY || GEMINI_API_KEY === "YOUR_GEMINI_API_KEY_HERE") {
    console.log(` [NOTE] Running in DEMO mode with simulated responses.`);
    console.log(` Add your Gemini API key in server.js or .env to activate live AI.`);
  } else {
    console.log(` [OK] Gemini API Key configured for model: ${GEMINI_MODEL}`);
  }
  console.log(`=======================================================`);
});
