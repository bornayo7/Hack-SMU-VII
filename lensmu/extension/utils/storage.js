/*
 * ==========================================================================
 * VisionTranslate — Chrome Storage Helpers (utils/storage.js)
 * ==========================================================================
 *
 * WHAT IS CHROME STORAGE?
 * -----------------------
 * chrome.storage is the extension's built-in key-value database. It's like
 * localStorage but with important differences:
 *
 *   1. It's available in ALL extension contexts (background service worker,
 *      content scripts, popup, options page) — unlike localStorage which
 *      is per-origin.
 *
 *   2. It's ASYNCHRONOUS — you always use Promises or callbacks. This is
 *      because data might be stored on disk, not just in memory.
 *
 *   3. It can hold STRUCTURED data (objects, arrays) without JSON.stringify.
 *      Chrome automatically serializes/deserializes for you.
 *
 *   4. It has an event system (chrome.storage.onChanged) that notifies all
 *      extension contexts when data changes.
 *
 * TWO STORAGE AREAS:
 * ------------------
 *   chrome.storage.local:
 *     - Data stays on this machine only.
 *     - ~10MB limit (practically unlimited for settings).
 *     - Best for: API keys, large data, machine-specific settings.
 *     - This is what we use because API keys should not be synced.
 *
 *   chrome.storage.sync:
 *     - Data syncs across devices via the user's Google/Firefox account.
 *     - ~100KB total limit, ~8KB per item.
 *     - Best for: UI preferences, language selection (small data that
 *       the user wants on all their devices).
 *     - We avoid this for API keys (they should stay local).
 *
 * HOW TO USE:
 * -----------
 *   Reading:  chrome.storage.local.get(['key1', 'key2'])
 *             → Returns an object: { key1: value1, key2: value2 }
 *             → Missing keys are simply absent from the result (no error).
 *
 *   Writing:  chrome.storage.local.set({ key1: value1, key2: value2 })
 *             → Merges with existing data (does NOT delete other keys).
 *
 *   Deleting: chrome.storage.local.remove(['key1'])
 *             → Removes specific keys.
 *
 *   Clear:    chrome.storage.local.clear()
 *             → Removes ALL data. Use with caution!
 * ==========================================================================
 */

/*
 * --------------------------------------------------------------------------
 * Storage Keys
 * --------------------------------------------------------------------------
 * We use a single top-level key for settings, prefixed to avoid collisions
 * with other data we might store (like tab states in background.js).
 *
 * Using a constant prevents typos — if you misspell a string key, you get
 * undefined back with no error. With a constant, you get a ReferenceError.
 */
const SETTINGS_KEY = 'vt_settings';
const API_KEYS_KEY = 'vt_api_keys';

/*
 * --------------------------------------------------------------------------
 * Default Settings
 * --------------------------------------------------------------------------
 * These are the factory defaults for all extension settings. When the
 * extension is first installed, or if a setting is missing from storage,
 * we fall back to these values.
 *
 * Each setting is documented with:
 *   - What it controls
 *   - Valid values
 *   - Why the default was chosen
 */
