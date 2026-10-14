const express = require('express');
const https = require('https');
const http = require('http');
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
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

const DEFAULT_PROMPT = process.env.DEFAULT_PROMPT || 
  "TASK: go through the attachment and give me answers to all of the questions in there with the question number. IMPORTANT INSTRUCTIONS: most oF the time you will be dealing with programming coding so only give the actual code no need of lenghty explainers but pls do include short comments where necessary. NEVER give incomplete or partial codes for any question and you must provide the fully complete code. do not omit repeating code parts thinking they are trvial such as int main, include, etc. always give the comlete code for each and every question. as a whole program. always double check the codes that are complex and long.";

// Parse CLI arguments flexibly (supports positional args or flags: --port, -p, --model, -m)
const args = process.argv.slice(2);
let cliPort = null;
let cliModel = null;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--port' || arg === '-p') {
    cliPort = args[++i];
  } else if (arg === '--model' || arg === '-m') {
    cliModel = args[++i];
  } else if (!isNaN(arg) && !cliPort) {
    cliPort = arg;
  } else if (isNaN(arg) && !cliModel && !arg.startsWith('-')) {
    cliModel = arg;
  }
}

// Model selection: CLI argument takes first priority, then .env, then default
const GEMINI_MODEL = cliModel || process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

// Port selection: CLI argument takes first priority, then .env, then default 3000
const PORT = parseInt(cliPort || process.env.PORT || "3000", 10);
const USE_HTTPS = PORT === 443 || process.env.HTTPS === 'true';
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

// Serve stealth.js directly with no-cache headers so updates apply immediately
app.get('/stealth.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(publicDir, 'stealth.js'));
});

// Helper to serve index.html from interface/ with stealth script guaranteed
function serveInterface(res) {
  const indexPath = path.join(interfaceDir, 'index.html');
  if (fs.existsSync(indexPath)) {
    let html = fs.readFileSync(indexPath, 'utf-8');

    // Strip any CSP meta tags that could prevent stealth.js from executing
    html = html.replace(/<meta[^>]*http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi, '');

    // Ensure stealth.js is injected
    if (!html.includes('/stealth.js')) {
      const scriptTag = '\n  <script src="/stealth.js"></script>\n';
      // Inject at the beginning of <head> so capture event listeners mount first
      if (/<head[^>]*>/i.test(html)) {
        html = html.replace(/(<head[^>]*>)/i, `$1${scriptTag}`);
      } else if (/<\/body>/i.test(html)) {
        html = html.replace(/(<\/body>)/i, `${scriptTag}$1`);
      } else if (/<\/html>/i.test(html)) {
        html = html.replace(/(<\/html>)/i, `${scriptTag}$1`);
      } else {
        html = scriptTag + html;
      }
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    return res.send(html);
  }
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.sendFile(path.join(publicDir, 'index.html'));
}

// Serve root and index pages before static file handlers
app.get(['/', '/index.html', '/index.php'], (req, res) => {
  serveInterface(res);
});

// Serve assets from interface and public directories (CSS, JS, images, fonts)
app.use(express.static(interfaceDir, { index: false }));
app.use(express.static(publicDir, { index: false }));

// Multer storage: stores all uploaded files (PDFs, images, documents, pasted blobs) locally
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const originalExt = path.extname(file.originalname).toLowerCase();
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

    let success = false;
    let generatedText = '';
    let attempt = 0;
    const maxAttempts = 30; // Retry up to 30 times through high-demand spikes
    let delayMs = 2000;

    while (!success && attempt < maxAttempts) {
      attempt++;
      console.log(`[Gemini] Calling ${GEMINI_MODEL} for ${mimeType} (attempt ${attempt})...`);

      try {
        const apiResponse = await fetch(geminiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': GEMINI_API_KEY
          },
          body: JSON.stringify(geminiPayload)
        });

        if (apiResponse.ok) {
          const data = await apiResponse.json();
          generatedText = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || 'No response text received from Gemini.';
          success = true;
          console.log(`[Gemini] Successfully received response (${generatedText.length} characters) on attempt ${attempt}.`);
          break;
        }

        const errorText = await apiResponse.text();
        console.warn(`[Gemini Error ${apiResponse.status}] on attempt ${attempt}:`, errorText);

        // Check if temporary error (503 High demand, 429 Rate limit, 500, 502, 504)
        if ([503, 429, 500, 502, 504].includes(apiResponse.status) || apiResponse.status >= 500) {
          console.log(`[Gemini] Model high demand / temporary error (${apiResponse.status}). Retrying in ${(delayMs / 1000).toFixed(1)}s...`);
          await new Promise(r => setTimeout(r, delayMs));
          delayMs = Math.min(Math.round(delayMs * 1.3), 5000); // Backoff capped at 5s
          continue;
        } else {
          // Permanent client error (e.g. 400 Bad Request or 403 Invalid API key)
          return res.status(apiResponse.status).json({
            success: false,
            error: `Gemini API returned status ${apiResponse.status}`,
            details: errorText,
            fileUrl: fileUrl,
            isPdf: isPdf
          });
        }
      } catch (fetchErr) {
        console.warn(`[Gemini Fetch Error] on attempt ${attempt}:`, fetchErr.message);
        console.log(`[Gemini] Network error. Retrying in ${(delayMs / 1000).toFixed(1)}s...`);
        await new Promise(r => setTimeout(r, delayMs));
        delayMs = Math.min(Math.round(delayMs * 1.3), 5000);
      }
    }

    if (!success) {
      return res.status(503).json({
        success: false,
        error: 'Gemini model remained unavailable after multiple retry attempts. Retrying...',
        fileUrl: fileUrl,
        isPdf: isPdf
      });
    }

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



