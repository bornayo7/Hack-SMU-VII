/*
 * ==========================================================================
 * VisionTranslate — Content Script (content.js)
 * ==========================================================================
 *
 * WHAT IS A CONTENT SCRIPT?
 * -------------------------
 * A content script is JavaScript that Chrome injects into every web page
 * (matching the patterns in manifest.json). It runs in an "isolated world":
 *
 *   - It CAN read and modify the page's DOM (HTML elements, CSS).
 *   - It CANNOT access the page's JavaScript variables or functions.
 *   - It CANNOT directly call chrome.* APIs that need special permissions
 *     (like making cross-origin requests). Instead it asks the background
 *     script to do those things via message passing.
 *   - The page's JavaScript CANNOT access our variables either (isolation
 *     goes both ways).
 *
 * WHAT THIS FILE DOES:
 * --------------------
 *   1. Waits for an "ACTIVATE" message from the background script.
 *   2. Scans the page for images (img tags, CSS background images, canvas).
 *   3. Filters images by size (skip tiny icons).
 *   4. For each qualifying image, sends it to the OCR backend (via the
 *      background script's proxy) to extract text and bounding boxes.
 *   5. Sends extracted text to the translation backend.
 *   6. Creates a <canvas> overlay on top of each image and uses
 *      overlay.js to paint translated text over the original.
 *   7. Watches for dynamically loaded images (using MutationObserver).
 *   8. Responds to "DEACTIVATE" to clean everything up.
 *
 * SHADOW DOM:
 * -----------
 * We use Shadow DOM for our overlay toolbar UI. Shadow DOM creates an
 * encapsulated DOM tree that is isolated from the page's CSS. This means:
 *   - The page's styles won't accidentally break our toolbar.
 *   - Our styles won't leak into the page.
 * This is important because we are injecting into EVERY website, and each
 * one has different CSS that could conflict with ours.
 * ==========================================================================
 */

/*
 * --------------------------------------------------------------------------
 * Constants
 * --------------------------------------------------------------------------
 */

/*
 * Minimum image dimensions (in pixels) to consider for OCR. Images smaller
 * than this are likely icons, avatars, spacer GIFs, or decorative elements
 * that don't contain translatable text. Processing them would waste API
 * calls and clutter the page with unnecessary overlays.
 *
 * 100x50 is a reasonable threshold: most text-containing images (manga
 * panels, screenshots, memes, infographics) are larger than this.
 */
const MIN_IMAGE_WIDTH = 100;
const MIN_IMAGE_HEIGHT = 50;

/*
 * CSS class prefix for all elements we inject into the page. Using a
 * unique prefix prevents name collisions with the page's own CSS classes.
 */
const CLASS_PREFIX = 'vt-lensmu';

/*
 * Maximum number of images to process at once. Processing too many images
 * simultaneously would overwhelm both the OCR backend and the user's
 * browser with network requests and canvas rendering.
 */
const MAX_CONCURRENT_IMAGES = 5;

/*
 * --------------------------------------------------------------------------
 * Module State
 * --------------------------------------------------------------------------
 * These variables track the content script's state. They reset whenever
 * the page navigates (since the content script is re-injected).
 */

/* Is translation currently active on this page? */
let isActive = false;

/* Current extension settings (received from background on activation) */
let currentSettings = {};

/*
 * Map from image element to its overlay data. We use a WeakMap so that
 * if the page removes an image element, the overlay data is automatically
 * garbage-collected.
 *
 * Shape of each entry:
 * {
 *   canvas: HTMLCanvasElement,     — The canvas overlay covering the image
 *   wrapper: HTMLDivElement,       — The wrapper div (position: relative)
 *   ocrResults: Array,             — Merged paragraph/text-block boxes
 *   rawOcrResults: Array,          — Raw OCR boxes before block merging
 *   translations: Array,           — Translated text for each merged block
 *   showingTranslation: boolean    — Whether translation or original is showing
 * }
 */
const imageOverlays = new WeakMap();

/*
 * Set of image elements we have already processed or are currently
 * processing. Prevents duplicate processing if the MutationObserver
 * fires multiple times for the same image.
 */
const processedImages = new WeakSet();

/* Reference to the MutationObserver so we can disconnect it on deactivate */
let pageObserver = null;

/* Reference to the toolbar shadow DOM container */
let toolbarContainer = null;

/*
 * Set of translate-icon buttons we've added to images, so we can
 * remove them on deactivate.
 */
const translateIcons = new Set();

/*
 * --------------------------------------------------------------------------
 * Utility: Convert an image element to a base64-encoded data URL
 * --------------------------------------------------------------------------
 * The OCR backend expects images as base64 strings. We draw the image
 * onto a temporary canvas and export it as a data URL.
 *
 * Why not just send the image URL?
 *   - The image might be on a different domain (CORS blocks the backend
 *     from fetching it).
 *   - The image might require cookies/auth that the backend doesn't have.
 *   - The image might be a blob URL or data URL that only exists in
 *     the browser.
 *   - Base64 is universally portable.
 *
 * @param {HTMLImageElement|HTMLCanvasElement} imageElement
 *        The image to convert. Can be an <img> tag or a <canvas>.
 * @returns {string|null}
 *        The base64 data URL (e.g., "data:image/png;base64,iVBOR...")
 *        or null if conversion fails (usually due to CORS tainted canvas).
 */

/*
 * --------------------------------------------------------------------------
 * OCR Compatibility Helpers
 * --------------------------------------------------------------------------
 * Server-backed OCR still runs through the background worker. Tesseract.js
 * must run in the content script because the MV3 service worker does not
 * expose the Worker constructor that Tesseract needs.
 */
function stripDataUrlPrefix(imageBase64) {
  if (!imageBase64 || !imageBase64.startsWith('data:')) {
    return imageBase64;
  }

  const commaIndex = imageBase64.indexOf(',');
  return commaIndex === -1 ? imageBase64 : imageBase64.slice(commaIndex + 1);
}

async function runBundledTesseractOCR(
  imageBase64,
  sourceLanguage = currentSettings.sourceLanguage || 'auto'
) {
  const { recognize } = await import(chrome.runtime.getURL('ocr/tesseract.js'));
  const results = await recognize(
    stripDataUrlPrefix(imageBase64),
    sourceLanguage
  );

  return results.map((block) => ({
    text: block.text,
    confidence: block.confidence,
    bbox: {
      x: block.bbox[0],
      y: block.bbox[1],
      width: block.bbox[2] - block.bbox[0],
      height: block.bbox[3] - block.bbox[1]
    }
  }));
}

