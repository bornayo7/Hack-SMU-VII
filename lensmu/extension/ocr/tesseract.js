/**
 * =============================================================================
 * TESSERACT.JS WRAPPER — Client-Side OCR That Runs Entirely in the Browser
 * =============================================================================
 *
 * WHAT THIS FILE DOES:
 * --------------------
 * This module wraps the Tesseract.js library, which is a JavaScript port of
 * the famous Tesseract OCR engine (originally developed by Google). The amazing
 * thing about Tesseract.js is that it runs ENTIRELY in the browser — no server,
 * no API key, no internet connection needed (after the initial download).
 *
 * HOW TESSERACT.JS WORKS UNDER THE HOOD:
 * ---------------------------------------
 * 1. When you first use Tesseract with a particular language, it downloads a
 *    "trained data" file (about 1-15 MB depending on language). This file
 *    contains the machine learning model that recognizes characters for that
 *    language.
 *
 * 2. The actual OCR processing happens inside a Web Worker. A Web Worker is a
 *    separate thread that runs in the background, so the OCR computation
 *    doesn't freeze the browser's UI. This is important because OCR is
 *    CPU-intensive and can take several seconds.
 *
 * 3. The library uses WebAssembly (WASM) for the core OCR engine, which is
 *    essentially compiled C++ code running at near-native speed in the browser.
 *
 * IMPORTANT LIMITATIONS — VERTICAL CJK TEXT:
 * -------------------------------------------
 * Tesseract.js has significant limitations with vertical CJK (Chinese, Japanese,
 * Korean) text:
 *
 *   - Tesseract was originally designed for horizontal left-to-right text
 *     (Latin scripts). Its line-finding and character segmentation algorithms
 *     assume text flows horizontally.
 *
 *   - Vertical Japanese/Chinese text (tategaki/縦書き) is commonly used in
 *     manga, novels, and traditional writing. Tesseract often produces garbled
 *     output or low confidence scores for vertical text.
 *
 *   - WORKAROUNDS:
 *     1. Rotate the image 90 degrees clockwise before OCR, then adjust the
 *        bounding boxes back. This makes vertical text horizontal.
 *     2. Use Tesseract only for detection (finding where text is) and then
 *        pass those regions to a better engine like Manga OCR.
 *     3. Use "jpn_vert" language data (if available) which has some vertical
 *        text training, though results are still mediocre.
 *
 *   - For manga translation, we STRONGLY recommend using the "manga" OCR
 *     engine (Manga OCR via local backend) instead of Tesseract for Japanese.
 *     Tesseract is best as a fallback or for quick previews.
 *
 * BROWSER EXTENSION CONTEXT:
 * --------------------------
 * In a Chrome extension, Tesseract.js can run in either:
 *   - The background service worker (recommended: doesn't block page rendering)
 *   - A content script (not recommended: might conflict with the page's own scripts)
 *
 * We load Tesseract.js using importScripts() in the service worker, or via
 * dynamic import if using ES modules.
 *
 * =============================================================================
 */

// ---------------------------------------------------------------------------
// We use a lazy-loading pattern here. Instead of importing Tesseract at the
// top of the file (which would slow down extension startup), we load it the
// first time someone actually calls recognize().
//
// The `worker` variable holds the Tesseract.js worker instance. A "worker"
// in Tesseract.js terms is an object that manages the Web Worker thread and
// provides an API for OCR operations.
// ---------------------------------------------------------------------------
let worker = null;

/**
 * Tracks which language the current worker is loaded with.
 * If the user switches languages, we need to reinitialize the worker because
 * each language requires a different trained data file.
 */
let currentLanguage = null;


