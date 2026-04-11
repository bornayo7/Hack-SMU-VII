# LenSMU — VisionTranslate

> **See it. Read it. Understand it.**

A browser extension built at **HackSMU VII** that translates text inside images on any web page — manga, street signs, menus, screenshots — in real time, without leaving your browser.

## What It Does

LenSMU uses OCR to extract text from images, translates it via your choice of provider, and overlays the translated text directly on top of the original — matching position, size, and background color.

**Use cases:**
- Reading untranslated manga in Japanese, Korean, or Chinese
- Understanding foreign-language signs in Google Street View
- Translating photographed restaurant menus
- Reading screenshots or infographics in any language

## Tech Stack

| Layer | Technologies |
|-------|-------------|
| **Extension** | JavaScript, React, Vite, Tesseract.js, Shadow DOM |
| **Backend** | Python, FastAPI, PaddleOCR, MangaOCR |
| **OCR Engines** | PaddleOCR (80+ languages), MangaOCR (Japanese), Tesseract.js (in-browser), Google Cloud Vision |
| **Translation** | Google Translate, Gemini, OpenAI, Claude, LibreTranslate |

## Architecture

```
Browser Extension (React + Vite)
    │
    ├── Scans page for <img> elements
    ├── Converts images to base64
    ├── Sends to OCR engine (server or in-browser)
    ├── Sends extracted text to translation provider
    └── Overlays translated text via Shadow DOM
          │
          ▼
Python Backend (FastAPI, localhost:8000)
    ├── /ocr/paddle  → PaddleOCR (detect + recognize)
    └── /ocr/manga   → MangaOCR (Japanese specialist)
```

## Quick Start

**Backend:**
```bash
cd lensmu/backend
python -m venv venv
source venv/bin/activate      # Windows: .\venv\Scripts\Activate.ps1
pip install -r requirements.txt
python server.py
```

**Extension:**
```bash
cd lensmu/extension
npm install
npm run build
```

Then load the `extension/` folder as an unpacked extension in Chrome (`chrome://extensions` → Developer mode → Load unpacked).

> For detailed setup instructions, OCR engine installation, and troubleshooting, see the [full documentation](lensmu/README.md).

## Team

Built at HackSMU VII by:
- [bornayo7](https://github.com/bornayo7)
- [Logan722](https://github.com/Logan722)
- [KBuildingPrograms](https://github.com/KBuildingPrograms)

## License

[MIT](LICENSE)
