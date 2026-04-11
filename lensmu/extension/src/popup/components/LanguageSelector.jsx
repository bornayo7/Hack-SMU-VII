/**
 * LanguageSelector.jsx — Source and target language picker for VisionTranslate.
 *
 * HOW LANGUAGE SELECTION WORKS IN THE PIPELINE:
 *
 *   1. SOURCE LANGUAGE — The language of the text in the image being translated.
 *      "Auto-detect" means the OCR engine or translation API will try to figure
 *      out the language automatically. This works well for most cases but you can
 *      manually select a language if auto-detection is unreliable (e.g., when
 *      the image contains mixed languages).
 *
 *   2. TARGET LANGUAGE — The language to translate INTO. This is what the user
 *      wants to read. The translated text replaces or overlays the original.
 *
 * LANGUAGE CODES:
 * We use ISO 639-1 two-letter codes (e.g., "en" for English, "ja" for Japanese).
 * Some services use slightly different codes (e.g., Google uses "zh-CN" for
 * Simplified Chinese), so the translation layer may need to map these codes
 * to the specific service's format. The mapping is handled in the translation
 * module, not here — this component just stores the standard codes.
 *
 * PROPS:
 *   sourceLanguage — Current source language code (or "auto")
 *   onSourceChange — Callback when source language changes
 *   targetLanguage — Current target language code
 *   onTargetChange — Callback when target language changes
 */

import React, { useCallback } from "react";

/**
 * LANGUAGES — List of supported languages.
 * Each entry has:
 *   code  — ISO 639-1 code (used in settings and API calls)
 *   name  — English name (displayed in the dropdown)
 *   native — Name in the language itself (helps users identify their language)
 *
 * This list covers the most commonly translated languages. More can be added
 * by simply appending to this array — no other code changes needed.
 */
const LANGUAGES = [
  { code: "en", name: "English", native: "English" },
  { code: "ja", name: "Japanese", native: "\u65E5\u672C\u8A9E" },
  { code: "zh-CN", name: "Chinese (Simplified)", native: "\u7B80\u4F53\u4E2D\u6587" },
  { code: "zh-TW", name: "Chinese (Traditional)", native: "\u7E41\u9AD4\u4E2D\u6587" },
  { code: "ko", name: "Korean", native: "\uD55C\uAD6D\uC5B4" },
  { code: "es", name: "Spanish", native: "Espa\u00F1ol" },
  { code: "fr", name: "French", native: "Fran\u00E7ais" },
  { code: "de", name: "German", native: "Deutsch" },
  { code: "pt", name: "Portuguese", native: "Portugu\u00EAs" },
  { code: "ru", name: "Russian", native: "\u0420\u0443\u0441\u0441\u043A\u0438\u0439" },
  { code: "ar", name: "Arabic", native: "\u0627\u0644\u0639\u0631\u0628\u064A\u0629" },
  { code: "hi", name: "Hindi", native: "\u0939\u093F\u0928\u094D\u0926\u0940" },
  { code: "th", name: "Thai", native: "\u0E44\u0E17\u0E22" },
  { code: "vi", name: "Vietnamese", native: "Ti\u1EBFng Vi\u1EC7t" },
  { code: "it", name: "Italian", native: "Italiano" },
];

/**
 * Swap button handler — swaps source and target languages.
 * Only works when source is not "auto" (since auto-detect can't be a target).
 */

export default function LanguageSelector({
  sourceLanguage,
  onSourceChange,
  targetLanguage,
  onTargetChange,
}) {
  /**
   * handleSwap — Swaps source and target languages with one click.
   * Disabled when source is "auto" because "auto" is not a valid target language.
   */
  const handleSwap = useCallback(() => {
    if (sourceLanguage === "auto") return;
    const prevSource = sourceLanguage;
    const prevTarget = targetLanguage;
    onSourceChange(prevTarget);
    onTargetChange(prevSource);
  }, [sourceLanguage, targetLanguage, onSourceChange, onTargetChange]);

  return (
    <div className="language-selector">
      {/* ── Source Language ──────────────────────────────────────────── */}
      <div className="form-group">
        <label className="form-label" htmlFor="source-language">
          Source Language (translate FROM)
        </label>
        <select
          id="source-language"
          className="form-select"
          value={sourceLanguage}
          onChange={(e) => onSourceChange(e.target.value)}
        >
          {/*
            "Auto-detect" is the first option. When selected, the OCR engine
            or translation API will attempt to determine the language. This is
            the default and works well for most single-language content.
          */}
          <option value="auto">Auto-detect</option>

          {/*
            Separator between auto-detect and manual options.
            The disabled option acts as a visual divider.
          */}
          <option disabled>---</option>

          {LANGUAGES.map((lang) => (
            <option key={`source-${lang.code}`} value={lang.code}>
              {lang.name} ({lang.native})
            </option>
          ))}
        </select>
        <p className="form-hint">
          Auto-detect works best when the image contains text in a single
          language. Select manually if detection is unreliable.
        </p>
      </div>

      {/* ── Swap Button ─────────────────────────────────────────────── */}
      <div className="language-swap-container">
        <button
          type="button"
          className="language-swap-button"
          onClick={handleSwap}
          disabled={sourceLanguage === "auto"}
          aria-label="Swap source and target languages"
          title={
            sourceLanguage === "auto"
              ? "Cannot swap when source is auto-detect"
              : "Swap languages"
          }
        >
          {/*
            Arrow glyphs for the swap button. Using Unicode arrows
            to keep the component dependency-free.
          */}
          <span aria-hidden="true">&#8593;&#8595;</span>
        </button>
      </div>

      {/* ── Target Language ─────────────────────────────────────────── */}
      <div className="form-group">
        <label className="form-label" htmlFor="target-language">
          Target Language (translate TO)
        </label>
        <select
          id="target-language"
          className="form-select"
          value={targetLanguage}
          onChange={(e) => onTargetChange(e.target.value)}
        >
          {LANGUAGES.map((lang) => (
            <option key={`target-${lang.code}`} value={lang.code}>
              {lang.name} ({lang.native})
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
