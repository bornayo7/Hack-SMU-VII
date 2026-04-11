/**
 * =============================================================================
 * OCR MANAGER — The Central Hub for All OCR (Optical Character Recognition)
 * =============================================================================
 *
 * WHAT THIS FILE DOES:
 * --------------------
 * This is the "router" for OCR requests. When the user captures a screenshot of
 * text (say, from a manga page or a sign in a photo), that image needs to be
 * converted into actual text characters. This process is called OCR.
 *
 * There are multiple OCR "engines" (services/libraries) that can do this, each
 * with different tradeoffs:
 *
 *   1. Tesseract.js   — Runs entirely in the browser (no server needed!).
 *                        Free, but slower and less accurate on complex text.
 *
 *   2. Cloud Vision    — Google's OCR API. Very accurate, handles CJK (Chinese,
 *                        Japanese, Korean) well, but requires an API key and
 *                        costs money after the free tier.
 *
 *   3. PaddleOCR       — An open-source ML model that runs on a local Python
 *                        server. Great for CJK text. Free, but the user must
 *                        run our FastAPI backend.
 *
 *   4. Manga OCR       — A specialized model for Japanese manga text. Runs on
 *                        our local backend. Extremely accurate for manga but
 *                        only handles Japanese.
 *
 * HOW BROWSER EXTENSIONS WORK (relevant context):
 * ------------------------------------------------
 * Browser extensions have multiple "contexts" where JavaScript can run:
 *
 *   - Background script (service worker): Runs in the background, no DOM access.
 *     This is where we typically do API calls and manage state.
 *
 *   - Content script: Injected into web pages. Can see/modify the page DOM but
 *     has limited API access.
 *
 *   - Popup: The small window when you click the extension icon.
 *
 * This OCR manager is designed to work in the background script context. It
 * receives image data from content scripts (via Chrome's message passing) and
 * returns recognized text.
 *
 * NORMALIZED OUTPUT FORMAT:
 * -------------------------
 * No matter which engine we use, we always return results in the same shape:
 *
 *   [{
 *     text: "Hello world",           // The recognized text string
 *     bbox: [x1, y1, x2, y2],       // Bounding box: top-left and bottom-right corners
 *     confidence: 0.95,              // How sure the engine is (0.0 to 1.0)
 *     orientation: "horizontal"      // "horizontal" or "vertical" text direction
 *   }]
 *
 * This normalization is crucial because downstream code (like the text overlay
 * renderer) doesn't need to know which engine was used — it just works with
 * the standardized format.
 *
 * =============================================================================
 */

// ---------------------------------------------------------------------------
// Import the individual OCR engine wrappers.
// Each wrapper knows how to talk to its specific engine and return results
// in our normalized format.
// ---------------------------------------------------------------------------
import { recognize as tesseractRecognize } from './tesseract.js';
import { recognize as cloudVisionRecognize } from './cloud-vision.js';
import { recognizePaddle, recognizeManga } from './backend-ocr.js';

/**
 * performOCR — The main entry point for all OCR operations.
 *
 * This function is called whenever we need to extract text from an image.
 * It figures out which OCR engine the user has selected in their settings,
 * calls that engine, and returns the normalized results.
 *
 * @param {string} imageBase64 - The image data encoded as a Base64 string.
 *   Base64 is a way to represent binary data (like an image) as plain text.
 *   This is necessary because Chrome's message passing system (used to send
 *   data between content scripts and background scripts) only supports text,
 *   not raw binary data.
 *
 *   Example: "data:image/png;base64,iVBORw0KGgo..." or just "iVBORw0KGgo..."
 *   We handle both formats — with or without the "data:image/..." prefix.
 *
 * @param {string} engine - Which OCR engine to use. One of:
 *   - "tesseract"    : Client-side Tesseract.js
 *   - "cloud-vision" : Google Cloud Vision API
 *   - "paddle"       : PaddleOCR via local backend
 *   - "manga"        : Manga OCR via local backend
 *
 * @param {object} settings - User's extension settings. Contains things like:
 *   - settings.cloudVisionApiKey : API key for Google Cloud Vision
 *   - settings.backendUrl        : URL of our local FastAPI server (e.g., "http://localhost:8000")
 *   - settings.sourceLanguage    : The language of the text in the image (e.g., "jpn", "kor", "chi_sim")
 *   - settings.mangaBboxes       : Bounding boxes for manga panels (used by Manga OCR)
 *
 * @returns {Promise<Array>} An array of recognized text blocks, each with:
 *   - text {string}         : The recognized text
 *   - bbox {number[]}       : [x1, y1, x2, y2] bounding box coordinates in pixels
 *   - confidence {number}   : Confidence score from 0.0 (no confidence) to 1.0 (certain)
 *   - orientation {string}  : "horizontal" or "vertical"
 */