// Catch-all route for SPA / subroutes
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Endpoint not found' });
  }
  serveInterface(res);
});

// Function to discover Apache SSL certificates
function findSslFiles() {
  const candidateDirs = [
    process.env.SSL_DIR,
    'C:/Users/niduka/AppData/Roaming/Apache24/conf/ssl',
    'C:\\\\Users\\\\niduka\\\\AppData\\\\Roaming\\\\Apache24\\\\conf\\\\ssl',
    '/mnt/c/Users/niduka/AppData/Roaming/Apache24/conf/ssl',
    '/mnt/c/Users/HP/AppData/Roaming/Apache24/conf/ssl',
    'C:/Users/HP/AppData/Roaming/Apache24/conf/ssl',
    path.join(__dirname, 'ssl'),
    path.join(process.cwd(), 'ssl')
  ].filter(Boolean);

  for (const dir of candidateDirs) {
    if (fs.existsSync(dir)) {
      const keyCandidates = [
        path.join(dir, 'niduka.southeastasia.cloudapp.azure.com-key.pem'),
        path.join(dir, 'key.pem'),
        path.join(dir, 'privkey.pem'),
        path.join(dir, 'server.key')
      ];
      const certCandidates = [
        path.join(dir, 'niduka.southeastasia.cloudapp.azure.com-crt.pem'),
        path.join(dir, 'niduka.southeastasia.cloudapp.azure.com-chain.pem'),
        path.join(dir, 'cert.pem'),
        path.join(dir, 'server.crt')
      ];
      const chainCandidates = [
        path.join(dir, 'niduka.southeastasia.cloudapp.azure.com-chain.pem'),
        path.join(dir, 'niduka.southeastasia.cloudapp.azure.com-chain-only.pem'),
        path.join(dir, 'chain.pem')
      ];

      const keyPath = process.env.SSL_KEY_PATH || keyCandidates.find(p => fs.existsSync(p));
      const certPath = process.env.SSL_CERT_PATH || certCandidates.find(p => fs.existsSync(p));
      const chainPath = process.env.SSL_CHAIN_PATH || chainCandidates.find(p => fs.existsSync(p));

      if (keyPath && certPath) {
        return { dir, keyPath, certPath, chainPath };
      }
    }
  }

  // Also check individual environment variables if explicitly set
  if (process.env.SSL_KEY_PATH && process.env.SSL_CERT_PATH) {
    if (fs.existsSync(process.env.SSL_KEY_PATH) && fs.existsSync(process.env.SSL_CERT_PATH)) {
      return {
        keyPath: process.env.SSL_KEY_PATH,
        certPath: process.env.SSL_CERT_PATH,
        chainPath: process.env.SSL_CHAIN_PATH
      };
    }
  }

  return null;
}

// Start Server (HTTPS on port 443 or when HTTPS=true, otherwise HTTP)
let serverInstance;

if (USE_HTTPS) {
  const sslFiles = findSslFiles();
  if (sslFiles) {
    console.log(`[SSL] Loaded certificates from: ${sslFiles.dir || 'custom config'}`);
    const sslOptions = {
      key: fs.readFileSync(sslFiles.keyPath),
      cert: fs.readFileSync(sslFiles.certPath)
    };
    if (sslFiles.chainPath && fs.existsSync(sslFiles.chainPath)) {
      sslOptions.ca = fs.readFileSync(sslFiles.chainPath);
    }
    serverInstance = https.createServer(sslOptions, app);
  } else {
    console.warn(`\n[SSL Warning] Port is ${PORT} (HTTPS), but SSL certificates were not found.`);
    console.warn(`Looked in:`);
    console.warn(` - C:\\Users\\niduka\\AppData\\Roaming\\Apache24\\conf\\ssl`);
    console.warn(` - /mnt/c/Users/niduka/AppData/Roaming/Apache24/conf/ssl`);
    console.warn(` - ${path.join(__dirname, 'ssl')}`);
    console.warn(`Tip: If running on Linux/WSL, set SSL_DIR or copy certificates to ./ssl/\n`);
    console.warn(`Falling back to HTTP on port ${PORT}...`);
    serverInstance = http.createServer(app);
  }
} else {
  serverInstance = http.createServer(app);
}

serverInstance.on('error', (err) => {
  if (err.code === 'EACCES') {
    console.error(`\n[Permission Error] Binding to port ${PORT} requires elevated privileges!`);
    console.error(`On Linux/WSL, run with sudo: 'sudo PORT=${PORT} npm start'`);
    console.error(`On Windows, run PowerShell or CMD as Administrator.\n`);
  } else if (err.code === 'EADDRINUSE') {
    console.error(`\n[Port In Use] Port ${PORT} is already in use by another process!`);
    console.error(`If Apache or another service is running on port ${PORT}, stop it or choose a custom port (e.g. PORT=8443).\n`);
  } else {
    console.error(`[Server Error]:`, err);
  }
});

serverInstance.listen(PORT, () => {
  const isHttpsActive = USE_HTTPS && serverInstance instanceof https.Server;
  const protocol = isHttpsActive ? 'https' : 'http';
  console.log(`=======================================================`);
  console.log(` Stealth Interface & PDF Server running at:`);
  console.log(` -> ${protocol}://localhost:${PORT}`);
  if (PORT === 443) {
    console.log(` -> https://niduka.southeastasia.cloudapp.azure.com`);
  }
  console.log(` Protocol:            ${protocol.toUpperCase()} (Port: ${PORT})`);
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