const DEFAULT_SETTINGS = {
  /*
   * targetLanguage: The language to translate text INTO.
   * Uses ISO 639-1 two-letter language codes (same as used by Google
   * Translate, DeepL, etc.).
   *
   * Default: 'en' (English) — the most commonly requested target.
   *
   * Common codes:
   *   'en' = English    'es' = Spanish    'fr' = French
   *   'de' = German     'ja' = Japanese   'ko' = Korean
   *   'zh' = Chinese    'pt' = Portuguese 'ru' = Russian
   *   'ar' = Arabic     'hi' = Hindi      'it' = Italian
   */
  targetLanguage: 'en',

  /*
   * sourceLanguage: The language to translate FROM.
   * 'auto' means automatic detection (the OCR/translation engine
   * will try to detect the source language).
   *
   * Default: 'auto' — most flexible for general browsing.
   */
  sourceLanguage: 'auto',

  /*
   * translationProvider: Which translation service to use.
   *
   * Options:
   *   'libre'    — LibreTranslate / MyMemory (free, no API key needed).
   *   'openai'   — OpenAI GPT translation (requires API key).
   *   'claude'   — Anthropic Claude translation (requires API key).
   *   'gemini'   — Google Gemini translation (requires API key).
   *   'custom'   — OpenAI-compatible custom API endpoint.
   *
   * Default: 'libre' — works out of the box, no setup needed.
   */
  translationProvider: 'libre',

  /*
   * backendUrl: URL of the local OCR/translation backend server.
   * Change this if your backend runs on a different port or host.
   *
   * Default: 'http://localhost:8000' — standard local development.
   */
  backendUrl: 'http://localhost:8000',

  /* API keys and provider-specific settings */
  googleCloudApiKey: '',
  customOcrUrl: '',
  customOcrApiKey: '',
  openaiApiKey: '',
  claudeApiKey: '',
  geminiApiKey: '',
  customApiKey: '',
  customBaseUrl: '',
  customModelName: '',
  llmModel: 'gemini-2.0-flash',

  /*
   * minImageWidth / minImageHeight: Minimum dimensions (in pixels) for
   * an image to be considered for OCR. Smaller images are skipped.
   *
   * These correspond to the MIN_IMAGE_WIDTH and MIN_IMAGE_HEIGHT
   * constants in content.js. Having them in settings allows the user
   * to customize the threshold.
   *
   * Default: 100x50 — skips icons and tiny decorative images.
   */
  minImageWidth: 100,
  minImageHeight: 50,

  /*
   * showConfidenceBorders: Whether to show colored borders around
   * translated text blocks indicating OCR confidence level.
   *
   * Green = high confidence, Yellow = medium, Red = low.
   *
   * Default: true — helpful for users to know which translations
   * might be unreliable.
   */
  showConfidenceBorders: true,

  /*
   * autoTranslate: If true, automatically start translating when the
   * extension is activated on a page. If false, the user must click
   * a "Translate" button in the toolbar.
   *
   * Default: true — immediate gratification.
   */
  autoTranslate: true,

  /*
   * maxConcurrentImages: Maximum number of images to process in
   * parallel. Higher = faster but more resource-intensive.
   *
   * Default: 5 — good balance for most machines and network speeds.
   */
  maxConcurrentImages: 5,

  /*
   * ocrEngine: Which OCR engine to use on the backend.
   *
   * Options:
   *   'tesseract'  — Tesseract OCR (open source, runs locally).
   *   'easyocr'    — EasyOCR (Python-based, good for many languages).
   *   'cloud'      — Cloud OCR (Google Cloud Vision, Azure CV, etc.).
   *
   * Default: 'tesseract' — free and works offline.
   */
  ocrEngine: 'tesseract',

  /*
   * Overlay text appearance and interface preferences.
   */
  fontOverride: '',
  overlayFontFamily: 'sans',
  overlayMinFontSize: 10,
  overlayTextAlign: 'auto',
  darkMode: false,
  contextSharingEnabled: false,

  /*
   * overlayOpacity: Opacity of the translation overlay (0.0 to 1.0).
   * 1.0 = fully opaque (completely covers original text).
   * Lower values let the original text show through.
   *
   * Default: 1.0 — fully opaque for clean translation display.
   */
  overlayOpacity: 1.0
};

/*
 * --------------------------------------------------------------------------
 * getSettings()
 * --------------------------------------------------------------------------
 * Reads the current settings from chrome.storage.local. If no settings
 * are stored yet (first run), returns the DEFAULT_SETTINGS.
 *
 * Merges stored settings with defaults so that new settings added in
 * future versions are automatically populated with their defaults,
 * even if the user has old stored settings that don't include them.
 *
 * @returns {Promise<object>} — The settings object with all fields populated.
 *
 * USAGE:
 *   const settings = await getSettings();
 *   console.log(settings.targetLanguage); // 'en'
 */