function imageToBase64(imageElement) {
  try {
    /*
     * Create a temporary offscreen canvas. This canvas is never added
     * to the DOM — it exists only in memory for the conversion.
     */
    const tempCanvas = document.createElement('canvas');
    const ctx = tempCanvas.getContext('2d');

    /*
     * For <img> elements: use naturalWidth/naturalHeight to get the
     * image's actual dimensions, not the CSS display dimensions.
     * For <canvas> elements: use width/height attributes.
     */
    let width, height;

    if (imageElement instanceof HTMLImageElement) {
      width = imageElement.naturalWidth;
      height = imageElement.naturalHeight;
    } else if (imageElement instanceof HTMLCanvasElement) {
      width = imageElement.width;
      height = imageElement.height;
    } else {
      /* For other elements (e.g., video poster), use offset dimensions */
      width = imageElement.offsetWidth;
      height = imageElement.offsetHeight;
    }

    /* Skip if we couldn't determine dimensions */
    if (!width || !height) {
      console.warn('[VisionTranslate] Could not determine image dimensions');
      return null;
    }

    tempCanvas.width = width;
    tempCanvas.height = height;

    /*
     * Draw the image onto our temporary canvas. This copies the pixel
     * data. If the image is from a different origin and the server
     * didn't set appropriate CORS headers, this will "taint" the canvas,
     * and toDataURL() below will throw a SecurityError.
     */
    ctx.drawImage(imageElement, 0, 0, width, height);

    /*
     * Export as PNG data URL. PNG is lossless so we don't degrade the
     * image quality. The result is a string like:
     * "data:image/png;base64,iVBORw0KGgo..."
     *
     * For very large images, we use JPEG with 0.85 quality to reduce
     * the payload size sent to the OCR backend.
     */
    if (width * height > 2000000) {
      /* Images over 2 megapixels: use JPEG to save bandwidth */
      return tempCanvas.toDataURL('image/jpeg', 0.85);
    }

    return tempCanvas.toDataURL('image/png');
  } catch (error) {
    /*
     * SecurityError: the image was cross-origin and tainted the canvas.
     * This is a browser security feature we cannot bypass. We'll try
     * an alternative approach using the image URL directly.
     */
    if (error.name !== 'SecurityError') {
      console.error('[VisionTranslate] imageToBase64 error:', error);
    }
    return null;
  }
}

function isCrossOriginHttpUrl(url) {
  if (!url) return false;

  try {
    const parsedUrl = new URL(url, window.location.href);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return false;
    }
    return parsedUrl.origin !== window.location.origin;
  } catch (_error) {
    return false;
  }
}

async function fetchImageViaBackground(url) {
  if (!url) return null;

  try {
    const fetchResponse = await chrome.runtime.sendMessage({
      action: 'FETCH_IMAGE',
      payload: { url }
    });

    if (fetchResponse?.ok && fetchResponse.dataUrl) {
      return fetchResponse.dataUrl;
    }

    console.warn('[VisionTranslate] Background fetch failed:', fetchResponse?.error || 'Unknown error');
  } catch (fetchError) {
    console.warn('[VisionTranslate] Background fetch error:', fetchError.message);
  }

  return null;
}

/*
 * --------------------------------------------------------------------------
 * Utility: Extract background image URL from a DOM element
 * --------------------------------------------------------------------------
 * Some websites put text-containing images as CSS background-image instead
 * of <img> tags (common in hero sections, cards, etc.). We need to find
 * these too.
 *
 * @param {HTMLElement} element — Any DOM element
 * @returns {string|null} — The URL of the background image, or null
 */
function getBackgroundImageUrl(element) {
  /*
   * getComputedStyle() returns the ACTUAL rendered CSS values for an
   * element, including inherited and default styles. We look at the
   * 'background-image' property.
   *
   * The value looks like: url("https://example.com/image.jpg")
   * We need to extract just the URL part.
   */
  const style = window.getComputedStyle(element);
  const bgImage = style.backgroundImage;

  /* "none" means no background image is set */
  if (!bgImage || bgImage === 'none') {
    return null;
  }

  /*
   * Extract URL from the css value. The format is:
   *   url("https://example.com/image.jpg")
   * or
   *   url('https://example.com/image.jpg')
   * or
   *   url(https://example.com/image.jpg)
   *
   * The regex captures everything between url( and ) , removing optional
   * quotes.
   */
  const urlMatch = bgImage.match(/url\(["']?(.*?)["']?\)/);
  if (urlMatch && urlMatch[1]) {
    return urlMatch[1];
  }

  return null;
}

/*
 * --------------------------------------------------------------------------
 * Utility: Load an image URL into an HTMLImageElement
 * --------------------------------------------------------------------------
 * Returns a Promise that resolves with the loaded image element, or
 * rejects if loading fails. We set crossOrigin = 'anonymous' to attempt
 * CORS loading, which allows us to draw the image onto a canvas and
 * read its pixels (needed for base64 conversion).
 *
 * @param {string} url — The image URL to load
 * @returns {Promise<HTMLImageElement>}
 */
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();

    /*
     * Setting crossOrigin BEFORE setting src is critical. If you set
     * src first, the browser may start loading without CORS headers,
     * and changing crossOrigin afterward won't help.
     *
     * 'anonymous' means: send the request with CORS headers but
     * without cookies. If the server responds with appropriate
     * Access-Control-Allow-Origin headers, we can read the pixels.
     */
    img.crossOrigin = 'anonymous';

    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error(`Failed to load image: ${url}`));

    img.src = url;
  });
}

/*
 * --------------------------------------------------------------------------
 * Core: Scan the page for images
 * --------------------------------------------------------------------------
 * Finds all images on the page that are large enough to potentially
 * contain text. Returns an array of objects describing each image.
 *
 * We look in three places:
 *   1. <img> tags — The most common way images appear on pages
 *   2. CSS background-image — Used by many modern websites
 *   3. <canvas> elements — Used by web apps, games, PDF viewers
 *
 * @returns {Array<{element: HTMLElement, type: string, url: string|null}>}
 */
