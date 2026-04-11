/**
 * =============================================================================
 * GOOGLE CLOUD TRANSLATION — Google Translate API v2 Wrapper
 * =============================================================================
 *
 * WHAT THIS FILE DOES:
 * --------------------
 * Sends text to Google's Cloud Translation API and returns translated text.
 * This is one of the most reliable translation providers — it supports 100+
 * languages and handles CJK text well.
 *
 * API DETAILS:
 * ------------
 * We use the Translation API v2 (Basic). There's also v3 (Advanced) but v2
 * is simpler to set up and sufficient for our needs.
 *
 * Endpoint: https://translation.googleapis.com/language/translate/v2
 * Auth:     API key passed as a query parameter
 * Method:   POST with JSON body
 *
 * PRICING (as of 2025):
 * ---------------------
 *   - First 500,000 characters/month: FREE
 *   - After that: $20 per 1 million characters
 *   - A typical manga page has ~200 characters, so 500K chars ≈ 2,500 pages free.
 *
 * HOW TO GET AN API KEY:
 * ----------------------
 *   1. Go to https://console.cloud.google.com
 *   2. Create a project (or select existing one)
 *   3. Enable "Cloud Translation API" in the API Library
 *   4. Go to Credentials → Create Credentials → API Key
 *   5. (Recommended) Restrict the key to "Cloud Translation API" only
 *
 * BATCH TRANSLATION:
 * ------------------
 * The API supports sending multiple text strings in a single request using
 * the `q` parameter as an array. This is much more efficient than sending
 * one request per text block — fewer HTTP roundtrips and lower latency.
 *
 * We batch up to 128 strings per request (API limit). If there are more,
 * we split them into multiple batches.
 * =============================================================================
 */

/**
 * Maximum number of text segments per API request.
 * Google's API allows up to 128 segments in a single batch request.
 */
const MAX_BATCH_SIZE = 128;

/**
 * Google Cloud Translation API v2 base URL.
 */
const API_URL = 'https://translation.googleapis.com/language/translate/v2';

/**
 * Translate an array of text strings using Google Cloud Translation API.
 *
 * @param {string[]} texts      — Array of strings to translate
 * @param {string}   sourceLang — Source language code ("auto" for auto-detect, "ja", "en", etc.)
 * @param {string}   targetLang — Target language code ("en", "es", etc.)
 * @param {string}   apiKey     — Google Cloud API key
 * @returns {Promise<Object>}   — { translations: string[], sourceLang, targetLang, provider }
 */
export async function translateWithGoogle(texts, sourceLang, targetLang, apiKey) {
  /*
   * If we have more texts than the batch limit, split into chunks.
   * Each chunk is translated in a separate API call, then we concatenate
   * the results back together in order.
   */
  if (texts.length > MAX_BATCH_SIZE) {
    return translateInBatches(texts, sourceLang, targetLang, apiKey);
  }

  /*
   * Build the request body.
   *
   * Google's v2 API expects:
   *   {
   *     "q": ["text1", "text2", ...],   // strings to translate
   *     "target": "en",                  // target language
   *     "source": "ja",                  // source language (omit for auto-detect)
   *     "format": "text"                 // "text" or "html"
   *   }
   *
   * The "format" parameter tells Google whether to interpret HTML tags.
   * We use "text" because OCR output is plain text, not HTML.
   */
  const body = {
    q: texts,
    target: targetLang,
    format: 'text'
  };

  /*
   * Only include the "source" field if the user specified a language.
   * If sourceLang is "auto" (or empty), we omit it and let Google
   * auto-detect the source language. Google is very good at detection —
   * it uses the same model as translate.google.com.
   */
  if (sourceLang && sourceLang !== 'auto') {
    body.source = sourceLang;
  }

  /*
   * Make the API request.
   *
   * The API key is passed as a URL parameter, not in headers. This is
   * Google's standard pattern for simple API key auth (as opposed to
   * OAuth2 which uses Authorization headers).
   */
  const response = await fetch(`${API_URL}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  /*
   * Handle HTTP errors.
   *
   * Common error codes:
   *   400 — Bad request (invalid language code, empty text)
   *   401 — Invalid API key
   *   403 — API not enabled for this project, or key restrictions block this API
   *   429 — Rate limit exceeded (too many requests per second)
   *   500 — Google's server error (rare, retry might help)
   */
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const errorMessage = errorBody?.error?.message || response.statusText;
    const errorCode = errorBody?.error?.code || response.status;

    throw new Error(
      `Google Translation API error (${errorCode}): ${errorMessage}`
    );
  }

  /*
   * Parse the response.
   *
   * Successful response format:
   * {
   *   "data": {
   *     "translations": [
   *       {
   *         "translatedText": "Hello",
   *         "detectedSourceLanguage": "ja"  // only if source was auto-detected
   *       },
   *       {
   *         "translatedText": "World",
   *         "detectedSourceLanguage": "ja"
   *       }
   *     ]
   *   }
   * }
   *
   * The translations array is in the SAME ORDER as the input `q` array.
   */
  const data = await response.json();
  const rawTranslations = data?.data?.translations || [];

  /*
   * Extract the translated text strings and the detected source language.
   *
   * Google HTML-encodes some characters in the response (like & → &amp;).
   * We decode these back to plain text since our overlay renders raw text,
   * not HTML.
   */
  const translations = rawTranslations.map((t) => decodeHtmlEntities(t.translatedText || ''));

  /*
   * If the source language was auto-detected, grab it from the first
   * translation result. All segments in a batch typically detect as the
   * same language, so the first one is representative.
   */
  const detectedLang = rawTranslations[0]?.detectedSourceLanguage || sourceLang;

  return {
    translations,
    sourceLang: detectedLang,
    targetLang,
    provider: 'google'
  };
}

/**
 * Handle large arrays by splitting into batches of MAX_BATCH_SIZE.
 *
 * We process batches sequentially (not in parallel) to avoid hitting
 * Google's rate limit. Each batch is a separate API call.
 *
 * @param {string[]} texts      — All text strings
 * @param {string}   sourceLang — Source language
 * @param {string}   targetLang — Target language
 * @param {string}   apiKey     — API key
 * @returns {Promise<Object>}   — Combined result
 */
async function translateInBatches(texts, sourceLang, targetLang, apiKey) {
  const allTranslations = [];
  let detectedLang = sourceLang;

  for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
    const batch = texts.slice(i, i + MAX_BATCH_SIZE);
    const result = await translateWithGoogle(batch, sourceLang, targetLang, apiKey);
    allTranslations.push(...result.translations);

    /*
     * Use the detected language from the first batch for consistency.
     */
    if (i === 0) {
      detectedLang = result.sourceLang;
    }
  }

  return {
    translations: allTranslations,
    sourceLang: detectedLang,
    targetLang,
    provider: 'google'
  };
}

/**
 * Decode HTML entities in a string.
 *
 * Google's API sometimes returns HTML-encoded text (e.g., &amp; for &,
 * &#39; for ', &quot; for "). Since we render text on a canvas (not in
 * HTML), we need the raw characters.
 *
 * We handle the most common entities manually rather than using DOMParser
 * (which isn't available in service workers).
 *
 * @param {string} text — Text with possible HTML entities
 * @returns {string}    — Decoded plain text
 */
function decodeHtmlEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&nbsp;/g, ' ');
}
