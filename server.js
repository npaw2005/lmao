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
  "TASK: You are an expert examination assistant. Analyze the provided question and multiple-choice options (provided as text or attachment).\n" +
  "Determine the correct answer.\n" +
  "CRITICAL INSTRUCTIONS:\n" +
  "1. Output ONLY the number (e.g. 1, 2, 3, 4) or letter (e.g. A, B, C, D) corresponding to the single correct option.\n" +
  "2. Do NOT provide any explanation, working, reasoning, markdown formatting, or words.\n" +
  "3. If multiple separate questions are present, output only the question number and correct answer number/letter separated by a comma (e.g. 1-A, 2-C).\n" +
  "Your entire output must strictly be only the answer number or letter.";

// Helper to extract the core MCQ answer number/letter from AI response
function extractAnswer(rawText) {
  if (!rawText) return '';
  let text = rawText.trim();
  // Strip markdown formatting like **1** or `B` or *3*
  text = text.replace(/[\*\_`#]/g, '').trim();
  text = text.replace(/^(?:Option|Choice|Answer|Correct answer is)\s*[:\-]?\s*/i, '').trim();

  // If already short (e.g. "1", "2", "A", "B", "1-A, 2-C"):
  if (text.length <= 10) {
    return text.replace(/\.$/, '').trim();
  }

  // Look for patterns like "Option 2", "Answer: 3", "Answer: B", "3."
  const patterns = [
    /(?:correct\s+)?(?:answer|option|choice)(?:\s+is|\s*:)?\s*([0-9A-Za-z])/i,
    /^([0-9A-Za-z])[\.\)\:]\s+/m,
    /\b([0-9A-Za-z])\b/
  ];

  for (const pat of patterns) {
    const match = text.match(pat);
    if (match && match[1]) {
      return match[1].toUpperCase();
    }
  }

  return text.slice(0, 10).trim();
}

// Parse CLI arguments flexibly (supports positional args or flags: --port, -p, --model, -m, --url, -u, --target, -t)
const args = process.argv.slice(2);
let cliPort = null;
let cliModel = null;
let cliUrl = null;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--port' || arg === '-p') {
    cliPort = args[++i];
  } else if (arg === '--model' || arg === '-m') {
    cliModel = args[++i];
  } else if (arg === '--url' || arg === '-u' || arg === '--target' || arg === '-t') {
    cliUrl = args[++i];
  } else if (!isNaN(arg) && !cliPort) {
    cliPort = arg;
  } else if ((arg.startsWith('http://') || arg.startsWith('https://')) && !cliUrl) {
    cliUrl = arg;
  } else if (isNaN(arg) && !cliModel && !arg.startsWith('-')) {
    cliModel = arg;
  }
}

// Model selection: CLI argument takes first priority, then .env, then default
const GEMINI_MODEL = cliModel || process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

// Port selection: CLI argument takes first priority, then .env, then default 3000
const PORT = parseInt(cliPort || process.env.PORT || "3000", 10);
const USE_HTTPS = PORT === 443 || process.env.HTTPS === 'true';

// Optional custom camouflage URL: CLI argument takes first priority, then .env, then empty
const TARGET_URL = cliUrl || process.env.TARGET_URL || process.env.CUSTOM_URL || "";
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

// Reverse proxy endpoint to allow embedding ANY external website inside an iframe without X-Frame-Options or CSP blocks
app.all('/proxy', async (req, res) => {
  const target = req.query.url || TARGET_URL;
  if (!target) return res.status(400).send('Missing target URL');

  // Allow CORS so iframe scripts can communicate seamlessly
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  try {
    const fetchOptions = {
      method: req.method,
      headers: {
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': req.headers['accept'] || '*/*',
        'Accept-Language': req.headers['accept-language'] || 'en-US,en;q=0.9'
      }
    };

    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
      if (typeof req.body === 'object') {
        fetchOptions.body = JSON.stringify(req.body);
        fetchOptions.headers['Content-Type'] = 'application/json';
      } else {
        fetchOptions.body = req.body;
      }
    }

    const upstreamRes = await fetch(target, fetchOptions);

    const contentType = upstreamRes.headers.get('content-type') || 'text/html';
    res.status(upstreamRes.status);
    res.setHeader('Content-Type', contentType);

    // If HTML, inject base tag and the stealth navigation interceptor
    if (contentType.includes('text/html')) {
      let html = await upstreamRes.text();
      try {
        const parsedUrl = new URL(target);
        const baseUrl = parsedUrl.origin + '/';
        const baseTag = `\n  <base href="${baseUrl}">\n`;
        
        // Navigation interceptor script ensures all links clicked inside the iframe route through /proxy
        const proxyNavScript = `
  <script id="stealth-nav-script">
  (function() {
    try {
      Object.defineProperty(window, 'top', { get: function() { return window.self; } });
      Object.defineProperty(window, 'parent', { get: function() { return window.self; } });
    } catch(e) {}

    // Intercept clicks on links so every navigation routes through /proxy
    document.addEventListener('click', function(e) {
      var a = e.target && (e.target.closest ? e.target.closest('a') : null);
      if (!a) return;

      if (a.target === '_top' || a.target === '_parent' || a.target === '_blank') {
        a.target = '_self';
      }

      var rawHref = a.getAttribute('href');
      if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:')) return;

      try {
        var dest = new URL(a.href, window.location.href).href;
        if (dest.startsWith('http://') || dest.startsWith('https://')) {
          e.preventDefault();
          e.stopPropagation();

          // Transform YouTube watch URLs into embed URLs so videos play cleanly inside iframe
          if (dest.includes('youtube.com/watch') || dest.includes('youtu.be/')) {
            var match = dest.match(/(?:v=|youtu\\.be\\/|embed\\/)([a-zA-Z0-9_-]{11})/);
            if (match && match[1]) {
              dest = 'https://www.youtube.com/embed/' + match[1] + '?autoplay=1';
            }
          }

          window.location.href = '/proxy?url=' + encodeURIComponent(dest);
        }
      } catch(err) {}
    }, true);

    // Intercept GET form submissions (search bars, etc.)
    document.addEventListener('submit', function(e) {
      var form = e.target;
      if (!form) return;
      if (form.target === '_top' || form.target === '_parent' || form.target === '_blank') {
        form.target = '_self';
      }
      var method = (form.method || 'GET').toUpperCase();
      if (method === 'GET') {
        e.preventDefault();
        e.stopPropagation();
        try {
          var formData = new FormData(form);
          var params = new URLSearchParams(formData);
          var actionUrl = new URL(form.action || window.location.href, window.location.href);
          actionUrl.search = params.toString();
          window.location.href = '/proxy?url=' + encodeURIComponent(actionUrl.href);
        } catch(err) {}
      }
    }, true);

    // Prevent popups from escaping iframe
    window.open = function(url) {
      if (url) {
        try {
          var full = new URL(url, window.location.href).href;
          window.location.href = '/proxy?url=' + encodeURIComponent(full);
        } catch(e) {
          window.location.href = url;
        }
      }
      return window;
    };
  })();
  </script>
`;

        const injection = baseTag + proxyNavScript;
        if (/<head[^>]*>/i.test(html)) {
          html = html.replace(/(<head[^>]*>)/i, `$1${injection}`);
        } else {
          html = injection + html;
        }
      } catch (e) {
        // Fallback without base tag
      }
      return res.send(html);
    }

    const bodyBuffer = Buffer.from(await upstreamRes.arrayBuffer());
    return res.send(bodyBuffer);
  } catch (err) {
    console.error('[Proxy Error]:', err.message);
    return res.status(502).send('Proxy error: ' + err.message);
  }
});

// Helper to derive initial title and favicon from a URL
function deriveTitleAndFavicon(url) {
  if (!url || url === '/index.html') {
    return { title: 'Home | UGVLE', favicon: '/theme/images/theme_favicon.ico' };
  }
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    
    if (host.includes('youtube.com') || host.includes('youtu.be')) {
      return { title: 'YouTube', favicon: 'https://www.youtube.com/s/desktop/f51d9955/img/favicon.ico' };
    }
    if (host.includes('google.com')) {
      return { title: 'Google', favicon: 'https://www.google.com/favicon.ico' };
    }
    if (host.includes('wikipedia.org')) {
      return { title: 'Wikipedia, the free encyclopedia', favicon: 'https://en.wikipedia.org/static/favicon/wikipedia.ico' };
    }
    if (host.includes('github.com')) {
      return { title: 'GitHub', favicon: 'https://github.githubassets.com/favicons/favicon.svg' };
    }
    if (host.includes('azure.com') || host.includes('microsoft.com')) {
      return { title: 'Microsoft Azure', favicon: 'https://azure.microsoft.com/favicon.ico' };
    }
    if (host.includes('ucsc.cmb.ac.lk')) {
      return { title: 'Home | UGVLE', favicon: '/theme/images/theme_favicon.ico' };
    }

    const parts = host.replace(/^www\./, '').split('.');
    const siteName = parts[0] ? parts[0].charAt(0).toUpperCase() + parts[0].slice(1) : host;
    return { title: siteName, favicon: `${parsed.origin}/favicon.ico` };
  } catch (e) {
    return { title: 'Home', favicon: '' };
  }
}

// Helper to serve the stealth shell (Iframe over Iframe container)
function serveShell(res, customUrl) {
  let shellHtml = fs.readFileSync(path.join(publicDir, 'shell.html'), 'utf-8');
  const target = customUrl || TARGET_URL || '';
  const meta = deriveTitleAndFavicon(target);

  // Pre-populate title and favicon so the browser tab immediately shows the target site's title
  shellHtml = shellHtml.replace('<title></title>', `<title>${meta.title}</title>`);
  if (meta.favicon) {
    shellHtml = shellHtml.replace('id="tab-favicon" href=""', `id="tab-favicon" href="${meta.favicon}"`);
  }

  if (target) {
    shellHtml = shellHtml.replace('window.CUSTOM_TARGET_URL ||', `window.CUSTOM_TARGET_URL || "${target}" ||`);
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  return res.send(shellHtml);
}

// Dedicated route for the stealth shell
app.get('/shell', (req, res) => {
  serveShell(res, req.query.url || TARGET_URL);
});

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
app.get(['/', '/index.php'], (req, res) => {
  // If a custom URL is provided via ?url=, or TARGET_URL is configured in .env, or IFRAME_MODE=true:
  if (req.query.url || TARGET_URL || process.env.IFRAME_MODE === 'true') {
    return serveShell(res, req.query.url || TARGET_URL);
  }
  serveInterface(res);
});

app.get('/index.html', (req, res) => {
  serveInterface(res);
});

// Legacy Moodle asset compatibility routes (intercepts legacy PHP URLs and maps them to clean files)
app.use((req, res, next) => {
  const urlPath = req.path;
  const original = req.originalUrl || req.url;

  // 1. Stylesheet: /theme/styles.php
  if (urlPath.startsWith('/theme/styles.php')) {
    res.setHeader('Content-Type', 'text/css');
    return res.sendFile(path.join(interfaceDir, 'theme', 'styles.css'));
  }

  // 2. YUI combo: /theme/yui_combo.php
  if (urlPath.startsWith('/theme/yui_combo.php')) {
    if (original.includes('.css')) {
      res.setHeader('Content-Type', 'text/css');
      return res.sendFile(path.join(interfaceDir, 'theme', 'yui-moodlesimple-min.css'));
    } else {
      res.setHeader('Content-Type', 'application/javascript');
      return res.sendFile(path.join(interfaceDir, 'theme', 'yui-moodlesimple-min.js'));
    }
  }

  // 3. Javascript: /lib/javascript.php
  if (urlPath.startsWith('/lib/javascript.php')) {
    res.setHeader('Content-Type', 'application/javascript');
    if (original.includes('polyfill')) {
      return res.sendFile(path.join(interfaceDir, 'lib', 'polyfill.js'));
    } else if (original.includes('require')) {
      return res.sendFile(path.join(interfaceDir, 'lib', 'require.min.js'));
    } else {
      return res.sendFile(path.join(interfaceDir, 'lib', 'javascript-static.js'));
    }
  }

  // 4. Fonts: /theme/font.php
  if (urlPath.startsWith('/theme/font.php')) {
    if (original.includes('.woff2')) {
      res.setHeader('Content-Type', 'font/woff2');
      return res.sendFile(path.join(interfaceDir, 'theme', 'fonts', 'fontawesome-webfont.woff2'));
    } else if (original.includes('.woff')) {
      res.setHeader('Content-Type', 'font/woff');
      return res.sendFile(path.join(interfaceDir, 'theme', 'fonts', 'fontawesome-webfont.woff'));
    } else if (original.includes('.ttf')) {
      res.setHeader('Content-Type', 'font/ttf');
      return res.sendFile(path.join(interfaceDir, 'theme', 'fonts', 'fontawesome-webfont.ttf'));
    } else if (original.includes('.svg')) {
      res.setHeader('Content-Type', 'image/svg+xml');
      return res.sendFile(path.join(interfaceDir, 'theme', 'fonts', 'fontawesome-webfont.svg'));
    } else if (original.includes('.eot')) {
      res.setHeader('Content-Type', 'application/vnd.ms-fontobject');
      return res.sendFile(path.join(interfaceDir, 'theme', 'fonts', 'fontawesome-webfont.eot'));
    }
  }

  // 5. YUI sprite icons: /theme/yui_image.php
  if (urlPath.startsWith('/theme/yui_image.php')) {
    res.setHeader('Content-Type', 'image/png');
    return res.sendFile(path.join(interfaceDir, 'theme', 'images', 'sprite_icons.png'));
  }

  // 6. Plugin files: /pluginfile.php
  if (urlPath.startsWith('/pluginfile.php')) {
    if (original.includes('UCSC_logo1')) {
      res.setHeader('Content-Type', 'image/jpeg');
      return res.sendFile(path.join(interfaceDir, 'pluginfile', '2', 'course', 'section', '2', 'UCSC_logo1.jpg'));
    } else if (original.includes('f1')) {
      res.setHeader('Content-Type', 'image/png');
      return res.sendFile(path.join(interfaceDir, 'pluginfile', 'f1.png'));
    }
  }

  // 7. Theme images: /theme/image.php
  if (urlPath.startsWith('/theme/image.php')) {
    const imagesDir = path.join(interfaceDir, 'theme', 'images');
    if (original.includes('favicon')) {
      res.setHeader('Content-Type', 'image/x-icon');
      return res.sendFile(path.join(imagesDir, 'theme_favicon.ico'));
    } else if (original.includes('f%2Fpdf-24') || original.includes('pdf-24')) {
      res.setHeader('Content-Type', 'image/png');
      return res.sendFile(path.join(imagesDir, 'core_f_pdf-24.png'));
    } else if (original.includes('u%2Ff1') || original.includes('u_f1')) {
      res.setHeader('Content-Type', 'image/png');
      return res.sendFile(path.join(imagesDir, 'core_u_f1.png'));
    } else if (original.includes('forum') && original.includes('monologo')) {
      res.setHeader('Content-Type', 'image/svg+xml');
      return res.sendFile(path.join(imagesDir, 'forum_monologo.svg'));
    } else if (original.includes('url') && original.includes('monologo')) {
      res.setHeader('Content-Type', 'image/svg+xml');
      return res.sendFile(path.join(imagesDir, 'url_monologo.svg'));
    }
  }

  next();
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
      console.warn('[Warning] GEMINI_API_KEY is not configured. Returning simulated MCQ response for testing.');
      await new Promise(r => setTimeout(r, 600));

      return res.json({
        success: true,
        response: '3',
        fullResponse: '3 (Simulated MCQ Answer)',
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

    const answerOnly = extractAnswer(generatedText);
    console.log(`[Gemini Answer] Extracted: "${answerOnly}" (Raw length: ${generatedText.length})`);

    return res.json({
      success: true,
      response: answerOnly,
      fullResponse: generatedText,
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



// Catch-all route for SPA / navigation (only serve index.html for page navigation, never for missing static assets)
const assetExtensions = /\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|map|json)$/i;
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Endpoint not found' });
  }
  if (assetExtensions.test(req.path)) {
    return res.status(404).type('text/plain').send('Asset not found');
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
  console.log(` AI Model:            ${GEMINI_MODEL}`);
  if (TARGET_URL) {
    console.log(` Camouflage URL:      ${TARGET_URL} (Iframe Shell active)`);
  } else {
    console.log(` Camouflage:          Local Moodle interface (/interface)`);
  }
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
