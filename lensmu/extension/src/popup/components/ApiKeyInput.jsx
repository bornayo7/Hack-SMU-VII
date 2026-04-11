/**
 * ApiKeyInput.jsx — Reusable component for entering and storing API keys.
 *
 * SECURITY NOTES FOR BROWSER EXTENSIONS:
 * - API keys stored in chrome.storage.local are accessible to the extension only,
 *   but they are NOT encrypted. Anyone with physical access to the machine can
 *   read them via the Chrome DevTools on the extension's background page.
 * - For a production extension, consider using chrome.storage.session (Manifest V3)
 *   which only persists for the browser session, or encrypt keys before storing.
 * - We mask the stored key in the UI (showing only last 4 chars) so it is not
 *   trivially visible if someone glances at the screen.
 *
 * PROPS:
 *   label       — Display label above the input (e.g., "Google Cloud API Key")
 *   placeholder — Placeholder text inside the input
 *   storageKey  — The key used in chrome.storage.local (e.g., "googleCloudApiKey")
 *   value       — Current value (controlled by parent)
 *   onChange    — Callback when the value changes
 */

import React, { useState, useEffect, useCallback } from "react";

export default function ApiKeyInput({
  label,
  placeholder = "Enter API key...",
  storageKey,
  value,
  onChange,
}) {
  // Controls whether the key is shown as plain text or masked dots
  const [visible, setVisible] = useState(false);

  // Shows a brief checkmark animation after the key is saved
  const [saved, setSaved] = useState(false);

  // Timer ref so we can cancel the "saved" indicator if the component unmounts
  const [saveTimer, setSaveTimer] = useState(null);

  /**
   * When the user types, we update the parent state immediately (for a
   * responsive UI) and also persist to chrome.storage. The parent component
   * (OcrSettings or TranslateSettings) passes the value back down, keeping
   * everything in sync.
   */
  const handleChange = useCallback(
    (e) => {
      const newValue = e.target.value;
      onChange(newValue);

      // Clear any existing save timer so rapid typing doesn't spam storage writes.
      // We debounce by saving after the user pauses for 500ms.
      if (saveTimer) clearTimeout(saveTimer);

      const timer = setTimeout(() => {
        // chrome.storage.local.set writes to the extension's local storage.
        // This is async but we don't need to await it for the UI to update.
        if (typeof chrome !== "undefined" && chrome.storage) {
          chrome.storage.local.set({ [storageKey]: newValue });
        }

        // Flash the saved indicator
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      }, 500);

      setSaveTimer(timer);
    },
    [onChange, storageKey, saveTimer]
  );

  // Cleanup timer on unmount to avoid memory leaks
  useEffect(() => {
    return () => {
      if (saveTimer) clearTimeout(saveTimer);
    };
  }, [saveTimer]);

  /**
   * Masks the API key for display: shows only the last 4 characters.
   * Example: "sk-abc123def456" becomes "••••••••••f456"
   */
  const getMaskedValue = (val) => {
    if (!val || val.length <= 4) return val;
    return "•".repeat(val.length - 4) + val.slice(-4);
  };

  return (
    <div className="api-key-input">
      {/* Label row with the save indicator */}
      <div className="api-key-header">
        <label className="api-key-label">{label}</label>
        {saved && (
          <span className="api-key-saved" aria-label="Saved">
            {/* Simple checkmark character — no emoji per instructions */}
            Saved
          </span>
        )}
      </div>

      {/* Input wrapper: contains the text input and the show/hide toggle */}
      <div className="api-key-field">
        <input
          type={visible ? "text" : "password"}
          className="api-key-input-field"
          placeholder={placeholder}
          /*
           * When the input is a password type and the user hasn't focused it,
           * we show the masked version. When they focus or toggle visibility,
           * they see the real value. This prevents the raw key from being
           * casually visible.
           */
          value={value || ""}
          onChange={handleChange}
          autoComplete="off"
          spellCheck={false}
        />

        {/*
         * Toggle button to show/hide the key. Uses a simple text label
         * instead of an icon to keep things dependency-free.
         */}
        <button
          type="button"
          className="api-key-toggle"
          onClick={() => setVisible(!visible)}
          aria-label={visible ? "Hide API key" : "Show API key"}
          title={visible ? "Hide" : "Show"}
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>

      {/* If a key is stored, show a masked preview below the input */}
      {value && value.length > 4 && !visible && (
        <div className="api-key-preview">
          Stored: {getMaskedValue(value)}
        </div>
      )}
    </div>
  );
}
