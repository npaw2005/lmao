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
  "Please thoroughly analyze this uploaded PDF document. Provide a comprehensive summary, extract all key facts and insights, and answer any evident questions or problems within the document.";

// Supported models: "gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const PORT = process.env.PORT || 3000;
// =========================================================================

// Ensure local uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
// Serve locally stored PDFs so the Chrome viewer can display them
app.use('/uploads', express.static(uploadsDir));

// Multer disk storage: stores uploaded PDFs locally
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase() || '.pdf';
    const uniqueSuffix = Date.now() + '-' + Math.random().toString(36).substring(2, 8);
    cb(null, 'doc-' + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const mime = file.mimetype;
    // Strictly allow only PDF files
    if (ext === '.pdf' || mime === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type: Only .pdf files are accepted.'));
    }
  }
});

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
app.post('/api/analyze', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      console.warn('[Upload Rejected]:', err.message);
      return res.status(400).json({ success: false, error: err.message });
    }

    try {
      if (!req.file) {
        return res.status(400).json({ success: false, error: 'No PDF file uploaded.' });
      }

      const customPrompt = req.body.prompt || DEFAULT_PROMPT;
      const fileBuffer = fs.readFileSync(req.file.path);
      const base64Data = fileBuffer.toString('base64');
      const fileUrl = `/uploads/${req.file.filename}`;

      console.log(`[Upload] Saved PDF: "${req.file.filename}" (${req.file.size} bytes)`);

      // If API key is still the placeholder, return simulated response for testing
      if (!GEMINI_API_KEY || GEMINI_API_KEY === "YOUR_GEMINI_API_KEY_HERE") {
        console.warn('[Warning] GEMINI_API_KEY is not configured. Returning simulated response for testing.');
        const demoResponse = `[SIMULATED GEMINI RESPONSE - Ready for Prank!]\n\n` +
          `File: "${req.file.originalname}" (${(req.file.size / 1024).toFixed(1)} KB)\n` +
          `Stored locally at: ${fileUrl}\n\n` +
          `Prompt: "${customPrompt}"\n\n` +
          `Everything is working smoothly!\n` +
          `- PDF is saved locally and rendered in the Chrome viewer.\n` +
          `- Status indicator turned green.\n` +
          `- Invisible overlay captured your click and copied this text to your clipboard!\n\n` +
          `To get real AI responses from Google Gemini:\n` +
          `1. Replace "YOUR_GEMINI_API_KEY_HERE" in server.js or set GEMINI_API_KEY in your .env file.\n` +
          `2. Restart the server!`;

        // Simulate realistic network delay (800ms)
        await new Promise(r => setTimeout(r, 800));

        return res.json({
          success: true,
          response: demoResponse,
          fileUrl: fileUrl,
          filename: req.file.filename,
          mock: true
        });
      }

      // Call official Gemini REST API with the PDF inlineData
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

      const geminiPayload = {
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType: 'application/pdf',
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

      console.log(`[Gemini] Calling ${GEMINI_MODEL} for PDF analysis...`);
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
          details: errorText,
          fileUrl: fileUrl
        });
      }

      const data = await apiResponse.json();
      const generatedText = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || 'No response text received from Gemini.';

      console.log(`[Gemini] Successfully received response (${generatedText.length} characters).`);

      return res.json({
        success: true,
        response: generatedText,
        fileUrl: fileUrl,
        filename: req.file.filename
      });

    } catch (innerErr) {
      console.error('[Server Error]:', innerErr);
      return res.status(500).json({
        success: false,
        error: innerErr.message || 'Internal server error'
      });
    }
  });
});

// Fallback to index.html
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(` Stealth PDF Viewer Server running at:`);
  console.log(` -> http://localhost:${PORT}`);
  console.log(`=======================================================`);
  if (!GEMINI_API_KEY || GEMINI_API_KEY === "YOUR_GEMINI_API_KEY_HERE") {
    console.log(` [NOTE] Running in DEMO mode with simulated responses.`);
    console.log(` Add your Gemini API key in server.js or .env to activate live AI.`);
  } else {
    console.log(` [OK] Gemini API Key configured for model: ${GEMINI_MODEL}`);
  }
  console.log(` Uploads directory: ${uploadsDir}`);
  console.log(`=======================================================`);
});