/**
 * recognize — Performs OCR on a Base64-encoded image using Tesseract.js.
 *
 * This is the main function exported by this module. It handles all the
 * complexity of initializing and managing the Tesseract worker, and returns
 * results in our normalized format.
 *
 * @param {string} imageBase64 - Raw Base64-encoded image data (no data URL prefix).
 *   The OCR Manager strips the prefix before passing data to us.
 *
 * @param {string} sourceLanguage - The language of the text in the image.
 *   Uses Tesseract language codes (ISO 639-3), for example:
 *     - "eng" for English
 *     - "jpn" for Japanese
 *     - "kor" for Korean
 *     - "chi_sim" for Simplified Chinese
 *     - "chi_tra" for Traditional Chinese
 *     - "jpn+eng" for Japanese AND English (Tesseract supports multiple!)
 *
 *   Full list: https://tesseract-ocr.github.io/tessdoc/Data-Files-in-different-versions.html
 *
 * @returns {Promise<Array>} Array of recognized text blocks:
 *   [{
 *     text: "Hello",
 *     bbox: [x1, y1, x2, y2],
 *     confidence: 0.95
 *   }]
 *
 * @throws {Error} If Tesseract.js fails to initialize or the image is invalid
 */
export async function recognize(imageBase64, sourceLanguage = 'eng') {
  // -------------------------------------------------------------------------
  // STEP 1: Initialize (or reinitialize) the Tesseract worker.
  //
  // We create the worker lazily — only when actually needed. This keeps the
  // extension lightweight when OCR isn't being used. We also reinitialize if
  // the language changed, because switching languages requires loading new
  // trained data.
  // -------------------------------------------------------------------------
  await ensureWorkerReady(sourceLanguage);

  // -------------------------------------------------------------------------
  // STEP 2: Perform OCR.
  //
  // The `worker.recognize()` method accepts various image formats:
  //   - Base64 string (what we use)
  //   - HTMLImageElement
  //   - HTMLCanvasElement
  //   - Blob / File
  //   - Image URL
  //
  // We prepend the data URL prefix back because Tesseract.js expects it
  // when receiving a Base64 string (it uses it to determine the image format).
  // -------------------------------------------------------------------------
  const dataUrl = `data:image/png;base64,${imageBase64}`;

  let result;
  try {
    result = await worker.recognize(dataUrl);
  } catch (error) {
    // If recognition fails, it could be due to a corrupted image, out of
    // memory (very large images), or a Tesseract internal error.
    console.error('[Tesseract] Recognition failed:', error);
    throw new Error(
      `Tesseract OCR failed: ${error.message}. ` +
      'The image may be too large, corrupted, or in an unsupported format.'
    );
  }

  // -------------------------------------------------------------------------
  // STEP 3: Convert Tesseract's output to our normalized format.
  //
  // Tesseract.js returns a deeply nested result object:
  //
  //   result.data = {
  //     text: "Full page text...",
  //     confidence: 87,
  //     blocks: [{
  //       paragraphs: [{
  //         lines: [{
  //           words: [{
  //             text: "Hello",
  //             confidence: 92.5,
  //             bbox: { x0: 10, y0: 20, x1: 80, y1: 45 }
  //           }, ...]
  //         }, ...]
  //       }, ...]
  //     }, ...]
  //   }
  //
  // We extract text at the LINE level (not word level) because:
  //   1. Individual words are too granular for translation
  //   2. Lines preserve natural reading flow
  //   3. Sentences often span multiple words that need context
  //
  // We could also extract at paragraph or block level, but lines give us
  // the best balance of granularity for positioning the translated text.
  // -------------------------------------------------------------------------
  return extractLinesFromResult(result);
}


/**
 * ensureWorkerReady — Makes sure the Tesseract worker is initialized and
 * loaded with the correct language data.
 *
 * Tesseract.js worker initialization involves several async steps:
 *   1. Create the worker (spawns a Web Worker thread)
 *   2. Load the Tesseract WASM core
 *   3. Download the trained data for the requested language
 *   4. Initialize the OCR engine with that language
 *
 * The first time is slow (downloads trained data, ~1-15 MB). Subsequent
 * calls are fast because the worker stays alive in memory.
 *
 * @param {string} language - Tesseract language code (e.g., "eng", "jpn")
 */
