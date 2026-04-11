```
 __      __ _       _            _____                        _         _
 \ \    / /(_)     (_)          |_   _|                      | |       | |
  \ \  / /  _  ___  _   ___   _ | |  _ __  __ _  _ __   ___ | |  __ _ | |_  ___
   \ \/ /  | |/ __|| | / _ \ | \| | | '__|/ _` || '_ \ / __|| | / _` || __|/ _ \
    \  /   | |\__ \| || (_) || .  | | |  | (_| || | | |\__ \| || (_| || |_|  __/
     \/    |_||___/|_| \___/ |_|\_| |_|   \__,_||_| |_||___/|_| \__,_| \__|\___|

                         lensmu -- see it, read it, understand it
```

# VisionTranslate (lensmu)

**VisionTranslate** is a browser extension that translates text found inside
images on any web page. It uses OCR (Optical Character Recognition) to extract
text from images, sends that text to a translation service, and overlays the
translated text right on top of the original image -- all without leaving your
browser.

**Example use cases:**

- Reading Japanese manga that hasn't been officially translated
- Understanding foreign-language street signs in Google Street View
- Browsing a restaurant menu photographed in another language
- Reading screenshots or infographics posted in a language you don't speak


## How It Works (Architecture)

```
+--------------------------------------------------+
|                    YOUR BROWSER                   |
|                                                   |
|   +--------------------+   +------------------+   |
|   |   Extension Popup  |   |   Content Script |   |
|   |   (React UI)       |   |   (overlay.js)   |   |
|   |                    |   |                  |   |
|   |  - Settings panel  |   |  - Scans <img>  |   |
|   |  - Engine picker   |   |  - Draws overlay |   |
|   |  - Translate btn   |   |  - Shows results |   |
|   +--------+-----------+   +--------+---------+   |
|            |                        |              |
+------------|------------------------|--------------|
             |  chrome.runtime API    |  HTTP POST   |
             +----------+-------------+              |
                        |                            |
                        v                            |
            +-----------+-----------+                |
            |   Background Script   |                |
            |   (Service Worker)    | <--------------+
            |                       |
            |   - Routes messages   |
            |   - Manages state     |
            +-----------+-----------+
                        |
                        | HTTP requests
                        v
            +-----------+-----------+
            |    Python Backend     |
            |    (FastAPI server)   |
            |                       |
            |  /ocr endpoint:       |
            |    - PaddleOCR        |
            |    - MangaOCR         |
            |                       |
            |  /translate endpoint: |
            |    - Google Translate  |
            |    - LibreTranslate   |
            +-----------------------+
               runs on localhost:8000
```

**Data flow when you click "Translate This Page":**

1. The popup sends a message to the background script: "translate this tab."
2. The background script tells the content script (injected in the page) to
   start scanning.
3. The content script finds all `<img>` elements, extracts each image as a
   base64-encoded string, and sends it to the Python backend for OCR.
4. The backend runs OCR (PaddleOCR or MangaOCR) and returns bounding boxes +
   recognized text.
5. The content script sends the recognized text to the translation module
   (Google Translate, OpenAI, Claude, or LibreTranslate — runs in the extension).
6. The translation module returns the translated text.
7. The content script renders translated text overlays on top of each image
   using absolutely-positioned `<div>` elements inside a Shadow DOM (so the
   host page's CSS doesn't interfere).
8. Hovering over a translated block shows the original text in a tooltip.

**Note on Tesseract.js:** The extension also bundles Tesseract.js, which runs
OCR entirely in the browser (no backend needed). This is useful for quick
translations but is generally less accurate than PaddleOCR for non-Latin
scripts.


## Prerequisites

Before setting up VisionTranslate, make sure you have the following installed:

| Requirement       | Minimum Version | How to Check          | Install Guide                          |
|-------------------|-----------------|-----------------------|----------------------------------------|
| Python            | 3.8+            | `python3 --version`   | https://www.python.org/downloads/      |
| pip               | 21.0+           | `pip3 --version`      | Comes with Python                      |
| Node.js           | 18.0+           | `node --version`      | https://nodejs.org/                    |
| npm               | 9.0+            | `npm --version`       | Comes with Node.js                     |
| Chrome or Firefox | Latest          | Check browser version | https://www.google.com/chrome/         |
| Git               | Any             | `git --version`       | https://git-scm.com/                   |

**Operating system notes:**

- **macOS:** Install Python via Homebrew (`brew install python3`) or from
  python.org. Node.js via Homebrew (`brew install node`) or nvm.
- **Linux (Ubuntu/Debian):** `sudo apt update && sudo apt install python3 python3-pip python3-venv nodejs npm`
- **Windows:** Download installers from python.org and nodejs.org. Use
  PowerShell or WSL for the terminal commands below. If using WSL, all
  commands work as written.


## Setup: Python Backend

The backend is a FastAPI server that provides OCR and translation endpoints.

### Step 1: Navigate to the backend directory

```bash
cd lensmu/backend
```

### Step 2: Create a Python virtual environment

A virtual environment keeps this project's dependencies isolated from your
system Python. This is important because PaddleOCR and MangaOCR install many
large packages.

```bash
# Create the virtual environment (only need to do this once)
python3 -m venv venv