function scanForImages() {
  const results = [];

  /*
   * ---------- 1. Find all <img> tags ----------
   * document.querySelectorAll returns a static NodeList of all matching
   * elements. We use 'img' to find every image tag on the page.
   */
  const imgElements = document.querySelectorAll('img');

  for (const img of imgElements) {
    /*
     * Skip images that haven't loaded yet. naturalWidth/naturalHeight
     * are 0 for unloaded images or broken image links.
     */
    if (!img.naturalWidth || !img.naturalHeight) {
      continue;
    }

    /* Skip images smaller than our minimum threshold */
    if (img.naturalWidth < MIN_IMAGE_WIDTH || img.naturalHeight < MIN_IMAGE_HEIGHT) {
      continue;
    }

    /* Skip images we've already processed */
    if (processedImages.has(img)) {
      continue;
    }

    /*
     * Skip images that are not visible. offsetParent is null for hidden
     * elements (display:none or inside a hidden ancestor). The exception
     * is <body>, which has offsetParent === null even when visible.
     */
    if (!img.offsetParent && img.parentElement !== document.body) {
      continue;
    }

    results.push({
      element: img,
      type: 'img',
      url: img.currentSrc || img.src
    });
  }

  /*
   * ---------- 2. Find elements with CSS background images ----------
   * We check common elements that often have background images:
   * divs, sections, headers, spans, and elements with certain roles.
   *
   * Checking EVERY element on the page would be too slow, so we limit
   * to elements that are large enough and commonly used for backgrounds.
   */
  const bgCandidates = document.querySelectorAll(
    'div, section, header, article, figure, span, a'
  );

  for (const el of bgCandidates) {
    /* Skip small elements */
    if (el.offsetWidth < MIN_IMAGE_WIDTH || el.offsetHeight < MIN_IMAGE_HEIGHT) {
      continue;
    }

    if (processedImages.has(el)) {
      continue;
    }

    const bgUrl = getBackgroundImageUrl(el);
    if (bgUrl) {
      results.push({
        element: el,
        type: 'background',
        url: bgUrl
      });
    }
  }

  /*
   * ---------- 3. Find <canvas> elements ----------
   * Canvas elements might contain rendered text (e.g., PDF.js viewers,
   * games, custom rendering). We can directly read their pixel data.
   */
  const canvasElements = document.querySelectorAll('canvas');

  for (const canvas of canvasElements) {
    if (canvas.width < MIN_IMAGE_WIDTH || canvas.height < MIN_IMAGE_HEIGHT) {
      continue;
    }

    if (processedImages.has(canvas)) {
      continue;
    }

    results.push({
      element: canvas,
      type: 'canvas',
      url: null  /* Canvas has no URL; we read pixels directly */
    });
  }

  console.log(`[VisionTranslate] Found ${results.length} images to process`);
  return results;
}

/*
 * --------------------------------------------------------------------------
 * Core: Create a canvas overlay on top of an image
 * --------------------------------------------------------------------------
 * For each image we want to translate, we create a <canvas> element that
 * is positioned EXACTLY on top of the original image. The canvas is where
 * we paint the translated text.
 *
 * The technique:
 *   1. Wrap the image in a <div> with position:relative (if not already).
 *   2. Create a <canvas> with position:absolute, same size as the image.
 *   3. Place the canvas on top of the image using z-index.
 *
 * @param {HTMLElement} imageElement — The image to overlay
 * @returns {{canvas: HTMLCanvasElement, wrapper: HTMLDivElement}}
 */