export async function getSettings() {
  try {
    /*
     * Read ALL keys from storage. The popup saves settings as top-level
     * keys (e.g., { translationProvider: "gemini", geminiApiKey: "..." }).
     * Using get(null) reads everything, including keys like geminiApiKey
     * that aren't in DEFAULT_SETTINGS.
     */
    const result = await chrome.storage.local.get(null);
    return { ...DEFAULT_SETTINGS, ...result };
  } catch (error) {
    console.error('[VisionTranslate] Error reading settings:', error);
    return { ...DEFAULT_SETTINGS };
  }
}

/*
 * --------------------------------------------------------------------------
 * saveSettings()
 * --------------------------------------------------------------------------
 * Writes settings to chrome.storage.local. Only saves the fields that
 * differ from defaults to keep storage lean (optional optimization —
 * we actually save all fields for simplicity).
 *
 * @param {object} settings — The settings object to save.
 *        Does NOT need to include every field — only include fields
 *        you want to update. Other fields remain unchanged.
 *
 * @returns {Promise<void>}
 *
 * USAGE:
 *   await saveSettings({ targetLanguage: 'es' });
 *   // Only targetLanguage is updated; other settings are unchanged.
 */
export async function saveSettings(settings) {
  try {
    /*
     * Read current settings first, then merge in the new ones.
     * This allows partial updates: you can save just one field
     * without wiping the others.
     */
    const current = await getSettings();
    const merged = { ...current, ...settings };

    /*
     * chrome.storage.local.set() writes the data. It merges at the
     * TOP level (our SETTINGS_KEY), but we're replacing the entire
     * settings object anyway, so that's fine.
     */
    await chrome.storage.local.set(merged);

    console.log('[VisionTranslate] Settings saved:', merged);
  } catch (error) {
    console.error('[VisionTranslate] Error saving settings:', error);
    throw error; /* Re-throw so the caller knows it failed */
  }
}

/*
 * --------------------------------------------------------------------------
 * getApiKeys()
 * --------------------------------------------------------------------------
 * Reads API keys from a SEPARATE storage key. We keep API keys separate
 * from general settings for two reasons:
 *
 *   1. Security: API keys should never be synced to the cloud (we use
 *      chrome.storage.local, not sync, but having them separate makes
 *      it even harder to accidentally include them in a sync operation).
 *
 *   2. Access control: In a future version, we might encrypt API keys
 *      or use different security measures for them.
 *
 * @returns {Promise<object>} — An object with provider names as keys
 *          and API key strings as values.
 *
 * USAGE:
 *   const keys = await getApiKeys();
 *   console.log(keys.google); // 'AIza...'
 *   console.log(keys.deepl);  // 'abc123...'
 */
export async function getApiKeys() {
  try {
    const result = await chrome.storage.local.get(API_KEYS_KEY);
    return result[API_KEYS_KEY] || {
      /*
       * Default structure: all keys empty. The user fills these in
       * through the popup settings page.
       */
      google: '',
      deepl: '',
      azure: ''
    };
  } catch (error) {
    console.error('[VisionTranslate] Error reading API keys:', error);
    return { google: '', deepl: '', azure: '' };
  }
}

/*
 * --------------------------------------------------------------------------
 * saveApiKey()
 * --------------------------------------------------------------------------
 * Saves an API key for a specific provider. Only updates the specified
 * provider's key; other providers' keys are unchanged.
 *
 * @param {string} provider — The provider name ('google', 'deepl', 'azure')
 * @param {string} key — The API key string
 * @returns {Promise<void>}
 *
 * USAGE:
 *   await saveApiKey('google', 'AIzaSyB...');
 */
export async function saveApiKey(provider, key) {
  try {
    const current = await getApiKeys();
    current[provider] = key;
    await chrome.storage.local.set({ [API_KEYS_KEY]: current });
    console.log(`[VisionTranslate] API key saved for provider: ${provider}`);
  } catch (error) {
    console.error('[VisionTranslate] Error saving API key:', error);
    throw error;
  }
}

/*
 * --------------------------------------------------------------------------
 * removeApiKey()
 * --------------------------------------------------------------------------
 * Removes (clears) the API key for a specific provider.
 *
 * @param {string} provider — The provider name
 * @returns {Promise<void>}
 */