# Activate it
# On macOS/Linux:
source venv/bin/activate

# On Windows (PowerShell):
.\venv\Scripts\Activate.ps1

# On Windows (Command Prompt):
venv\Scripts\activate.bat
```

You should see `(venv)` appear at the beginning of your terminal prompt. This
means the virtual environment is active.

**Every time you open a new terminal** to work on this project, you need to
activate the virtual environment again with the `source` (or Windows equivalent)
command above.

### Step 3: Install Python dependencies

Installation is split into two parts: core server (always works) and OCR engines
(optional, require Python 3.8–3.12).

```bash
# Core server dependencies (FastAPI, uvicorn, Pillow, numpy)
pip install -r requirements.txt
```

This installs the web server. It starts in under 5 seconds.

**Optional: Install OCR engines**

PaddlePaddle and manga-ocr require **Python 3.8–3.12**. If you're on Python
3.13+, skip this step and use Tesseract.js (runs in the browser, no server
needed) or Google Cloud Vision from the extension settings.

```bash
# If on Python 3.8–3.12, install PaddlePaddle first (platform-specific):

# macOS (Apple Silicon / M1/M2/M3/M4):
pip install paddlepaddle==2.6.2 -f https://www.paddlepaddle.org.cn/whl/mac/cpu/paddlepaddle.html

# Linux (CPU only):
pip install paddlepaddle==2.6.2

# Linux (NVIDIA GPU with CUDA 11.8+):
pip install paddlepaddle-gpu==2.6.2

# Windows (CPU only):
pip install paddlepaddle==2.6.2

# Then install PaddleOCR and MangaOCR:
pip install paddleocr>=2.7.0 manga-ocr>=0.1.8
```

**The server works without OCR engines installed.** The `/health` endpoint
reports which engines are available, and OCR endpoints return a helpful error
message suggesting alternative engines if their dependencies are missing.

### Step 4: Start the backend server

```bash
# Make sure your virtual environment is active (you should see (venv) in prompt)
python server.py
```

Or equivalently with uvicorn directly:

```bash
uvicorn server:app --host 0.0.0.0 --port 8000 --reload
```

The `--reload` flag makes the server restart automatically when you edit Python
files. This is useful during development but can be removed in production.

You should see output like:

```
INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
INFO:     Started reloader process [12345]
```

### Step 5: Verify the server is running

Open a **new terminal** (keep the server running in the other one) and run:

```bash
curl http://localhost:8000/health
```

You should get a JSON response like:

```json
{
  "status": "ok",
  "paddle_ocr_available": false,
  "paddle_ocr_loaded": false,
  "manga_ocr_available": false,
  "manga_ocr_loaded": false
}
```

`available: false` just means the OCR engines aren't installed (expected on
Python 3.13+). The server still works — use Tesseract.js or Google Cloud Vision
in the extension settings. If you installed the OCR deps, these will show `true`.

If you see `Connection refused`, the server isn't running. Go back to step 4.

Leave the server running and move on to the extension setup.


## Setup: Browser Extension

### Step 1: Navigate to the extension directory

Open a **new terminal** (keep the backend server running):

```bash
cd lensmu/extension
```

### Step 2: Install Node.js dependencies

```bash
npm install
```

This downloads React, Vite, Tesseract.js, and all other JavaScript
dependencies. They go into a `node_modules/` folder (which can be large -- this
is normal).

### Step 3: Build the extension

```bash
npm run build
```

This runs Vite twice -- once to build the popup UI, once to build the content
overlay. When it finishes, you should see a `dist/` folder:

```
extension/
  dist/
    popup/
      index.html     <-- the popup page
      popup.js        <-- popup React bundle
      popup.css       <-- popup styles
    content-overlay.js <-- overlay React bundle
