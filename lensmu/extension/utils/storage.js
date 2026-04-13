// Chrome storage helpers for extension settings and API keys.

const SETTINGS_KEY = 'vt_settings';
const API_KEYS_KEY = 'vt_api_keys';

const DEFAULT_SETTINGS = {
  targetLanguage: 'en',
  sourceLanguage: 'auto',
  translationProvider: 'libre',
  backendUrl: 'http://localhost:8000',
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
  enableReadAloud: false,
  elevenLabsApiKey: '',
  elevenLabsVoiceId: '',
  elevenLabsModelId: 'eleven_flash_v2_5',
  elevenLabsOutputFormat: 'mp3_44100_128',
  elevenLabsStability: 0.5,
  elevenLabsSimilarityBoost: 0.75,
  elevenLabsStyle: 0,
  elevenLabsSpeed: 1,
  minImageWidth: 100,
  minImageHeight: 50,
  showConfidenceBorders: true,
  autoTranslate: true,
  maxConcurrentImages: 5,
  ocrEngine: 'tesseract',
  fontOverride: '',
  overlayFontFamily: 'sans',
  overlayMinFontSize: 10,
  overlayTextAlign: 'auto',
  darkMode: false,
  contextSharingEnabled: false,
  overlayOpacity: 1.0
};

function redactSecretsForLog(settings = {}) {
  return Object.fromEntries(
    Object.entries(settings).map(([key, value]) => {
      if (/api.?key|token|secret/i.test(key)) {
        return [key, value ? '[redacted]' : ''];
      }

      return [key, value];
    })
  );
}

// Reads settings, merging stored values over defaults.
export async function getSettings() {
  try {
    const result = await chrome.storage.local.get(null);
    return { ...DEFAULT_SETTINGS, ...result };
  } catch (error) {
    console.error('[VisionTranslate] Error reading settings:', error);
    return { ...DEFAULT_SETTINGS };
  }
}

// Merges partial settings update into stored settings.
export async function saveSettings(settings) {
  try {
    const current = await getSettings();
    const merged = { ...current, ...settings };
    await chrome.storage.local.set(merged);
    console.log('[VisionTranslate] Settings saved:', redactSecretsForLog(merged));
  } catch (error) {
    console.error('[VisionTranslate] Error saving settings:', error);
    throw error;
  }
}

export async function getApiKeys() {
  try {
    const result = await chrome.storage.local.get(API_KEYS_KEY);
    return result[API_KEYS_KEY] || { google: '', deepl: '', azure: '' };
  } catch (error) {
    console.error('[VisionTranslate] Error reading API keys:', error);
    return { google: '', deepl: '', azure: '' };
  }
}

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

export async function removeApiKey(provider) {
  await saveApiKey(provider, '');
}

// Per-domain disable list. Extension is ON by default; disabling a site adds it here.
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

// Subscribe to settings changes across all extension contexts. Returns unsubscribe fn.
export function onSettingsChanged(callback) {
  const listener = (changes, areaName) => {
    if (areaName !== 'local') return;
    if (!changes[SETTINGS_KEY]) return;

    const { oldValue, newValue } = changes[SETTINGS_KEY];
    const oldSettings = { ...DEFAULT_SETTINGS, ...(oldValue || {}) };
    const newSettings = { ...DEFAULT_SETTINGS, ...(newValue || {}) };

    callback(newSettings, oldSettings);
  };

  chrome.storage.onChanged.addListener(listener);

  return () => {
    chrome.storage.onChanged.removeListener(listener);
  };
}