export async function performOCR(imageBase64, engine, settings) {
  // -------------------------------------------------------------------------
  // STEP 1: Validate inputs.
  // We check that we actually received image data before doing anything else.
  // This prevents confusing errors deeper in the code.
  // -------------------------------------------------------------------------
  if (!imageBase64) {
    throw new OCRError(
      'No image data provided. Please capture a screenshot first.',
      'INVALID_INPUT'
    );
  }

  if (!engine) {
    throw new OCRError(
      'No OCR engine specified. Please select an engine in extension settings.',
      'INVALID_INPUT'
    );
  }

  // -------------------------------------------------------------------------
  // STEP 2: Strip the Data URL prefix if present.
  //
  // Images sent from the browser often come as "Data URLs" which look like:
  //   "data:image/png;base64,iVBORw0KGgo..."
  //
  // The actual Base64 data starts after the comma. Some OCR engines need just
  // the raw Base64 string, so we strip the prefix here and keep it clean for
  // all downstream code.
  // -------------------------------------------------------------------------
  const rawBase64 = stripDataUrlPrefix(imageBase64);

  // -------------------------------------------------------------------------
  // STEP 3: Route to the correct OCR engine.
  //
  // We use a try/catch around the engine call so we can give the user a
  // friendly error message no matter what goes wrong internally. Each engine
  // wrapper can throw its own errors (network failures, invalid API keys,
  // server not running, etc.) and we catch them all here.
  // -------------------------------------------------------------------------
  try {
    let results;

    switch (engine) {
      // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
      // TESSERACT.JS — Runs entirely in the browser
      // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
      case 'tesseract': {
        // Tesseract needs to know the source language to load the right
        // trained data (called a "traineddata" file). For example, "jpn" for
        // Japanese, "eng" for English, "kor" for Korean.
        const language = settings.sourceLanguage || 'eng';
        results = await tesseractRecognize(rawBase64, language);
        break;
      }

      // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
      // GOOGLE CLOUD VISION — Google's cloud OCR API
      // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
      case 'cloud-vision': {
        // Cloud Vision requires an API key. If the user hasn't set one up,
        // we give them a helpful error message explaining what to do.
        if (!settings.cloudVisionApiKey) {
          throw new OCRError(
            'Google Cloud Vision API key is not set. Go to Settings > OCR > Cloud Vision and enter your API key. ' +
            'You can get one at https://console.cloud.google.com/apis/credentials',
            'MISSING_API_KEY'
          );
        }
        results = await cloudVisionRecognize(rawBase64, settings.cloudVisionApiKey);
        break;
      }

      // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
      // PADDLEOCR — Open-source model via local backend
      // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
      case 'paddle': {
        // PaddleOCR runs on our local FastAPI server. The user needs to have
        // the backend running at the configured URL.
        const backendUrl = settings.backendUrl || 'http://localhost:8000';
        results = await recognizePaddle(rawBase64, backendUrl);
        break;
      }

      // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
      // MANGA OCR — Specialized Japanese manga OCR via local backend
      // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
      case 'manga': {
        // Manga OCR is unique: it works best when you tell it WHERE the text
        // is in the image (the bounding boxes of speech bubbles). This is
        // because manga text is often inside speech bubbles with irregular
        // shapes, and knowing the region helps the model focus.
        //
        // The bboxes (bounding boxes) can come from:
        //   1. A previous detection step (like PaddleOCR text detection)
        //   2. The user manually selecting regions
        //   3. An automatic bubble detection algorithm
        const backendUrl = settings.backendUrl || 'http://localhost:8000';
        const bboxes = settings.mangaBboxes || [];
        results = await recognizeManga(rawBase64, bboxes, backendUrl);
        break;
      }

      // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
      // UNKNOWN ENGINE — The user somehow selected an invalid option
      // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
      default:
        throw new OCRError(
          `Unknown OCR engine: "${engine}". Valid options are: tesseract, cloud-vision, paddle, manga.`,
          'INVALID_ENGINE'
        );
    }

    // -----------------------------------------------------------------------
    // STEP 4: Post-process and validate the results.
    //
    // Even though each engine wrapper is supposed to return normalized data,
    // we do a final validation pass here to make sure everything is correct.
    // This is a "defensive programming" practice — we don't trust that every
    // engine wrapper will always return perfectly formatted data, especially
    // as we add new engines in the future.
    // -----------------------------------------------------------------------
    return normalizeResults(results, engine);

  } catch (error) {
    // -----------------------------------------------------------------------
    // STEP 5: Error handling.
    //
    // If anything goes wrong, we wrap the error in a user-friendly format.
    // The UI code that calls performOCR can then display this message to
    // the user instead of a cryptic stack trace.
    // -----------------------------------------------------------------------

    // If it's already our custom error type, just re-throw it as-is.
    if (error instanceof OCRError) {
      throw error;
    }

    // Otherwise, wrap the raw error in a friendlier message.
    console.error(`[OCR Manager] Error with engine "${engine}":`, error);
    throw new OCRError(
      `OCR failed using ${engine}: ${error.message || 'Unknown error'}. ` +
      'Try a different OCR engine or check your settings.',
      'ENGINE_ERROR',
      error // Preserve the original error for debugging
    );
  }
}


// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * stripDataUrlPrefix — Removes the "data:image/...;base64," prefix from a
 * Base64-encoded image string.
 *
 * WHY: When you use a <canvas> element's toDataURL() method to get an image
 * as Base64 (which is how we capture screenshots in the content script), it
 * returns a "Data URL" like:
 *
 *   "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
 *
 * But most OCR APIs and libraries expect just the raw Base64 data without
 * this prefix. So we strip it off here.
 *
 * @param {string} dataUrlOrBase64 - Either a full data URL or raw Base64 string
 * @returns {string} Just the raw Base64 data
 */
function stripDataUrlPrefix(dataUrlOrBase64) {
  if (typeof dataUrlOrBase64 !== 'string') {
    return '';
  }
  // Check if the string starts with "data:" — if so, extract the part
  // after the comma. If not, assume it's already raw Base64.
  if (dataUrlOrBase64.startsWith('data:')) {
    const commaIndex = dataUrlOrBase64.indexOf(',');
    if (commaIndex !== -1) {
      return dataUrlOrBase64.slice(commaIndex + 1);
    }
  }
  return dataUrlOrBase64;
}


/**
 * normalizeResults — Validates and cleans up OCR results into our standard format.
 *
 * Each OCR engine returns results in slightly different shapes. The engine
 * wrappers (tesseract.js, cloud-vision.js, etc.) do their best to normalize,
 * but this function is the final safety net. It ensures every result object
 * has all required fields with correct types.
 *
 * @param {Array} results - Raw results from an engine wrapper
 * @param {string} engineName - Which engine produced these (for logging)
 * @returns {Array} Cleaned and validated results
 */
function normalizeResults(results, engineName) {
  // If the engine returned nothing (empty image, no text found, etc.),
  // return an empty array. This is not an error — it just means there's
  // no text in the image.
  if (!Array.isArray(results) || results.length === 0) {
    console.info(`[OCR Manager] Engine "${engineName}" found no text in the image.`);
    return [];
  }

  return results
    .map((block, index) => {
      // Skip any null/undefined entries (shouldn't happen, but be safe).
      if (!block) {
        console.warn(`[OCR Manager] Skipping null result at index ${index} from ${engineName}`);
        return null;
      }

      return {
        // ---- text ----
        // The recognized text. Convert to string and trim whitespace.
        // Some engines return empty strings for detected regions with no
        // readable text — we filter those out below.
        text: typeof block.text === 'string' ? block.text.trim() : String(block.text || '').trim(),

        // ---- bbox ----
        // Bounding box as [x1, y1, x2, y2] in pixel coordinates.
        // x1,y1 is the top-left corner; x2,y2 is the bottom-right corner.
        // We ensure all values are non-negative numbers.
        bbox: normalizeBoundingBox(block.bbox),

        // ---- confidence ----
        // Confidence score from 0.0 to 1.0. Clamp it to that range.
        // Some engines return percentages (0-100) instead of fractions,
        // so we also handle that conversion.
        confidence: normalizeConfidence(block.confidence),

        // ---- orientation ----
        // Whether the text runs horizontally (left-to-right or right-to-left)
        // or vertically (top-to-bottom, common in Japanese/Chinese).
        // Default to "horizontal" if the engine doesn't specify.
        orientation: block.orientation === 'vertical' ? 'vertical' : 'horizontal',
      };
    })
    // Filter out any null entries (from the null check above) and entries
    // with empty text (detected a region but couldn't read anything).
    .filter(block => block !== null && block.text.length > 0);
}