```

### Step 4: Generate extension icons

The project includes an SVG icon at `extension/icons/icon.svg`. Browser
extensions need PNG icons at specific sizes. You can convert the SVG using any
of these methods:

**Option A: Using ImageMagick (recommended, works on all platforms):**

```bash
# Install ImageMagick if you don't have it:
# macOS:   brew install imagemagick
# Linux:   sudo apt install imagemagick
# Windows: https://imagemagick.org/script/download.php

cd icons
convert icon.svg -resize 16x16 icon16.png
convert icon.svg -resize 48x48 icon48.png
convert icon.svg -resize 128x128 icon128.png
cd ..
```

**Option B: Using an online converter:**

1. Open https://svgtopng.com/ (or any SVG-to-PNG converter)
2. Upload `extension/icons/icon.svg`
3. Download at sizes 16x16, 48x48, and 128x128
4. Save them as `icon16.png`, `icon48.png`, `icon128.png` in `extension/icons/`

**Option C: Skip it for now.**
The extension will still load and work without icons -- it just won't have a
pretty icon in the toolbar. You can add icons later.

### Step 5: Load the extension in your browser

#### Chrome / Chromium / Brave / Edge

1. Open Chrome and go to `chrome://extensions` (type it in the address bar)
2. Toggle **"Developer mode"** ON (switch in the top-right corner)
3. Click **"Load unpacked"** (button in the top-left)
4. In the file picker, navigate to and select the **`extension/`** folder
   (the one that contains `manifest.json`, NOT `dist/` and NOT `lensmu/`)
5. The extension should appear in the extensions list with its icon
6. Click the puzzle piece icon in Chrome's toolbar, then pin VisionTranslate
   for easy access

**If you see errors:**
- "Manifest file is missing or unreadable" -- you selected the wrong folder.
  Make sure you're selecting the `extension/` directory itself.
- "Could not load javascript" -- run `npm run build` first (Step 3).

#### Firefox

1. Open Firefox and go to `about:debugging` (type it in the address bar)
2. Click **"This Firefox"** in the left sidebar
3. Click **"Load Temporary Add-on..."**
4. Navigate to the `extension/` folder and select the **`manifest.json`** file
   (not the folder -- Firefox wants the manifest file directly)
5. The extension should appear in the list

**Important Firefox note:** Temporary add-ons are removed when Firefox closes.
You'll need to re-load it each time you restart Firefox. This is normal for
development.

### Step 6: Verify the extension loaded

1. Click the VisionTranslate icon in your browser toolbar
2. A popup should appear with settings and a "Translate This Page" button
3. The status indicator should show whether the backend is reachable


## How to Use

### Basic Usage

1. **Start the backend** (if not already running):
   ```bash
   cd lensmu/backend
   source venv/bin/activate
   uvicorn server:app --host 0.0.0.0 --port 8000 --reload
   ```

2. **Click the VisionTranslate icon** in your browser toolbar.

3. **Configure your settings** in the popup:
   - **OCR Engine:** Choose PaddleOCR (best for most languages), MangaOCR
     (best for Japanese manga), or Tesseract.js (runs locally in browser,
     no backend needed).
   - **Translation Provider:** Choose your preferred translation service.
   - **Target Language:** The language you want to translate INTO (default:
     English).

4. **Navigate to a page with images** containing foreign-language text.

5. **Click "Translate This Page"** in the popup.

6. Wait a moment while the extension processes images. You'll see a progress
   indicator. Large images or pages with many images may take 10-30 seconds.

7. **Translated text appears** overlaid on the images. The overlay matches
   the position and approximate size of the original text.

8. **Hover over any translated text** to see the original text in a tooltip.

9. **Click "Clear Overlays"** in the popup to remove all translations.

### Tips for Best Results

- **Larger images** produce better OCR results than tiny thumbnails.
- **Clean, high-contrast text** (black text on white background) works best.
- **MangaOCR** is specifically trained on Japanese manga and will outperform
  PaddleOCR for that use case.
