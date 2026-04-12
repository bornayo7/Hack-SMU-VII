import React from "react";
import ApiKeyInput from "./ApiKeyInput.jsx";

export const ENGINE_OPTIONS = [
  {
    id: "paddleocr",
    name: "PaddleOCR",
    description: "Balanced, high-accuracy OCR with strong CJK coverage.",
    type: "server",
    badges: ["Server", "CJK"],
  },
  {
    id: "mangaocr",
    name: "MangaOCR",
    description: "Best for Japanese manga bubbles, stylized lettering, and vertical text.",
    type: "server",
    badges: ["Server", "JP"],
  },
  {
    id: "tesseract",
    name: "Tesseract.js",
    description: "Runs fully in the browser with zero backend setup.",
    type: "local",
    badges: ["Local", "No setup"],
  },
  {
    id: "google_vision",
    name: "Google Cloud Vision",
    description: "Commercial OCR with broad language support and fast setup once keyed.",
    type: "cloud",
    badges: ["Cloud", "API key"],
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
  const selectedEngine = ENGINE_OPTIONS.find((option) => option.id === engine);

  return (
    <div className="choice-section">
      <div className="choice-list" role="radiogroup" aria-label="OCR engine">
        {ENGINE_OPTIONS.map((option) => (
          <label
            key={option.id}
            className={`choice-card ${engine === option.id ? "is-selected" : ""}`}
          >
            <input
              type="radio"
              name="ocrEngine"
              className="choice-input"
              value={option.id}
              checked={engine === option.id}
              onChange={() => onEngineChange(option.id)}
            />

            <div className="choice-body">
              <div className="choice-header">
                <span className="choice-title">{option.name}</span>

                <div className="choice-badges">
                  {option.badges.map((badge) => (
                    <span
                      key={`${option.id}-${badge}`}
                      className={`capability-badge capability-badge--${option.type}`}
                    >
                      {badge}
                    </span>
                  ))}
                </div>
              </div>

              <p className="choice-description">{option.description}</p>
            </div>
          </label>
        ))}
      </div>

      {selectedEngine?.type === "server" && (
        <div className="config-card fade-in">
          <div className="form-group">
            <label className="form-label" htmlFor="ocr-backend-url">
              Backend server URL
            </label>
            <input
              id="ocr-backend-url"
              type="url"
              className="form-input"
              value={backendUrl}
              onChange={(event) => onBackendUrlChange(event.target.value)}
              placeholder="http://localhost:8000"
            />
            <p className="form-hint">
              Used by PaddleOCR and MangaOCR. Keep it pointed at the FastAPI
              backend that exposes `/health` and OCR routes.
            </p>
          </div>
        </div>
      )}

      {selectedEngine?.type === "cloud" && (
        <div className="config-card fade-in">
          <ApiKeyInput
            label="Google Cloud Vision API key"
            placeholder="AIza..."
            storageKey="googleCloudApiKey"
            value={googleCloudApiKey}
            onChange={onGoogleCloudApiKeyChange}
          />
          <p className="form-hint">
            Enable Cloud Vision in Google Cloud, then paste the key used for
            OCR requests here.
          </p>
        </div>
      )}

      {selectedEngine?.type === "local" && (
        <div className="config-card fade-in">
          <p className="form-hint">
            Tesseract.js needs no backend or API key. The first run may be
            slower while language data is cached.
          </p>
        </div>
      )}
    </div>
  );
}
