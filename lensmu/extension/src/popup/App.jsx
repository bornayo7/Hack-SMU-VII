/**
 * App.jsx — Main popup settings UI for VisionTranslate (lensmu).
 *
 * ARCHITECTURE OVERVIEW FOR BROWSER EXTENSION BEGINNERS:
 *
 * A Chrome extension has several "contexts" that run in isolation:
 *
 *   1. POPUP (this file) — The small window that opens when you click the
 *      extension icon. It has its own DOM and React tree. It is destroyed
 *      every time the popup closes, so all state must be persisted to
 *      chrome.storage.local.
 *
 *   2. BACKGROUND SERVICE WORKER — A long-lived script that runs in the
 *      background (no DOM). It handles events like tab changes, messages
 *      from content scripts, and network requests. Defined in manifest.json
 *      under "background.service_worker".
 *
 *   3. CONTENT SCRIPTS — JavaScript injected into web pages. They can read
 *      and modify the page's DOM (e.g., overlay translations on images).
 *      They cannot access chrome.storage directly in Manifest V3 — they
 *      must message the background script to read/write settings.
 *
 * COMMUNICATION FLOW:
 *   Popup  --chrome.runtime.sendMessage-->  Background Service Worker
 *   Popup  --chrome.tabs.sendMessage-->     Content Script (in active tab)
 *   Content Script  --chrome.runtime.sendMessage-->  Background Service Worker
 *
 * This popup communicates with the rest of the extension in two ways:
 *   a) Reads/writes settings to chrome.storage.local (shared across all contexts).
 *   b) Sends a "TRANSLATE_PAGE" message to the content script via chrome.tabs.sendMessage
 *      when the user clicks the "Translate This Page" button.
 */

import React, { useState, useEffect, useCallback } from "react";
import OcrSettings from "./components/OcrSettings.jsx";
import TranslateSettings from "./components/TranslateSettings.jsx";
import LanguageSelector from "./components/LanguageSelector.jsx";

// Storage key used by utils/storage.js — must match to share settings with background
const SETTINGS_KEY = "vt_settings";

/**
 * DEFAULT_SETTINGS — Fallback values used when no settings exist in storage yet.
 * Must stay in sync with utils/storage.js DEFAULT_SETTINGS.
 */
const DEFAULT_SETTINGS = {
  ocrEngine: "tesseract",
  translationProvider: "libre",
  sourceLanguage: "auto",
  targetLanguage: "en",
  backendUrl: "http://localhost:8000",
  googleCloudApiKey: "",
  openaiApiKey: "",
  claudeApiKey: "",
  geminiApiKey: "",
  llmModel: "gemini-2.0-flash",
  darkMode: false,
};