- **PaddleOCR** works well for printed text in most languages (Chinese,
  Japanese, Korean, English, Russian, Arabic, Hindi, etc.).
- **Tesseract.js** is convenient (no backend required) but less accurate,
  especially for CJK (Chinese/Japanese/Korean) text.


## Test URLs

Try these pages to test the extension:

| Description                         | URL                                                              |
|-------------------------------------|------------------------------------------------------------------|
| Japanese Wikipedia (text in images) | https://ja.wikipedia.org/wiki/%E6%9D%B1%E4%BA%AC                 |
| Chinese Wikipedia                   | https://zh.wikipedia.org/wiki/%E5%8C%97%E4%BA%AC%E5%B8%82       |
| Korean Wikipedia                    | https://ko.wikipedia.org/wiki/%EC%84%9C%EC%9A%B8%ED%8A%B9%EB%B3%84%EC%8B%9C |
| Wikimedia Commons (foreign signs)   | https://commons.wikimedia.org/wiki/Category:Japanese_road_signs  |
| Russian Wikipedia                   | https://ru.wikipedia.org/wiki/%D0%9C%D0%BE%D1%81%D0%BA%D0%B2%D0%B0 |
| Arabic Wikipedia                    | https://ar.wikipedia.org/wiki/%D8%A7%D9%84%D9%82%D8%A7%D9%87%D8%B1%D8%A9 |

**For manga testing**, search for "manga raw" or "raw manga" to find sites with
untranslated Japanese manga pages. Most manga reading sites have images with
embedded Japanese text that VisionTranslate can process.


## Troubleshooting

### Backend won't start

**Symptom:** `uvicorn server:app` gives an error or crashes immediately.

**Possible fixes:**

1. **Virtual environment not activated.** You should see `(venv)` in your
   terminal prompt. If not:
   ```bash
   source venv/bin/activate  # macOS/Linux
   .\venv\Scripts\Activate.ps1  # Windows PowerShell
   ```

2. **Dependencies not installed.** Run `pip install -r requirements.txt`
   again and look for error messages.

3. **Port 8000 already in use.** Another program is using port 8000. Either
   stop that program or use a different port:
   ```bash
   uvicorn server:app --host 0.0.0.0 --port 8001 --reload
   ```
   If you change the port, you'll also need to update the backend URL in the
   extension popup settings.

4. **PaddlePaddle import error.** PaddlePaddle can be tricky to install. See
   the PaddlePaddle notes in the backend setup section. As a workaround, the
   extension can still use Tesseract.js (which runs in the browser without
   the backend).

5. **MangaOCR first-run download.** The first time MangaOCR runs, it downloads
   a ~400 MB model. If this download fails (network issues), delete the cached
   model and try again:
   ```bash
   rm -rf ~/.cache/huggingface/hub/models--kha-white--manga-ocr-base
   ```

### Extension can't reach the backend

**Symptom:** The popup shows "Backend unreachable" or OCR results are empty.

**Possible fixes:**

1. **Backend isn't running.** Check that you see `Uvicorn running on
   http://0.0.0.0:8000` in the terminal where you started the server.

2. **Wrong backend URL.** The extension defaults to `http://localhost:8000`.
   Make sure the server is running on that address and port.

3. **CORS issue.** The backend must allow requests from the browser extension.
   If you see CORS errors in the browser console (F12 -> Console tab), make
   sure the FastAPI backend has CORS middleware configured:
   ```python
   from fastapi.middleware.cors import CORSMiddleware

   app.add_middleware(
       CORSMiddleware,
       allow_origins=["*"],  # In production, restrict this
       allow_methods=["*"],
       allow_headers=["*"],
   )
   ```

4. **Firewall blocking localhost.** Some security software blocks localhost
   connections. Try temporarily disabling your firewall to test.

### OCR results are poor or empty

**Symptom:** The extension runs but detected text is gibberish or missing.

**Possible fixes:**

1. **Wrong OCR engine for the language.** PaddleOCR supports 80+ languages
   but you may need to configure the language code. MangaOCR is ONLY for
   Japanese.

2. **Image too small.** Images under ~200px wide often produce poor OCR
   results. Try on a page with larger images.

3. **Image is a photo, not text.** OCR works on text rendered in images
   (screenshots, scanned documents, manga). It won't extract text from
   photos of scenery unless there are visible signs or text.