/**
 * normalizeBoundingBox — Ensures a bounding box is a valid [x1, y1, x2, y2] array.
 *
 * Different OCR engines represent bounding boxes differently:
 *   - Tesseract: { x0, y0, x1, y1 } object
 *   - Cloud Vision: array of vertex objects [{ x, y }, { x, y }, ...]
 *   - PaddleOCR: [[x1,y1], [x2,y2], [x3,y3], [x4,y4]] polygon
 *
 * The engine wrappers should convert to [x1, y1, x2, y2] before returning,
 * but this function is the safety net for any edge cases.
 *
 * @param {*} bbox - A bounding box in any format
 * @returns {number[]} [x1, y1, x2, y2] with all values >= 0
 */
function normalizeBoundingBox(bbox) {
  // If it's already a 4-element array of numbers, just clamp to non-negative.
  if (Array.isArray(bbox) && bbox.length === 4) {
    return bbox.map(val => Math.max(0, Math.round(Number(val) || 0)));
  }

  // If it's an object with x0/y0/x1/y1 (Tesseract's format):
  if (bbox && typeof bbox === 'object' && 'x0' in bbox) {
    return [
      Math.max(0, Math.round(Number(bbox.x0) || 0)),
      Math.max(0, Math.round(Number(bbox.y0) || 0)),
      Math.max(0, Math.round(Number(bbox.x1) || 0)),
      Math.max(0, Math.round(Number(bbox.y1) || 0)),
    ];
  }

  // If it's an array of vertex objects [{ x, y }, ...] (Cloud Vision's format):
  if (Array.isArray(bbox) && bbox.length >= 2 && typeof bbox[0] === 'object' && 'x' in bbox[0]) {
    const xs = bbox.map(v => Number(v.x) || 0);
    const ys = bbox.map(v => Number(v.y) || 0);
    return [
      Math.max(0, Math.round(Math.min(...xs))),
      Math.max(0, Math.round(Math.min(...ys))),
      Math.max(0, Math.round(Math.max(...xs))),
      Math.max(0, Math.round(Math.max(...ys))),
    ];
  }

  // Fallback: return a zero-area box. This means we couldn't determine the
  // position, but at least the text content is still usable.
  console.warn('[OCR Manager] Could not parse bounding box:', bbox);
  return [0, 0, 0, 0];
}


/**
 * normalizeConfidence — Ensures a confidence score is a float between 0.0 and 1.0.
 *
 * @param {*} confidence - A confidence value (could be 0-1, 0-100, or undefined)
 * @returns {number} A value between 0.0 and 1.0
 */
function normalizeConfidence(confidence) {
  const num = Number(confidence);

  // If it's not a valid number, return 0 (no confidence info available).
  if (isNaN(num)) {
    return 0;
  }

  // If the value is greater than 1, assume it's a percentage (0-100).
  // Convert to a 0-1 fraction.
  if (num > 1) {
    return Math.min(1, Math.max(0, num / 100));
  }

  // Otherwise, clamp to [0, 1].
  return Math.min(1, Math.max(0, num));
}


// =============================================================================
// CUSTOM ERROR CLASS
// =============================================================================

/**
 * OCRError — A custom error class for OCR-specific errors.
 *
 * WHY A CUSTOM ERROR CLASS?
 * In JavaScript, all errors are instances of the built-in Error class. By
 * creating our own subclass, we can:
 *   1. Add extra properties (like an error code)
 *   2. Easily check if an error came from our OCR system vs. something else
 *   3. Provide user-friendly messages while preserving technical details
 *
 * Example usage:
 *   try {
 *     await performOCR(image, 'cloud-vision', settings);
 *   } catch (err) {
 *     if (err instanceof OCRError && err.code === 'MISSING_API_KEY') {
 *       showApiKeySetupScreen();
 *     }
 *   }
 */
export class OCRError extends Error {
  /**
   * @param {string} message - A user-friendly error message
   * @param {string} code - A machine-readable error code for programmatic handling
   * @param {Error} [cause] - The original error that caused this one (for debugging)
   */
  constructor(message, code, cause) {
    super(message);
    this.name = 'OCRError';
    this.code = code;
    this.cause = cause;
  }
}