async function ensureWorkerReady(language) {
  // If we already have a worker loaded with the right language, reuse it.
  if (worker && currentLanguage === language) {
    return;
  }

  // If we have a worker but with a different language, terminate it and
  // start fresh. We could theoretically reinitialize with a new language,
  // but terminating and recreating is simpler and avoids potential memory
  // leaks from language switching.
  if (worker) {
    console.info(`[Tesseract] Switching language from "${currentLanguage}" to "${language}". Reinitializing worker.`);
    await worker.terminate();
    worker = null;
    currentLanguage = null;
  }

  console.info(`[Tesseract] Initializing worker for language: "${language}"...`);

  try {
    // -------------------------------------------------------------------
    // Load Tesseract.js library.
    //
    // In a browser extension, we have a few options for loading Tesseract:
    //
    //   Option A: Bundle it with the extension (larger extension size, but
    //             works offline). Put tesseract.min.js in the /lib folder.
    //
    //   Option B: Load from CDN (smaller extension, but needs internet).
    //             Uses jsDelivr or unpkg CDN URLs.
    //
    // We try the bundled version first, then fall back to CDN. This gives
    // us the best of both worlds.
    // -------------------------------------------------------------------
    const Tesseract = await loadTesseractLibrary();

    // Create a new worker. The worker runs OCR in a background thread
    // so it doesn't block the UI.
    worker = await Tesseract.createWorker(language, /* oem (OCR Engine Mode) */ 1, {
      // Logging callback — useful for debugging, shows progress during
      // trained data download and OCR processing.
      logger: (info) => {
        // info.status is something like "loading tesseract core", "loading language traineddata", etc.
        // info.progress is 0.0 to 1.0 for operations that report progress.
        if (info.progress !== undefined) {
          console.debug(`[Tesseract] ${info.status}: ${Math.round(info.progress * 100)}%`);
        }
      },
      // Where to find the trained data files. We try the extension's local
      // /lib folder first, then fall back to the CDN.
      langPath: getLangDataPath(),
    });

    currentLanguage = language;
    console.info(`[Tesseract] Worker ready for language: "${language}"`);

  } catch (error) {
    // Reset state on failure so the next call tries again.
    worker = null;
    currentLanguage = null;

    console.error('[Tesseract] Failed to initialize worker:', error);
    throw new Error(
      `Failed to initialize Tesseract OCR for language "${language}": ${error.message}. ` +
      'Check your internet connection (needed for first-time language data download).'
    );
  }
}


/**
 * loadTesseractLibrary — Dynamically loads the Tesseract.js library.
 *
 * We use dynamic loading because:
 *   1. The Tesseract library is large (~800 KB minified) and we don't want
 *      to slow down extension startup by loading it eagerly.
 *   2. Not every user will use Tesseract (they might prefer Cloud Vision
 *      or PaddleOCR), so loading it on-demand saves memory.
 *
 * @returns {Promise<object>} The Tesseract.js library object
 */
async function loadTesseractLibrary() {
  // First, check if Tesseract is already available globally.
  // This happens when it's loaded via a <script> tag or importScripts().
  if (typeof globalThis.Tesseract !== 'undefined') {
    return globalThis.Tesseract;
  }

  // Try to load the bundled version from the extension's /lib directory.
  // chrome.runtime.getURL() converts a relative extension path to a full
  // chrome-extension:// URL that can be loaded.
  try {
    const bundledModule = await import(
      /* webpackIgnore: true */
      chrome.runtime.getURL('lib/tesseract.min.js')
    );
    if (bundledModule.default) return bundledModule.default;
    if (bundledModule.createWorker) return bundledModule;
  } catch (_bundleError) {
    // Bundled version not found — this is fine, we'll try CDN next.
    console.info('[Tesseract] Bundled library not found, trying CDN...');
  }

  // Fall back to loading from CDN.
  // We use jsDelivr which is a fast, free CDN for npm packages.
  try {
    const cdnModule = await import(
      /* webpackIgnore: true */
      'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js'
    );
    return cdnModule.default || cdnModule;
  } catch (cdnError) {
    throw new Error(
      'Could not load Tesseract.js library. ' +
      'Either bundle it in the /lib folder or ensure internet access for CDN loading. ' +
      `Details: ${cdnError.message}`
    );
  }
}