4. **Try a different engine.** If PaddleOCR gives poor results, try
   Tesseract.js or vice versa. Different engines excel at different types
   of text and layouts.

5. **Image format issues.** Some websites use WebP or AVIF images that may
   not process correctly. The extension converts to PNG before OCR, but
   if you see issues, try right-clicking the image, saving it as PNG, and
   testing OCR on the saved file.

### Translation is wrong or garbled

**Symptom:** OCR detected the right text but the translation doesn't make sense.

**Possible fixes:**

1. **Wrong source language.** The translation provider might be auto-detecting
   the wrong language. Try setting the source language explicitly in the
   popup settings.

2. **OCR errors propagated.** If the OCR misread characters (e.g., reading
   a Japanese character wrong), the translation will be wrong too. Try a
   different OCR engine.

3. **Try a different translation provider.** Different services handle
   different languages with varying quality.

4. **Specialized text.** Manga often uses slang, onomatopoeia, and stylized
   text that translation services struggle with. This is a known limitation.


## Configuration Options

These settings are available in the extension popup:

| Option                | Values                                     | Default       | Description                                                                 |
|-----------------------|--------------------------------------------|---------------|-----------------------------------------------------------------------------|
| OCR Engine            | PaddleOCR, MangaOCR, Tesseract.js          | PaddleOCR     | Which OCR engine to use for text extraction                                 |
| Translation Provider  | Google Translate, LibreTranslate            | Google        | Which translation service to use                                            |
| Target Language       | en, ja, zh, ko, es, fr, de, ... (ISO 639)  | en            | Language to translate INTO                                                  |
| Source Language        | auto, en, ja, zh, ko, es, fr, de, ...      | auto          | Language to translate FROM (auto = auto-detect)                             |
| Backend URL           | Any URL                                    | localhost:8000| Where the Python backend is running                                         |
| Min Image Size        | Number (pixels)                            | 100           | Skip images smaller than this (width or height). Tiny images rarely have readable text |
| Overlay Opacity       | 0.0 - 1.0                                 | 0.85          | How opaque the translation overlay is (1.0 = fully opaque)                  |
| Font Size             | auto, 10-48                                | auto          | Font size for overlay text. "auto" scales based on detected text region size |


## Project Structure

```
lensmu/
  backend/                    # Python FastAPI server
    server.py                  # Server entry point, API routes
    ocr_engines/              # OCR engine wrappers
      __init__.py
      paddleocr_engine.py     # PaddleOCR wrapper
      mangaocr_engine.py      # MangaOCR wrapper
    requirements.txt          # Python dependencies

  extension/                  # Browser extension (Chrome + Firefox)
    manifest.json             # Extension manifest (permissions, scripts, etc.)
    package.json              # Node.js dependencies
    vite.config.js            # Vite build configuration

    src/
      background.js           # Service worker (message routing, state)
      content.js              # Content script (finds images, injects overlay)
      overlay.js              # Bootstrap for content-overlay React components

      popup/                  # Popup UI (React)
        index.html            # Popup HTML shell
        index.jsx             # Popup React entry point
        App.jsx               # Main popup component
        components/           # Popup sub-components

      content-overlay/        # Overlay UI (React, injected into pages)
        index.jsx             # Overlay React entry point
        TranslationOverlay.jsx
        TextBlock.jsx

    icons/                    # Extension icons
      icon.svg                # Source SVG icon
      icon16.png              # 16x16 toolbar icon (generate from SVG)
      icon48.png              # 48x48 extensions page icon
      icon128.png             # 128x128 Chrome Web Store icon

    dist/                     # Built files (generated by npm run build)
      popup/
        index.html
        popup.js
        popup.css
      content-overlay.js

  README.md                   # This file
```


## Development Workflow

When actively developing, use the watch mode to auto-rebuild on changes:

```bash
# Terminal 1: backend
cd lensmu/backend
source venv/bin/activate
uvicorn server:app --host 0.0.0.0 --port 8000 --reload

# Terminal 2: extension build watcher
cd lensmu/extension
npm run watch
```

After the watcher rebuilds, go to `chrome://extensions` and click the refresh
icon on the VisionTranslate extension card to reload it with the latest code.
(Firefox temporary add-ons also have a "Reload" button.)


## License

MIT License. See LICENSE file for details.