function createOverlay(imageElement) {
  /*
   * Get the image's displayed dimensions. These might differ from the
   * natural dimensions (e.g., if CSS scales the image). The overlay
   * must match the DISPLAYED size, not the natural size.
   */
  const rect = imageElement.getBoundingClientRect();
  const displayWidth = Math.round(rect.width);
  const displayHeight = Math.round(rect.height);

  /*
   * Create a wrapper div with position:relative. This becomes the
   * "positioning context" for the absolutely-positioned canvas.
   *
   * We insert the wrapper into the DOM in place of the image, then
   * move the image inside the wrapper. This preserves the image's
   * position in the page layout.
   */
  const wrapper = document.createElement('div');
  wrapper.className = `${CLASS_PREFIX}-wrapper`;
  wrapper.style.cssText = `
    position: relative;
    display: inline-block;
    width: ${displayWidth}px;
    height: ${displayHeight}px;
  `;

  /*
   * Insert the wrapper where the image is, then move the image inside it.
   *
   * parentNode.insertBefore(newNode, referenceNode) inserts newNode
   * right before referenceNode in the parent's children.
   *
   * wrapper.appendChild(imageElement) moves the image from its current
   * position into the wrapper (DOM elements can only be in one place).
   *
   * IMPORTANT: For background-image elements, we don't move the element.
   * Instead we create the wrapper as a sibling overlay.
   */
  if (imageElement.tagName === 'IMG' || imageElement.tagName === 'CANVAS') {
    imageElement.parentNode.insertBefore(wrapper, imageElement);
    wrapper.appendChild(imageElement);

    /* Make the image fill the wrapper */
    imageElement.style.display = 'block';
    imageElement.style.width = '100%';
    imageElement.style.height = '100%';
  } else {
    /*
     * For background-image elements, we cannot move them (it would break
     * the page layout). Instead, we position the wrapper as an overlay
     * on top using absolute positioning relative to the element.
     *
     * We need the element to have position:relative so our overlay
     * can be positioned absolutely within it.
     */
    const existingPosition = window.getComputedStyle(imageElement).position;
    if (existingPosition === 'static') {
      imageElement.style.position = 'relative';
    }
    imageElement.appendChild(wrapper);
    wrapper.style.position = 'absolute';
    wrapper.style.top = '0';
    wrapper.style.left = '0';
    wrapper.style.width = '100%';
    wrapper.style.height = '100%';
  }

  /*
   * Create the canvas overlay. The canvas sits on top of the image
   * and is where we'll paint the translated text.
   *
   * The canvas has TWO sets of dimensions:
   *   - CSS dimensions (style.width/height): how big it appears on screen
   *   - Canvas dimensions (canvas.width/height): the internal pixel grid
   *
   * For sharp rendering, the canvas pixel grid should match the
   * device pixel ratio. On a 2x Retina display, we make the canvas
   * 2x the CSS dimensions and scale the drawing context down.
   */
  const canvas = document.createElement('canvas');
  canvas.className = `${CLASS_PREFIX}-canvas`;

  /*
   * Device pixel ratio: On Retina/HiDPI screens this is 2 or 3,
   * meaning each CSS pixel corresponds to 2 or 3 physical pixels.
   * We scale the canvas to match for sharp text rendering.
   */
  const dpr = window.devicePixelRatio || 1;
  canvas.width = displayWidth * dpr;
  canvas.height = displayHeight * dpr;

  canvas.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    width: ${displayWidth}px;
    height: ${displayHeight}px;
    z-index: 1;
    pointer-events: auto;
    cursor: default;
  `;

  /*
   * Scale the canvas drawing context to account for device pixel ratio.
   * After this, drawing at (10, 10) means 10 CSS pixels, not 10 canvas
   * pixels. This makes all our drawing code resolution-independent.
   */
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  /*
   * Start with the canvas fully transparent so the original image
   * shows through. We only paint over regions where we have translated
   * text.
   */
  ctx.clearRect(0, 0, displayWidth, displayHeight);

  wrapper.appendChild(canvas);

  return { canvas, wrapper };
}

/*
 * --------------------------------------------------------------------------
 * Core: Process a single image through the OCR + Translation pipeline
 * --------------------------------------------------------------------------
 * This is the main pipeline for one image:
 *   1. Convert image to base64
 *   2. Send to OCR backend → get text blocks with bounding boxes
 *   3. Send text to translation backend → get translated text
 *   4. Create canvas overlay and render translations
 *
 * @param {{element: HTMLElement, type: string, url: string|null}} imageInfo
 *        The image descriptor from scanForImages()
 */
async function processImage(imageInfo) {
  const { element, type, url } = imageInfo;

  /* Mark as processed to prevent duplicate work */
  processedImages.add(element);

  console.log(`[VisionTranslate] Processing ${type} image:`, url?.substring(0, 80) || '(canvas)');

  try {
    /*
     * STEP 1: Get the image as base64
     * --------------------------------
     * Different image types need different handling:
     *   - <img>: Draw onto canvas, export as data URL
     *   - <canvas>: Export directly as data URL
     *   - background-image: Load the URL into a new Image, then convert
     */
    let imageBase64 = null;
    const prefersBackgroundFetch = isCrossOriginHttpUrl(url);

    if (type === 'canvas') {
      /* Canvas elements can be exported directly */
      try {
        imageBase64 = element.toDataURL('image/png');
      } catch (e) {
        console.warn('[VisionTranslate] Cannot export canvas (tainted):', e.message);
        return;
      }
    } else if (prefersBackgroundFetch) {
      /*
       * Cross-origin images frequently taint the canvas in content-script
       * context. Fetch them via the background worker first to avoid noisy
       * SecurityError logs and to make the OCR path work on image CDNs.
       */
      imageBase64 = await fetchImageViaBackground(url);
    } else if (type === 'background') {
      /*
       * For background images, we need to load the URL into a new Image
       * element and then convert that. We try with CORS first; if that
       * fails, we fall back to asking the background script to fetch it.
       */
      try {
        const loadedImg = await loadImage(url);
        imageBase64 = imageToBase64(loadedImg);
      } catch (e) {
        console.warn('[VisionTranslate] Could not load background image via CORS, trying background fetch:', url?.substring(0, 80));
        /* imageBase64 stays null — the CORS fallback below will handle it */
      }
    } else {
      /* Regular <img> element */
      imageBase64 = imageToBase64(element);
    }

    /*
     * CORS FALLBACK: If direct canvas conversion failed (returned null),
     * and we have an image URL, ask the background service worker to
     * fetch the image for us. The background worker has host_permissions
     * that bypass CORS restrictions, so it can fetch any image URL.
     */
    if (!imageBase64 && url) {
      console.log('[VisionTranslate] Attempting background fetch for image:', url.substring(0, 80));
      imageBase64 = await fetchImageViaBackground(url);
      if (imageBase64) {
        console.log('[VisionTranslate] Successfully fetched image via background proxy');
      }
    }

    if (!imageBase64) {
      console.warn('[VisionTranslate] Failed to convert image to base64 (even after background fetch). Skipping.');
      return;
    }

    /*
     * STEP 2: Send image to OCR backend
     * -----------------------------------
     * We send a message to the background script, which proxies the
     * request to our backend server (avoiding CORS issues).
     *
     * Expected OCR response format:
     * {
     *   ok: true,
     *   body: {
     *     blocks: [
     *       {
     *         text: "Hello world",
     *         confidence: 0.95,
     *         bbox: { x: 10, y: 20, width: 200, height: 30 }
     *       },
     *       ...
     *     ],
     *     source_lang: "en"
     *   }
     * }
     */
    const ocrResponse = await chrome.runtime.sendMessage({
      action: 'OCR_REQUEST',
      payload: {
        imageBase64,
        sourceLang: currentSettings.sourceLanguage || 'auto'
      }
    });

    if (!ocrResponse || !ocrResponse.ok) {
      console.warn('[VisionTranslate] OCR request failed:', ocrResponse?.body?.error || 'Unknown error');
      return;
    }

    /*
     * If the background script tells us to use client-side OCR (Tesseract.js),
     * run it here in the content script where the Worker constructor exists.
     */
    let ocrResults = ocrResponse.body?.blocks || [];
    if (ocrResponse.body?.useClientOCR) {
      const sourceLang = ocrResponse.body?.source_lang || currentSettings.sourceLanguage || 'auto';
      console.log('[VisionTranslate] Running bundled Tesseract OCR in content script.');
      try {
        ocrResults = await runBundledTesseractOCR(imageBase64, sourceLang);
      } catch (tessError) {
        console.warn('[VisionTranslate] Bundled Tesseract.js OCR failed:', tessError.message);
        return;
      }
    }

    /* If no text was found in the image, skip it */
    if (ocrResults.length === 0) {
      console.log('[VisionTranslate] No text found in image. Skipping.');
      return;
    }

    console.log(`[VisionTranslate] OCR found ${ocrResults.length} raw text boxes`);

    /*
     * STEP 2.5: Reconstruct paragraph/text blocks before translation.
     * ---------------------------------------------------------------
     * OCR engines frequently return line-level boxes. Rendering those
     * independently breaks paragraph layout, so we merge related boxes
     * into larger paragraph regions first and translate/render at the
     * merged block level.
     */
    const overlayModule = await import(chrome.runtime.getURL('overlay.js'));
    const rawOcrResults = ocrResults;
    const mergedOcrResults = overlayModule.groupTextBlocks(rawOcrResults);

    if (mergedOcrResults.length === 0) {
      console.log('[VisionTranslate] OCR merge step produced no renderable text blocks. Skipping.');
      return;
    }

    console.log(
      `[VisionTranslate] Reconstructed ${mergedOcrResults.length} merged text blocks from ${rawOcrResults.length} raw OCR boxes`
    );

    /*
     * STEP 3: Send extracted text to translation backend
     * ---------------------------------------------------
     * We batch all text blocks into a single translation request.
     * This is more efficient than translating each block individually.
     *
     * Expected translation response format:
     * {
     *   ok: true,
     *   body: {
     *     translations: ["Hola mundo", ...],
     *     target_lang: "es"
     *   }
     * }
     */
    const textsToTranslate = mergedOcrResults.map((block) => block.text);

    const translateResponse = await chrome.runtime.sendMessage({
      action: 'TRANSLATE_REQUEST',
      payload: {
        texts: textsToTranslate,
        sourceLang: ocrResponse.body?.source_lang || 'auto',
        targetLang: currentSettings.targetLanguage || 'en'
      }
    });

    if (!translateResponse || !translateResponse.ok) {
      console.warn('[VisionTranslate] Translation request failed:', translateResponse?.body?.error || 'Unknown error');
      return;
    }

    const translations = translateResponse.body?.translations || [];

    /*
     * STEP 4: Create overlay and render
     * -----------------------------------
     * Now we have both the OCR bounding boxes and the translated text.
     * Time to paint them onto a canvas overlay.
     */
    const { canvas, wrapper } = createOverlay(element);

    /*
     * Store the overlay data in our WeakMap so we can access it later
     * (e.g., to toggle between original and translated text, or to
     * clean up when deactivating).
     */
    imageOverlays.set(element, {
      canvas,
      wrapper,
      ocrResults: mergedOcrResults,
      rawOcrResults,
      translations,
      showingTranslation: true
    });

    /*
     * Get the image element to pass to the renderer. For background
     * images we need to load a fresh copy; for img/canvas we use
     * the element directly.
     */
    let sourceImage = element;
    if (type === 'background') {
      try {
        sourceImage = await loadImage(url);
      } catch (e) {
        console.warn('[VisionTranslate] Could not reload background image for rendering');
        return;
      }
    }

    overlayModule.renderTranslation(canvas, sourceImage, mergedOcrResults, translations);

    /*
     * Set up hover detection for showing original text tooltips.
     * The overlay module returns this as a setup function.
     */
    overlayModule.setupHoverDetection(canvas, mergedOcrResults, translations);

    console.log(
      `[VisionTranslate] Successfully translated image with ${mergedOcrResults.length} merged text blocks`
    );

  } catch (error) {
    console.error('[VisionTranslate] Error processing image:', error);
  }
}

/*
 * --------------------------------------------------------------------------
 * Per-Image Translate Icons
 * --------------------------------------------------------------------------
 * When the extension is activated, we add a small translate icon to the
 * corner of each qualifying image. The user can:
 *   - Click the icon to translate just that one image
 *   - Or use "Translate This Page" to do them all at once
 *
 * The icon is a small circular button with a translate symbol (文/A) that
 * appears on hover in the top-right corner of the image.
 */

/**
 * Add translate icons to all qualifying images on the page.
 * Called during activation to give users per-image control.
 */
function addTranslateIcons() {
  const images = scanForImages();

  for (const imageInfo of images) {
    const { element } = imageInfo;

    /* Skip if icon already added */
    if (element.dataset.vtIconAdded) continue;
    element.dataset.vtIconAdded = 'true';

    /*
     * We need the image's parent to be position:relative so we can
     * absolutely position the icon. Check if it already is.
     */
    const parent = element.parentElement;
    if (!parent) continue;

    const parentPosition = window.getComputedStyle(parent).position;

    /* Create a wrapper if the parent isn't already positioned */
    let iconAnchor;
    if (parentPosition === 'static' || parentPosition === '') {
      /* For <img> elements, wrap them in a positioned div */
      if (element.tagName === 'IMG') {
        const wrapper = document.createElement('div');
        wrapper.className = `${CLASS_PREFIX}-icon-wrapper`;
        wrapper.style.cssText = `
          position: relative;
          display: inline-block;
        `;
        element.parentNode.insertBefore(wrapper, element);
        wrapper.appendChild(element);
        iconAnchor = wrapper;
      } else {
        /* For other elements (background, canvas), set position on the element itself */
        element.style.position = 'relative';
        iconAnchor = element;
      }
    } else {
      iconAnchor = parent;
    }

    /* Create the translate icon button */
    const icon = document.createElement('button');
    icon.className = `${CLASS_PREFIX}-translate-icon`;
    icon.title = 'Translate this image';
    icon.innerHTML = '文A';
    icon.style.cssText = `
      position: absolute;
      top: 8px;
      right: 8px;
      z-index: 2147483646;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      border: 2px solid rgba(255,255,255,0.8);
      background: rgba(59, 130, 246, 0.9);
      color: white;
      font-size: 11px;
      font-weight: 700;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      transition: opacity 0.2s ease, transform 0.15s ease;
      pointer-events: auto;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      line-height: 1;
      padding: 0;
    `;

    /* Show icon on hover over the image area */
    const showIcon = () => { icon.style.opacity = '1'; };
    const hideIcon = () => {
      if (!icon.dataset.translating) icon.style.opacity = '0';
    };

    iconAnchor.addEventListener('mouseenter', showIcon);
    iconAnchor.addEventListener('mouseleave', hideIcon);

    /* Click handler: translate just this image */
    icon.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      /* Visual feedback: show loading state */
      icon.dataset.translating = 'true';
      icon.innerHTML = '⟳';
      icon.style.opacity = '1';
      icon.style.animation = 'spin 1s linear infinite';

      /* Add spin animation if not already present */
      if (!document.getElementById(`${CLASS_PREFIX}-spin-style`)) {
        const style = document.createElement('style');
        style.id = `${CLASS_PREFIX}-spin-style`;
        style.textContent = `@keyframes spin { to { transform: rotate(360deg); } }`;
        document.head.appendChild(style);
      }

      try {
        await processImage(imageInfo);
        /* Replace icon with checkmark on success */
        icon.innerHTML = '✓';
        icon.style.background = 'rgba(34, 197, 94, 0.9)';
        icon.style.animation = 'none';
        setTimeout(() => { icon.style.opacity = '0'; }, 2000);
      } catch (err) {
        /* Show error state */
        icon.innerHTML = '✗';
        icon.style.background = 'rgba(239, 68, 68, 0.9)';
        icon.style.animation = 'none';
        console.error('[VisionTranslate] Single image translation failed:', err);
      }

      delete icon.dataset.translating;
    });

    iconAnchor.appendChild(icon);
    translateIcons.add({ icon, anchor: iconAnchor, showIcon, hideIcon });
  }
}

/**
 * Remove all translate icons from the page.
 */
function removeTranslateIcons() {
  for (const { icon, anchor, showIcon, hideIcon } of translateIcons) {
    anchor.removeEventListener('mouseenter', showIcon);
    anchor.removeEventListener('mouseleave', hideIcon);
    icon.remove();
  }
  translateIcons.clear();

  /* Remove data attributes */
  document.querySelectorAll(`[data-vt-icon-added]`).forEach(el => {
    delete el.dataset.vtIconAdded;
  });
}

/*
 * --------------------------------------------------------------------------
 * Core: Process all images on the page
 * --------------------------------------------------------------------------
 * Scans for images, then processes them with concurrency control. We limit
 * the number of images processed simultaneously to avoid overwhelming
 * the OCR backend and the browser.
 */
async function processAllImages() {
  const images = scanForImages();

  if (images.length === 0) {
    console.log('[VisionTranslate] No qualifying images found on this page.');
    return;
  }

  /* Report total count to background for badge display */
  chrome.runtime.sendMessage({
    action: 'UPDATE_PROGRESS',
    payload: { total: images.length, completed: 0 }
  });

  /*
   * Process images with concurrency control. We use a simple "pool"
   * pattern: start up to MAX_CONCURRENT_IMAGES tasks, and as each
   * finishes, start the next one.
   *
   * This is like a queue: we keep N workers busy at all times until
   * the queue is empty.
   */
  let completedCount = 0;
  let nextIndex = 0;

  async function processNext() {
    while (nextIndex < images.length) {
      const currentIndex = nextIndex;
      nextIndex++;

      await processImage(images[currentIndex]);

      completedCount++;

      /* Report progress to background */
      chrome.runtime.sendMessage({
        action: 'UPDATE_PROGRESS',
        payload: { total: images.length, completed: completedCount }
      });
    }
  }

  /*
   * Start MAX_CONCURRENT_IMAGES "workers" running in parallel.
   * Each worker calls processNext(), which grabs the next image from
   * the shared queue (nextIndex) and processes it. When the queue is
   * empty, the worker returns.
   *
   * Promise.all waits for all workers to finish.
   */
  const workers = [];
  for (let i = 0; i < Math.min(MAX_CONCURRENT_IMAGES, images.length); i++) {
    workers.push(processNext());
  }

  await Promise.all(workers);

  console.log(`[VisionTranslate] Finished processing ${completedCount} images`);
}

/*
 * --------------------------------------------------------------------------
 * Core: Set up MutationObserver for dynamically loaded images
 * --------------------------------------------------------------------------
 * Many modern websites load images lazily (as you scroll) or dynamically
 * (after JavaScript runs). A MutationObserver watches for DOM changes
 * and lets us process new images as they appear.
 *
 * HOW MUTATIONOBSERVER WORKS:
 *   1. You create an observer with a callback function.
 *   2. You tell it what to watch (child nodes added, attributes changed).
 *   3. Whenever a matching change happens, your callback is called with
 *      a list of "mutation records" describing what changed.
 */
function setupMutationObserver() {
  /*
   * Debounce timer. When many mutations happen rapidly (e.g., a
   * framework re-rendering a large list), we don't want to scan for
   * images on every single mutation. Instead, we wait for mutations
   * to stop for 500ms, then scan once.
   */
  let debounceTimer = null;

  pageObserver = new MutationObserver((mutationsList) => {
    /*
     * Quick check: do any of the mutations involve image-related changes?
     * If not, skip the debounced scan entirely.
     */
    let hasRelevantChanges = false;

    for (const mutation of mutationsList) {
      if (mutation.type === 'childList') {
        /*
         * childList mutations mean nodes were added or removed.
         * Check if any added nodes are images or contain images.
         */
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (
              node.tagName === 'IMG' ||
              node.tagName === 'CANVAS' ||
              node.querySelector?.('img, canvas')
            ) {
              hasRelevantChanges = true;
              break;
            }
          }
        }
      } else if (mutation.type === 'attributes') {
        /*
         * Attribute mutations: an image's src might have changed
         * (lazy loading often sets src from data-src).
         */
        if (
          mutation.target.tagName === 'IMG' &&
          (mutation.attributeName === 'src' || mutation.attributeName === 'srcset')
        ) {
          hasRelevantChanges = true;
        }
      }

      if (hasRelevantChanges) break;
    }

    if (!hasRelevantChanges) return;

    /*
     * Debounce: clear any pending timer and set a new one. The scan
     * will only happen after 500ms of no new relevant mutations.
     */
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (isActive) {
        console.log('[VisionTranslate] New images detected, scanning...');
        processAllImages();
      }
    }, 500);
  });

  /*
   * Start observing the entire document body. The options specify what
   * kinds of DOM changes to watch for:
   *
   * childList: true — Watch for nodes being added or removed
   * subtree: true — Watch the ENTIRE subtree, not just direct children
   * attributes: true — Watch for attribute changes (like src changing)
   * attributeFilter: [...] — Only watch these specific attributes
   *     (performance optimization to avoid firing on every attribute change)
   */
  pageObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'srcset', 'style']
  });

  console.log('[VisionTranslate] MutationObserver active — watching for new images');
}

/*
 * --------------------------------------------------------------------------
 * UI: Create the floating toolbar (in Shadow DOM)
 * --------------------------------------------------------------------------
 * The toolbar gives the user controls to:
 *   - Toggle translations on/off
 *   - See translation progress
 *   - Quick-toggle individual images
 *
 * We use Shadow DOM so our CSS is completely isolated from the page.
 *
 * SHADOW DOM EXPLAINER:
 * Shadow DOM creates an encapsulated DOM subtree. The page's CSS
 * cannot style elements inside the shadow, and our CSS cannot leak
 * out to the page. This is crucial because every website has different
 * CSS that would break our toolbar layout.
 *
 * Structure:
 *   <div id="vt-lensmu-toolbar-host">   (in the page DOM)
 *     #shadow-root                       (shadow boundary)
 *       <style>...</style>               (our isolated CSS)
 *       <div class="toolbar">            (our toolbar HTML)
 *         ...
 *       </div>
 */
function createToolbar() {
  /* Remove existing toolbar if present (e.g., from a previous activation) */
  const existing = document.getElementById(`${CLASS_PREFIX}-toolbar-host`);
  if (existing) {
    existing.remove();
  }

  /*
   * Create the host element. This is the only element visible in the
   * page's DOM. Everything inside the shadow root is hidden from the
   * page's JavaScript and CSS.
   */
  toolbarContainer = document.createElement('div');
  toolbarContainer.id = `${CLASS_PREFIX}-toolbar-host`;

  /*
   * Use very specific inline styles on the host to ensure it's always
   * visible and properly positioned, regardless of the page's CSS.
   * These styles are on the HOST element (outside the shadow), so they
   * ARE affected by the page's CSS. We use !important and very specific
   * values to minimize conflicts.
   */
  toolbarContainer.style.cssText = `
    position: fixed !important;
    bottom: 20px !important;
    right: 20px !important;
    z-index: 2147483647 !important;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
    font-size: 14px !important;
    line-height: 1.4 !important;
  `;

  /*
   * Attach a shadow root. { mode: 'open' } means JavaScript outside
   * the shadow CAN access shadow internals via element.shadowRoot.
   * { mode: 'closed' } would prevent that, but 'open' is fine for our
   * use case and makes debugging easier.
   */
  const shadow = toolbarContainer.attachShadow({ mode: 'open' });

  /*
   * Define the toolbar HTML and CSS inside the shadow root.
   * All of this is isolated from the page.
   */
  shadow.innerHTML = `
    <style>
      /*
       * All styles here are SCOPED to the shadow root. They cannot
       * affect the page, and the page's styles cannot affect us.
       */

      .toolbar {
        background: #1a1a2e;
        border-radius: 12px;
        padding: 10px 14px;
        display: flex;
        align-items: center;
        gap: 10px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        color: #ffffff;
        user-select: none;
        /* Transition for smooth collapse/expand */
        transition: all 0.3s ease;
      }

      .toolbar.collapsed {
        padding: 6px 10px;
      }

      .toolbar-logo {
        width: 24px;
        height: 24px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: bold;
        font-size: 12px;
        flex-shrink: 0;
        cursor: pointer;
      }

      .toolbar-status {
        font-size: 12px;
        color: #a0a0b0;
        white-space: nowrap;
      }

      .toolbar-btn {
        background: none;
        border: 1px solid #333355;
        border-radius: 6px;
        color: #ffffff;
        padding: 4px 10px;
        cursor: pointer;
        font-size: 12px;
        white-space: nowrap;
        transition: background 0.2s, border-color 0.2s;
      }

      .toolbar-btn:hover {
        background: #333355;
        border-color: #667eea;
      }

      .toolbar-btn.active {
        background: #667eea;
        border-color: #667eea;
      }

      .toolbar-close {
        background: none;
        border: none;
        color: #666680;
        cursor: pointer;
        font-size: 16px;
        padding: 0 2px;
        line-height: 1;
        transition: color 0.2s;
      }

      .toolbar-close:hover {
        color: #ff4444;
      }

      .toolbar-content {
        display: flex;
        align-items: center;
        gap: 10px;
        overflow: hidden;
        transition: max-width 0.3s ease, opacity 0.3s ease;
        max-width: 500px;
        opacity: 1;
      }

      .toolbar.collapsed .toolbar-content {
        max-width: 0;
        opacity: 0;
      }
    </style>

    <div class="toolbar" id="toolbar">
      <div class="toolbar-logo" id="toolbar-logo" title="Click to collapse/expand">VT</div>
      <div class="toolbar-content" id="toolbar-content">
        <span class="toolbar-status" id="toolbar-status">Scanning images...</span>
        <button class="toolbar-btn" id="btn-translate-all" title="Translate all images on this page">
          Translate All
        </button>
        <button class="toolbar-btn active" id="btn-toggle" title="Show/hide translations">
          Translations: ON
        </button>
        <button class="toolbar-close" id="btn-close" title="Close toolbar (translations stay active)">
          &times;
        </button>
      </div>
    </div>
  `;

  /*
   * Wire up event handlers. We query within the shadow root, not the
   * page document. shadow.getElementById works just like
   * document.getElementById but scoped to the shadow.
   */
  const toolbar = shadow.getElementById('toolbar');
  const logo = shadow.getElementById('toolbar-logo');
  const translateAllBtn = shadow.getElementById('btn-translate-all');
  const toggleBtn = shadow.getElementById('btn-toggle');
  const closeBtn = shadow.getElementById('btn-close');

  /* Logo click: collapse/expand the toolbar */
  logo.addEventListener('click', () => {
    toolbar.classList.toggle('collapsed');
  });

  /* Translate All button: process every image on the page */
  translateAllBtn.addEventListener('click', async () => {
    translateAllBtn.textContent = 'Translating...';
    translateAllBtn.disabled = true;
    updateToolbarStatus('Translating all images...');
    await processAllImages();
    translateAllBtn.textContent = 'Done ✓';
    updateToolbarStatus('Translation complete');
  });

  /* Toggle button: show/hide all translation overlays */
  toggleBtn.addEventListener('click', () => {
    toggleAllOverlays();
    const isShowing = toggleBtn.classList.toggle('active');
    toggleBtn.textContent = `Translations: ${isShowing ? 'ON' : 'OFF'}`;
  });

  /* Close button: remove the toolbar (but keep translations active) */
  closeBtn.addEventListener('click', () => {
    toolbarContainer.remove();
    toolbarContainer = null;
  });

  /*
   * Add to the page root. The toolbar is fixed-position UI, not tied to any
   * one image element, so mounting it on the document avoids scope issues and
   * keeps it stable across different page layouts.
   */
  const mountTarget = document.body || document.documentElement;
  if (!mountTarget) {
    console.warn('[VisionTranslate] Could not find a document root for the toolbar');
    return;
  }

  mountTarget.appendChild(toolbarContainer);

  console.log('[VisionTranslate] Toolbar created');
}

/*
 * --------------------------------------------------------------------------
 * UI: Update toolbar status text
 * --------------------------------------------------------------------------
 */
function updateToolbarStatus(text) {
  if (!toolbarContainer) return;

  const shadow = toolbarContainer.shadowRoot;
  if (!shadow) return;

  const statusEl = shadow.getElementById('toolbar-status');
  if (statusEl) {
    statusEl.textContent = text;
  }
}

/*
 * --------------------------------------------------------------------------
 * Core: Toggle all overlays visibility
 * --------------------------------------------------------------------------
 * Shows or hides all canvas overlays on the page. When hidden, the
 * original images are visible. When shown, the translated text is visible.
 *
 * We do this by toggling the canvas element's display style. We also
 * call the overlay module's restore/render functions if available.
 */
function toggleAllOverlays() {
  const canvases = document.querySelectorAll(`.${CLASS_PREFIX}-canvas`);

  for (const canvas of canvases) {
    if (canvas.style.display === 'none') {
      canvas.style.display = 'block';
    } else {
      canvas.style.display = 'none';
    }
  }
}

/*
 * --------------------------------------------------------------------------
 * Core: Clean up all overlays and state
 * --------------------------------------------------------------------------
 * Called when deactivating. Removes all canvases, wrappers, and
 * restores the original page layout.
 */
function cleanupAll() {
  /*
   * Remove all wrapper divs and restore images to their original
   * position in the DOM.
   */
  const wrappers = document.querySelectorAll(`.${CLASS_PREFIX}-wrapper`);

  for (const wrapper of wrappers) {
    /*
     * Move child elements (the original image) back out of the wrapper,
     * then remove the wrapper.
     *
     * wrapper.parentNode.insertBefore(child, wrapper) moves the child
     * to just before the wrapper in the parent, then we remove the
     * wrapper.
     */
    const children = Array.from(wrapper.children);
    for (const child of children) {
      /* Skip our canvas overlays — they'll be removed with the wrapper */
      if (child.classList?.contains(`${CLASS_PREFIX}-canvas`)) {
        continue;
      }

      /* Move original image back to the wrapper's position */
      wrapper.parentNode.insertBefore(child, wrapper);
    }

    wrapper.remove();
  }

  /* Remove any stray canvases that might not be in wrappers */
  const canvases = document.querySelectorAll(`.${CLASS_PREFIX}-canvas`);
  for (const canvas of canvases) {
    canvas.remove();
  }

  /* Remove per-image translate icons */
  removeTranslateIcons();

  /* Also remove icon wrappers */
  const iconWrappers = document.querySelectorAll(`.${CLASS_PREFIX}-icon-wrapper`);
  for (const wrapper of iconWrappers) {
    const children = Array.from(wrapper.children);
    for (const child of children) {
      if (!child.classList?.contains(`${CLASS_PREFIX}-translate-icon`)) {
        wrapper.parentNode.insertBefore(child, wrapper);
      }
    }
    wrapper.remove();
  }

  /* Remove the toolbar */
  if (toolbarContainer) {
    toolbarContainer.remove();
    toolbarContainer = null;
  }

  /* Disconnect the MutationObserver */
  if (pageObserver) {
    pageObserver.disconnect();
    pageObserver = null;
  }

  /*
   * Note: We cannot clear the WeakMap and WeakSet explicitly, but
   * since they use weak references, entries will be garbage-collected
   * when the image elements are no longer referenced.
   *
   * However, for the Set of processedImages, we want to allow
   * re-processing if the user activates again. So we need to track
   * which images we cleaned up. The simplest approach: since this
   * script is re-injected on navigation, and activation is a fresh
   * start each time, processed state is naturally reset.
   */

  console.log('[VisionTranslate] All overlays and state cleaned up');
}

/*
 * --------------------------------------------------------------------------
 * Core: Activate translation on the current page
 * --------------------------------------------------------------------------
 * Called when we receive an ACTIVATE message from the background script.
 */
async function activate(settings) {
  if (isActive) {
    console.log('[VisionTranslate] Already active, ignoring duplicate activation');
    return;
  }

  isActive = true;
  currentSettings = settings || {};

  console.log('[VisionTranslate] Activating with settings:', currentSettings);

  /* Create the floating toolbar */
  createToolbar();

  /* Set up the MutationObserver to catch dynamically loaded images */
  setupMutationObserver();

  /*
   * Add translate icons to all qualifying images. Users can click
   * individual icons to translate specific images, or use the
   * "Translate All" button in the toolbar to do them all at once.
   */
  updateToolbarStatus('Scanning for images...');
  addTranslateIcons();

  const imageCount = translateIcons.size;
  if (imageCount === 0) {
    updateToolbarStatus('No translatable images found');
  } else {
    updateToolbarStatus(`Found ${imageCount} images — hover to translate`);
  }
}

/*
 * --------------------------------------------------------------------------
 * Core: Deactivate translation on the current page
 * --------------------------------------------------------------------------
 * Called when we receive a DEACTIVATE message from the background script.
 */
function deactivate() {
  if (!isActive) {
    console.log('[VisionTranslate] Already inactive, ignoring duplicate deactivation');
    return;
  }

  isActive = false;
  currentSettings = {};
  cleanupAll();

  console.log('[VisionTranslate] Deactivated');
}

/*
 * ==========================================================================
 * MESSAGE LISTENER
 * ==========================================================================
 * Listen for messages from the background script. This is how the
 * background script tells us to activate, deactivate, or update.
 *
 * Just like in background.js, we return `true` from the listener to
 * keep the message channel open for async responses.
 * ==========================================================================
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action, payload } = message;

  console.log(`[VisionTranslate Content] Message received: ${action}`);

  switch (action) {
    /*
     * ACTIVATE: Start scanning and translating images on this page.
     * The payload contains the current settings (target language, etc.)
     */
    case 'ACTIVATE':
    case 'TRANSLATE_PAGE': {
      /*
       * Both ACTIVATE (from background.js toggle) and TRANSLATE_PAGE
       * (from the popup's "Translate This Page" button) trigger the
       * same activation flow. The payload may contain settings directly
       * or nested under payload.settings.
       */
      const settings = payload?.settings || message.settings || payload;
      activate(settings).then(() => {
        sendResponse({ success: true });
      });
      /* Return true because activate() is async */
      return true;
    }

    /*
     * DEACTIVATE: Stop translation and clean up all overlays.
     */
    case 'DEACTIVATE': {
      deactivate();
      sendResponse({ success: true });
      break;
    }

    /*
     * SETTINGS_UPDATED: The user changed settings in the popup.
     * Update our local copy. If we're active, we might want to
     * re-translate with the new target language.
     */
    case 'SETTINGS_UPDATED': {
      const oldLang = currentSettings.targetLanguage;
      currentSettings = payload?.settings || currentSettings;

      /*
       * If the target language changed, re-process all images with
       * the new language. This is a bit heavy-handed (re-doing OCR
       * too) but keeps the code simple. A production version would
       * cache OCR results and only re-translate.
       */
      if (isActive && oldLang !== currentSettings.targetLanguage) {
        cleanupAll();
        createToolbar();
        setupMutationObserver();
        updateToolbarStatus('Re-translating with new language...');
        processAllImages().then(() => {
          updateToolbarStatus('Translation complete');
        });
      }

      sendResponse({ success: true });
      break;
    }

    default: {
      console.warn(`[VisionTranslate Content] Unknown action: ${action}`);
      sendResponse({ error: `Unknown action: ${action}` });
    }
  }

  /* For synchronous responses, we don't need to return true */
  return false;
});

/*
 * --------------------------------------------------------------------------
 * Initialization
 * --------------------------------------------------------------------------
 * When the content script first loads, we just log that we're ready.
 * We don't scan for images until the user activates the extension.
 * This keeps the content script lightweight on pages where the user
 * doesn't need translation.
 */
console.log('[VisionTranslate] Content script loaded and ready. Waiting for activation.');