/**
 * getLangDataPath — Returns the path where Tesseract should look for
 * trained data files.
 *
 * Trained data files are the language-specific ML models that Tesseract
 * uses for recognition. They're named like "eng.traineddata", "jpn.traineddata",
 * etc. The first time a language is used, Tesseract downloads these files.
 *
 * @returns {string} URL path for language data files
 */
function getLangDataPath() {
  // Try to use the extension's local /lib/tessdata directory first.
  // If the user has pre-downloaded the trained data files and placed them
  // there, Tesseract will use them instead of downloading from the internet.
  try {
    return chrome.runtime.getURL('lib/tessdata');
  } catch (_error) {
    // If chrome.runtime is not available (e.g., running in tests), use CDN.
    return 'https://tessdata.projectnaptha.com/4.0.0';
  }
}


/**
 * extractLinesFromResult — Converts Tesseract's hierarchical output into
 * our flat array of text blocks.
 *
 * Tesseract returns results organized as: blocks > paragraphs > lines > words.
 * We extract at the LINE level because it's the most useful granularity for
 * translation overlays.
 *
 * @param {object} result - The raw Tesseract recognition result
 * @returns {Array} Normalized text blocks with text, bbox, and confidence
 */
function extractLinesFromResult(result) {
  const normalizedBlocks = [];

  // Safety check: make sure we have valid data to work with.
  if (!result || !result.data || !result.data.blocks) {
    return normalizedBlocks;
  }

  // Walk the hierarchy: blocks -> paragraphs -> lines
  for (const block of result.data.blocks) {
    if (!block.paragraphs) continue;

    for (const paragraph of block.paragraphs) {
      if (!paragraph.lines) continue;

      for (const line of paragraph.lines) {
        // Skip lines that are empty or have extremely low confidence.
        // A confidence below 10% usually means Tesseract detected "something"
        // but couldn't actually read it (noise, decoration, etc.).
        if (!line.text || line.text.trim().length === 0) continue;
        if (line.confidence < 10) continue;

        normalizedBlocks.push({
          // The recognized text for this line.
          text: line.text.trim(),

          // Bounding box in [x1, y1, x2, y2] format.
          // Tesseract uses { x0, y0, x1, y1 } — our OCR Manager's
          // normalizeResults() function handles this conversion, but we
          // also convert here for clarity.
          bbox: [
            Math.round(line.bbox.x0),
            Math.round(line.bbox.y0),
            Math.round(line.bbox.x1),
            Math.round(line.bbox.y1),
          ],

          // Tesseract confidence is 0-100, we convert to 0.0-1.0.
          // The OCR Manager also does this normalization, but doing it here
          // makes this module independently testable.
          confidence: line.confidence / 100,
        });
      }
    }
  }

  return normalizedBlocks;
}


/**
 * terminateWorker — Shuts down the Tesseract worker and frees memory.
 *
 * Call this when the extension is being unloaded or when the user switches
 * to a different OCR engine. The Web Worker thread and its allocated memory
 * (which can be significant — hundreds of MB for large images) will be freed.
 *
 * This is exported so the OCR Manager or the extension's lifecycle code can
 * call it during cleanup.
 */
export async function terminateWorker() {
  if (worker) {
    console.info('[Tesseract] Terminating worker and freeing resources.');
    await worker.terminate();
    worker = null;
    currentLanguage = null;
  }
}