export default function App() {
  // ─── State ───────────────────────────────────────────────────────────
  // All settings are kept in a single state object for simplicity.
  // When any setting changes, we persist the entire object to storage.
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);

  // Whether settings have been loaded from storage yet (prevents flash of defaults)
  const [loaded, setLoaded] = useState(false);

  // Backend server reachability status: "checking" | "online" | "offline"
  const [serverStatus, setServerStatus] = useState("checking");

  // ─── Load settings from chrome.storage on mount ──────────────────────
  useEffect(() => {
    /**
     * chrome.storage.local.get() reads persisted settings. We pass
     * DEFAULT_SETTINGS as the second argument so that any missing keys
     * are filled in with defaults automatically.
     *
     * In development outside of a Chrome extension context (e.g., in a
     * regular browser tab), chrome.storage won't exist. We fall back to
     * defaults so the UI is still usable for development.
     */
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.get(SETTINGS_KEY, (result) => {
        const stored = result[SETTINGS_KEY] || {};
        setSettings({ ...DEFAULT_SETTINGS, ...stored });
        setLoaded(true);
      });
    } else {
      // Development fallback: just use defaults
      console.warn(
        "[VisionTranslate] chrome.storage not available — using defaults. " +
          "This is normal during development outside of a Chrome extension."
      );
      setLoaded(true);
    }
  }, []);

  // ─── Persist settings to chrome.storage whenever they change ─────────
  useEffect(() => {
    // Don't write defaults back to storage before we've loaded real values
    if (!loaded) return;

    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    }
  }, [settings, loaded]);

  // ─── Apply dark mode class to the root HTML element ──────────────────
  useEffect(() => {
    document.documentElement.classList.toggle("dark", settings.darkMode);
  }, [settings.darkMode]);

  // ─── Check backend server reachability ───────────────────────────────
  useEffect(() => {
    if (!loaded) return;

    const checkServer = async () => {
      setServerStatus("checking");
      try {
        /**
         * We ping the backend's health endpoint. A real backend would expose
         * GET /health or GET /api/status that returns 200 OK. We use a short
         * timeout so the popup doesn't hang if the server is down.
         */
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);

        const response = await fetch(`${settings.backendUrl}/health`, {
          method: "GET",
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        setServerStatus(response.ok ? "online" : "offline");
      } catch {
        // Network error, timeout, or server unreachable
        setServerStatus("offline");
      }
    };

    checkServer();
    // Re-check whenever the backend URL changes
  }, [settings.backendUrl, loaded]);

  // ─── Generic setting updater ─────────────────────────────────────────
  /**
   * updateSetting creates a new settings object with one key changed.
   * We use the functional form of setState to avoid stale closures.
   */
  const updateSetting = useCallback((key, value) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  // ─── "Translate This Page" action ────────────────────────────────────
  const handleTranslatePage = useCallback(() => {
    /**
     * To trigger translation on the current page, we need to send a message
     * to the CONTENT SCRIPT running in the active tab. The flow is:
     *
     *   1. chrome.tabs.query finds the currently active tab.
     *   2. chrome.tabs.sendMessage sends a message to that tab's content script.
     *   3. The content script receives the message via chrome.runtime.onMessage
     *      and begins the OCR + translation pipeline.
     *
     * The message payload includes the current settings so the content script
     * knows which OCR engine and translation provider to use.
     */
    if (typeof chrome !== "undefined" && chrome.tabs) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, {
            action: "TRANSLATE_PAGE",
            settings: settings,
          });
        }
      });

      // Close the popup after triggering — the content script handles the rest
      window.close();
    } else {
      console.log(
        "[VisionTranslate] Would send TRANSLATE_PAGE message with settings:",
        settings
      );
    }
  }, [settings]);

  // ─── Don't render until settings are loaded ──────────────────────────
  if (!loaded) {
    return (
      <div className="popup-loading">
        <div className="spinner" />
        Loading settings...
      </div>
    );
  }

  // ─── Render ──────────────────────────────────────────────────────────
  return (
    <div className="popup-container">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="popup-header">
        <div className="popup-title-row">
          <h1 className="popup-title">VisionTranslate</h1>

          {/* Dark mode toggle */}
          <button
            className="dark-mode-toggle"
            onClick={() => updateSetting("darkMode", !settings.darkMode)}
            aria-label={
              settings.darkMode
                ? "Switch to light mode"
                : "Switch to dark mode"
            }
            title={settings.darkMode ? "Light mode" : "Dark mode"}
          >
            {/*
              Using simple text glyphs instead of emoji.
              A sun/moon icon library would be better in production.
            */}
            {settings.darkMode ? "Light" : "Dark"}
          </button>
        </div>

        {/* Server status indicator */}
        <div className="server-status">
          <span
            className={`status-dot status-${serverStatus}`}
            aria-hidden="true"
          />
          <span className="status-text">
            {serverStatus === "checking" && "Checking server..."}
            {serverStatus === "online" && "Backend server connected"}
            {serverStatus === "offline" && "Backend server unreachable"}
          </span>
        </div>
      </header>

      {/* ── Main scrollable content ────────────────────────────────── */}
      <main className="popup-content">
        {/* Section 1: OCR Engine Configuration */}
        <section className="settings-section">
          <h2 className="section-title">OCR Engine</h2>
          <OcrSettings
            engine={settings.ocrEngine}
            onEngineChange={(val) => updateSetting("ocrEngine", val)}
            backendUrl={settings.backendUrl}
            onBackendUrlChange={(val) => updateSetting("backendUrl", val)}
            googleCloudApiKey={settings.googleCloudApiKey}
            onGoogleCloudApiKeyChange={(val) =>
              updateSetting("googleCloudApiKey", val)
            }
          />
        </section>

        {/* Section 2: Translation Provider */}
        <section className="settings-section">
          <h2 className="section-title">Translation Provider</h2>
          <TranslateSettings
            provider={settings.translationProvider}
            onProviderChange={(val) =>
              updateSetting("translationProvider", val)
            }
            openaiApiKey={settings.openaiApiKey}
            onOpenaiApiKeyChange={(val) => updateSetting("openaiApiKey", val)}
            claudeApiKey={settings.claudeApiKey}
            onClaudeApiKeyChange={(val) => updateSetting("claudeApiKey", val)}
            geminiApiKey={settings.geminiApiKey}
            onGeminiApiKeyChange={(val) => updateSetting("geminiApiKey", val)}
            googleCloudApiKey={settings.googleCloudApiKey}
            onGoogleCloudApiKeyChange={(val) =>
              updateSetting("googleCloudApiKey", val)
            }
            llmModel={settings.llmModel}
            onLlmModelChange={(val) => updateSetting("llmModel", val)}
          />
        </section>

        {/* Section 3: Language Selection */}
        <section className="settings-section">
          <h2 className="section-title">Languages</h2>
          <LanguageSelector
            sourceLanguage={settings.sourceLanguage}
            onSourceChange={(val) => updateSetting("sourceLanguage", val)}
            targetLanguage={settings.targetLanguage}
            onTargetChange={(val) => updateSetting("targetLanguage", val)}
          />
        </section>

        {/* Section 4: Server Configuration */}
        <section className="settings-section">
          <h2 className="section-title">Server Configuration</h2>
          <div className="form-group">
            <label className="form-label" htmlFor="backend-url">
              Backend Server URL
            </label>
            <input
              id="backend-url"
              type="url"
              className="form-input"
              value={settings.backendUrl}
              onChange={(e) => updateSetting("backendUrl", e.target.value)}
              placeholder="http://localhost:8000"
            />
            <p className="form-hint">
              URL of the Python backend running PaddleOCR or MangaOCR. Only
              needed if you selected a server-based OCR engine above.
            </p>
          </div>
        </section>
      </main>

      {/* ── Footer with action button ──────────────────────────────── */}
      <footer className="popup-footer">
        <button
          className="translate-button"
          onClick={handleTranslatePage}
          disabled={serverStatus === "checking"}
        >
          Translate This Page
        </button>
      </footer>
    </div>
  );
}