export async function removeApiKey(provider) {
  await saveApiKey(provider, '');
}

/*
 * --------------------------------------------------------------------------
 * clearAllData()
 * --------------------------------------------------------------------------
 * Removes ALL extension data from storage. This is a DESTRUCTIVE operation
 * — it deletes settings, API keys, and everything else.
 *
 * Use case: "Factory reset" in the settings UI.
 *
 * @returns {Promise<void>}
 */
/*
 * --------------------------------------------------------------------------
 * Disabled Domains (Per-Site Blacklist)
 * --------------------------------------------------------------------------
 * The extension is ON by default for all websites. When the user manually
 * disables it on a site, the domain is stored here so it stays off on
 * future visits. Toggling it back on removes the domain from this list.
 */
const DISABLED_DOMAINS_KEY = 'vt_disabled_domains';

export async function getDisabledDomains() {
  try {
    const result = await chrome.storage.local.get(DISABLED_DOMAINS_KEY);
    return result[DISABLED_DOMAINS_KEY] || [];
  } catch (error) {
    console.error('[VisionTranslate] Error reading disabled domains:', error);
    return [];
  }
}

export async function addDisabledDomain(hostname) {
  const domains = await getDisabledDomains();
  if (!domains.includes(hostname)) {
    domains.push(hostname);
    await chrome.storage.local.set({ [DISABLED_DOMAINS_KEY]: domains });
  }
}

export async function removeDisabledDomain(hostname) {
  const domains = await getDisabledDomains();
  const filtered = domains.filter(d => d !== hostname);
  await chrome.storage.local.set({ [DISABLED_DOMAINS_KEY]: filtered });
}

export async function clearAllData() {
  try {
    await chrome.storage.local.clear();
    console.log('[VisionTranslate] All storage data cleared');
  } catch (error) {
    console.error('[VisionTranslate] Error clearing storage:', error);
    throw error;
  }
}

/*
 * --------------------------------------------------------------------------
 * onSettingsChanged()
 * --------------------------------------------------------------------------
 * Registers a callback that fires whenever settings change in storage.
 * This uses Chrome's storage.onChanged event, which fires in ALL extension
 * contexts when any context writes to storage.
 *
 * This is how the popup can notify the content script of changes without
 * direct message passing — both listen for storage changes.
 *
 * @param {function(newSettings: object, oldSettings: object): void} callback
 *        Called with the new and old settings objects.
 *
 * @returns {function(): void}
 *        A function to call to unsubscribe (remove the listener).
 *
 * USAGE:
 *   const unsubscribe = onSettingsChanged((newSettings, oldSettings) => {
 *     if (newSettings.targetLanguage !== oldSettings.targetLanguage) {
 *       console.log('Language changed!');
 *     }
 *   });
 *
 *   // Later, to stop listening:
 *   unsubscribe();
 */
export function onSettingsChanged(callback) {
  /*
   * chrome.storage.onChanged fires for ALL storage changes. We filter
   * to only call our callback when the settings key changes.
   *
   * The listener receives:
   *   changes: { [key]: { oldValue, newValue } }
   *   areaName: 'local', 'sync', or 'managed'
   */
  const listener = (changes, areaName) => {
    /* Only respond to changes in local storage */
    if (areaName !== 'local') return;

    /* Only respond to changes to our settings key */
    if (!changes[SETTINGS_KEY]) return;

    const { oldValue, newValue } = changes[SETTINGS_KEY];

    /*
     * Merge with defaults to ensure all fields are present,
     * even if the stored data is partial.
     */
    const oldSettings = { ...DEFAULT_SETTINGS, ...(oldValue || {}) };
    const newSettings = { ...DEFAULT_SETTINGS, ...(newValue || {}) };

    callback(newSettings, oldSettings);
  };

  chrome.storage.onChanged.addListener(listener);

  /*
   * Return an unsubscribe function. Calling this removes the listener.
   * This is a common pattern (also used by React's useEffect cleanup,
   * event emitters, etc.) to prevent memory leaks.
   */
  return () => {
    chrome.storage.onChanged.removeListener(listener);
  };
}
