/**
 * OcrSettings.jsx — OCR engine selector for VisionTranslate.
 *
 * WHAT IS OCR?
 * OCR (Optical Character Recognition) is the process of extracting text from
 * images. In VisionTranslate, we take screenshots of regions on a web page,
 * send those images through an OCR engine to get the text, and then translate
 * that text into the target language.
 *
 * AVAILABLE ENGINES:
 *
 *   PaddleOCR (server-based)
 *   - Open-source OCR by Baidu. Excellent for CJK (Chinese, Japanese, Korean).
 *   - Runs on a Python backend server — the extension sends images via HTTP.
 *   - Requires: backend server running at a configurable URL.
 *
 *   MangaOCR (server-based)
 *   - Specialized for Japanese manga/comics text. Best-in-class for vertical
 *     Japanese text and stylized fonts common in manga.
 *   - Also runs on a Python backend server.
 *   - Requires: backend server running at a configurable URL.
 *
 *   Tesseract.js (client-side)
 *   - Runs entirely in the browser via WebAssembly. No server needed.
 *   - Good for Latin scripts, less accurate for CJK languages.
 *   - Pro: Zero setup. Con: Slower and less accurate than server options.
 *
 *   Google Cloud Vision (cloud API)
 *   - Google's commercial OCR service. Very accurate across all languages.
 *   - Requires a Google Cloud API key with Vision API enabled.
 *   - Pro: Most accurate. Con: Costs money, requires API key.
 *
 * PROPS:
 *   engine                   — Currently selected engine ID string
 *   onEngineChange           — Callback when engine selection changes
 *   backendUrl               — Current backend server URL
 *   onBackendUrlChange       — Callback when backend URL changes
 *   googleCloudApiKey        — Current Google Cloud API key
 *   onGoogleCloudApiKeyChange — Callback when the key changes
 */

import React from "react";
import ApiKeyInput from "./ApiKeyInput.jsx";

/**
 * ENGINE_OPTIONS defines the available OCR engines.
 * Each entry includes:
 *   id          — Unique identifier stored in settings
 *   name        — Human-readable display name
 *   description — Short explanation shown below the radio button
 *   type        — "server" | "client" | "cloud" — determines which extra
 *                 config fields to show (backend URL vs API key vs nothing)
 */
const ENGINE_OPTIONS = [
  {
    id: "paddleocr",
    name: "PaddleOCR",
    description:
      "High-accuracy open-source OCR. Excellent for CJK languages. Requires the backend server.",
    type: "server",
  },
  {
    id: "mangaocr",
    name: "MangaOCR",
    description:
      "Specialized for Japanese manga and comics. Best for vertical text and stylized fonts.",
    type: "server",
  },
  {
    id: "tesseract",
    name: "Tesseract.js",
    description:
      "Runs in the browser — no server needed. Good for Latin scripts, slower for CJK.",
    type: "client",
  },
  {
    id: "google_vision",
    name: "Google Cloud Vision",
    description:
      "Google's commercial OCR API. Most accurate across all languages. Requires an API key.",
    type: "cloud",
  },
];

export default function OcrSettings({
  engine,
  onEngineChange,
  backendUrl,
  onBackendUrlChange,
  googleCloudApiKey,
  onGoogleCloudApiKeyChange,
}) {
  // Find the currently selected engine's metadata
  const selectedEngine = ENGINE_OPTIONS.find((opt) => opt.id === engine);

  return (
    <div className="ocr-settings">
      {/*
        Radio button group for engine selection.
        Each radio is wrapped in a label for accessibility — clicking
        anywhere on the label text selects the radio.
      */}
      <div className="radio-group" role="radiogroup" aria-label="OCR Engine">
        {ENGINE_OPTIONS.map((opt) => (
          <label
            key={opt.id}
            className={`radio-option ${engine === opt.id ? "radio-option--selected" : ""}`}
          >
            <div className="radio-option-header">
              <input
                type="radio"
                name="ocrEngine"
                value={opt.id}
                checked={engine === opt.id}
                onChange={() => onEngineChange(opt.id)}
                className="radio-input"
              />
              <span className="radio-label">{opt.name}</span>
              {/* Badge showing whether the engine is local, server, or cloud */}
              <span className={`engine-badge engine-badge--${opt.type}`}>
                {opt.type === "server" && "Server"}
                {opt.type === "client" && "Local"}
                {opt.type === "cloud" && "Cloud"}
              </span>
            </div>
            <p className="radio-description">{opt.description}</p>
          </label>
        ))}
      </div>

      {/*
        Conditional config fields based on the selected engine type.
        Server-based engines need a backend URL; cloud engines need an API key.
        Tesseract.js (client) needs no additional config.
      */}
      {selectedEngine && selectedEngine.type === "server" && (
        <div className="conditional-config fade-in">
          <div className="form-group">
            <label className="form-label" htmlFor="ocr-backend-url">
              Backend Server URL
            </label>
            <input
              id="ocr-backend-url"
              type="url"
              className="form-input"
              value={backendUrl}
              onChange={(e) => onBackendUrlChange(e.target.value)}
              placeholder="http://localhost:8000"
            />
            <p className="form-hint">
              The URL where the {selectedEngine.name} server is running. Make
              sure the server is started before translating.
            </p>
          </div>
        </div>
      )}

      {selectedEngine && selectedEngine.type === "cloud" && (
        <div className="conditional-config fade-in">
          <ApiKeyInput
            label="Google Cloud Vision API Key"
            placeholder="AIza..."
            storageKey="googleCloudApiKey"
            value={googleCloudApiKey}
            onChange={onGoogleCloudApiKeyChange}
          />
          <p className="form-hint">
            Enable the Cloud Vision API in your Google Cloud Console, then create
            an API key with Vision API access.
          </p>
        </div>
      )}

      {selectedEngine && selectedEngine.type === "client" && (
        <div className="conditional-config fade-in">
          <p className="form-hint">
            Tesseract.js runs entirely in your browser. No server or API key
            needed. Note: the first run downloads language data (~15 MB) which is
            cached for future use.
          </p>
        </div>
      )}
    </div>
  );
}
