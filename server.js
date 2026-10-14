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
  "Please thoroughly analyze this uploaded document or file in detail. Provide a comprehensive summary, extract all key facts and insights, and answer any evident questions or problems within the document.";

// Supported models: "gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const PORT = process.env.PORT || 3000;
// =========================================================================

// Ensure directories exist
const uploadsDir = path.join(__dirname, 'uploads');
const interfaceDir = path.join(__dirname, 'interface');
const publicDir = path.join(__dirname, 'public');

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(interfaceDir)) fs.mkdirSync(interfaceDir, { recursive: true });
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });

app.use(cors());
app.use(express.json());

// Serve uploads statically
app.use('/uploads', express.static(uploadsDir));

// Serve stealth.js
app.get('/stealth.js', (req, res) => {
  res.sendFile(path.join(publicDir, 'stealth.js'));
});

// Serve assets from interface directory
app.use(express.static(interfaceDir));
app.use(express.static(publicDir));

// Multer storage: stores all uploaded files (PDFs, images, documents, pasted blobs) locally
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const originalExt = path.extname(file.originalname).toLowerCase();
    // Default fallback extension based on mimetype
    let ext = originalExt;
    if (!ext) {
      if (file.mimetype === 'application/pdf') ext = '.pdf';
      else if (file.mimetype === 'image/png') ext = '.png';
      else if (file.mimetype === 'image/jpeg') ext = '.jpg';
      else if (file.mimetype === 'image/webp') ext = '.webp';
      else ext = '.bin';
    }
    const uniqueSuffix = Date.now() + '-' + Math.random().toString(36).substring(2, 8);
    cb(null, 'file-' + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

// Helper to resolve accurate MIME types
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
    '.gif': 'image/gif',
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

// File upload and Gemini analysis endpoint (accepts PDFs, images, text, and clipboard pastes)
app.post('/api/analyze', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded.' });
    }

    const mimeType = resolveMimeType(req.file);
    const isPdf = mimeType === 'application/pdf' || req.file.originalname.toLowerCase().endsWith('.pdf');
    const customPrompt = req.body.prompt || DEFAULT_PROMPT;
    const fileBuffer = fs.readFileSync(req.file.path);
    const base64Data = fileBuffer.toString('base64');
    const fileUrl = `/uploads/${req.file.filename}`;

    console.log(`[Upload] Stored file: "${req.file.filename}" (${req.file.size} bytes, MIME: ${mimeType}, isPdf: ${isPdf})`);

    // If API key is still the placeholder, return simulated response for testing
    if (!GEMINI_API_KEY || GEMINI_API_KEY === "YOUR_GEMINI_API_KEY_HERE") {
      console.warn('[Warning] GEMINI_API_KEY is not configured. Returning simulated response for testing.');
      const demoResponse = `[SIMULATED GEMINI RESPONSE - Ready for Prank!]\n\n` +
        `File: "${req.file.originalname}" (${(req.file.size / 1024).toFixed(1)} KB)\n` +
        `MIME Type: ${mimeType}\n` +
        `Stored locally at: ${fileUrl}\n\n` +
        `Prompt: "${customPrompt}"\n\n` +
        `Everything is working smoothly!\n` +
        (isPdf ? `- PDF was detected and rendered in Chrome's native viewer.\n` : `- Non-PDF file (${mimeType}) received gracefully while mock interface remained active.\n`) +
        `- Status indicator turned green.\n` +
        `- Clicking anywhere copied this text to your clipboard!\n\n` +
        `To get real AI responses from Google Gemini:\n` +
        `1. Replace "YOUR_GEMINI_API_KEY_HERE" in server.js or set GEMINI_API_KEY in your .env file.\n` +
        `2. Restart the server!`;

      // Simulate network delay
      await new Promise(r => setTimeout(r, 800));

      return res.json({
        success: true,
        response: demoResponse,
        fileUrl: fileUrl,
        filename: req.file.filename,
        isPdf: isPdf,
        mimeType: mimeType,
        mock: true
      });
    }

    // Call official Gemini REST API
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

    // Prepare content parts based on MIME type
    let part;
    if (mimeType.startsWith('image/') || mimeType === 'application/pdf') {
      part = {
        inlineData: {
          mimeType: mimeType,
          data: base64Data
        }
      };
    } else {
      // For text-based formats (txt, json, csv, md, etc.)
      const textContent = fileBuffer.toString('utf-8');
      part = {
        text: `[Attached File: ${req.file.originalname}]\n\n${textContent}`
      };
    }

    const geminiPayload = {
      contents: [
        {
          parts: [
            part,
            {
              text: customPrompt
            }
          ]
        }
      ]
    };

    console.log(`[Gemini] Calling ${GEMINI_MODEL} for ${mimeType}...`);
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
        fileUrl: fileUrl,
        isPdf: isPdf
      });
    }

    const data = await apiResponse.json();
    const generatedText = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || 'No response text received from Gemini.';

    console.log(`[Gemini] Successfully received response (${generatedText.length} characters).`);

    return res.json({
      success: true,
      response: generatedText,
      fileUrl: fileUrl,
      filename: req.file.filename,
      isPdf: isPdf,
      mimeType: mimeType
    });

  } catch (err) {
    console.error('[Server Error]:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Internal server error'
    });
  }
});

// Helper to serve index.html from interface/ with stealth script guaranteed
function serveInterface(res) {
  const indexPath = path.join(interfaceDir, 'index.html');
  if (fs.existsSync(indexPath)) {
    let html = fs.readFileSync(indexPath, 'utf-8');
    if (!html.includes('/stealth.js')) {
      html = html.replace('</body>', '<script src="/stealth.js"></script></body>');
    }
    return res.send(html);
  }
  // Fallback to public/index.html if interface/index.html is missing
  res.sendFile(path.join(publicDir, 'index.html'));
}

// Root and wildcard route: serves interface/index.html
app.get('/', (req, res) => {
  serveInterface(res);
});

app.use((req, res) => {
  serveInterface(res);
});

app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(` Stealth Interface & PDF Server running at:`);
  console.log(` -> http://localhost:${PORT}`);
  console.log(`=======================================================`);
  console.log(` Interface directory: ${interfaceDir}`);
  console.log(` Uploads directory:   ${uploadsDir}`);
  if (!GEMINI_API_KEY || GEMINI_API_KEY === "YOUR_GEMINI_API_KEY_HERE") {
    console.log(` [NOTE] Running in DEMO mode with simulated responses.`);
    console.log(` Add your Gemini API key in server.js or .env to activate live AI.`);
  } else {
    console.log(` [OK] Gemini API Key configured for model: ${GEMINI_MODEL}`);
  }
  console.log(`=======================================================`);
});
