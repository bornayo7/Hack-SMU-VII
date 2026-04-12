/*
 * ==========================================================================
 * VisionTranslate — Canvas Overlay Rendering Engine (overlay.js)
 * ==========================================================================
 *
 * This module handles the visual rendering of translated text on top of
 * images. It is the most visually complex part of the extension.
 *
 * HIGH-LEVEL APPROACH:
 * --------------------
 * For each image, we have:
 *   - A list of OCR results: bounding boxes where text was detected,
 *     along with the original text and a confidence score.
 *   - A list of translations: the translated text for each bounding box.
 *   - A <canvas> element positioned exactly on top of the original image.
 *
 * For each text block, we:
 *   1. Sample the background color around the bounding box edges to
 *      determine what color the original background is.
 *   2. Fill a rectangle over the original text with that sampled color,
 *      effectively "erasing" the original text visually.
 *   3. Auto-size a font to fit the translated text within the bounding box.
 *   4. Detect if the text should be rendered vertically (common for CJK
 *      languages like Chinese, Japanese, Korean when height > width * 1.5).
 *   5. Render the translated text centered in the bounding box.
 *   6. Optionally draw a confidence-colored border around the box.
 *
 * WHY CANVAS (not DOM overlays)?
 * ------------------------------
 * We use canvas instead of positioned DOM elements because:
 *   - Canvas can match the exact pixel coordinates from OCR.
 *   - No risk of page CSS interfering with text styling.
 *   - Better performance with many text blocks (one draw vs. many DOM nodes).
 *   - Easier to sample colors from the original image.
 *   - Smoother rendering for rotated or non-standard text layouts.
 *
 * COORDINATE SYSTEM:
 * ------------------
 * OCR bounding boxes use coordinates relative to the ORIGINAL image size
 * (naturalWidth x naturalHeight). But the canvas might be sized to the
 * DISPLAYED size (CSS width x height), which could be different.
 *
 * We handle this by computing a scale factor:
 *   scaleX = canvas CSS width / image natural width
 *   scaleY = canvas CSS height / image natural height
 *
 * All OCR coordinates are multiplied by these factors before drawing.
 * The DPR (device pixel ratio) scaling is already handled by the canvas
 * context in content.js (ctx.scale(dpr, dpr)), so we work in CSS pixels.
 * ==========================================================================
 */

/*
 * --------------------------------------------------------------------------
 * Background Color Sampling Algorithm
 * --------------------------------------------------------------------------
 * To "erase" the original text, we need to know what color is behind it.
 * We sample pixels around the EDGES of the bounding box (not from inside,
 * because inside is where the text is and would give us the text color).
 *
 * Sampling strategy:
 *   1. Sample N points along each of the 4 edges of the bounding box,
 *      but slightly OUTSIDE the box (2px offset).
 *   2. Collect all sampled colors.
 *   3. Find the most common color (mode) — this handles cases where some
 *      edge pixels are part of other text or decorations.
 *   4. Fall back to the average color if no clear mode exists.
 *
 *        samples along top edge (offset upward by 2px)
 *   ─── · · · · · · · · · · ───
 *   │                           │ ← samples along right edge
 *   │    [original text here]   │
 *   │                           │ ← samples along left edge
 *   ─── · · · · · · · · · · ───
 *        samples along bottom edge (offset downward by 2px)
 *
 * @param {CanvasRenderingContext2D} ctx
 *        The canvas 2D context. IMPORTANT: This must be the context of a
 *        canvas that has the ORIGINAL IMAGE drawn on it (not the overlay
 *        canvas). We create a temporary canvas for this purpose.
 *
 * @param {number} x      — Left edge of bounding box (in canvas coords)
 * @param {number} y      — Top edge of bounding box (in canvas coords)
 * @param {number} width  — Width of bounding box (in canvas coords)
 * @param {number} height — Height of bounding box (in canvas coords)
 *
 * @returns {{r: number, g: number, b: number, a: number}}
 *          The estimated background color as RGBA values (0-255 each).
 */
function sampleBackgroundColor(ctx, x, y, width, height) {
  /*
   * Number of sample points along each edge. More points = more
   * accurate but slower. 10 is a good balance for most images.
   */
  const SAMPLES_PER_EDGE = 10;

  /*
   * How far outside the bounding box to sample (in pixels).
   * We go slightly outside because the box edges might clip text.
   */
  const OFFSET = 2;

  /*
   * Get the canvas dimensions for bounds checking. We must not
   * sample outside the canvas boundaries.
   */
  const canvasWidth = ctx.canvas.width;
  const canvasHeight = ctx.canvas.height;

  /*
   * Collect all sampled colors. Each entry is an {r, g, b, a} object.
   */
  const samples = [];

  /*
   * Helper: Sample a single pixel and add it to our collection.
   * getImageData(x, y, 1, 1) returns a 1x1 pixel's RGBA data as
   * a Uint8ClampedArray of length 4: [red, green, blue, alpha].
   *
   * We clamp coordinates to canvas bounds to avoid errors.
   */
  function samplePixel(px, py) {
    /* Clamp to canvas bounds */
    const sx = Math.max(0, Math.min(Math.round(px), canvasWidth - 1));
    const sy = Math.max(0, Math.min(Math.round(py), canvasHeight - 1));

    try {
      const pixel = ctx.getImageData(sx, sy, 1, 1).data;
      samples.push({
        r: pixel[0],
        g: pixel[1],
        b: pixel[2],
        a: pixel[3]
      });
    } catch (e) {
      /*
       * getImageData can throw SecurityError if the canvas is tainted
       * (contains cross-origin image data). In that case, we fall back
       * to a default color later.
       */
    }
  }

  /*
   * Sample along the TOP edge (y - OFFSET):
   * Spread SAMPLES_PER_EDGE points evenly across the width.
   */
  for (let i = 0; i < SAMPLES_PER_EDGE; i++) {
    const px = x + (width * i) / (SAMPLES_PER_EDGE - 1 || 1);
    const py = y - OFFSET;
    samplePixel(px, py);
  }

  /*
   * Sample along the BOTTOM edge (y + height + OFFSET):
   */
  for (let i = 0; i < SAMPLES_PER_EDGE; i++) {
    const px = x + (width * i) / (SAMPLES_PER_EDGE - 1 || 1);
    const py = y + height + OFFSET;
    samplePixel(px, py);
  }

  /*
   * Sample along the LEFT edge (x - OFFSET):
   */
  for (let i = 0; i < SAMPLES_PER_EDGE; i++) {
    const px = x - OFFSET;
    const py = y + (height * i) / (SAMPLES_PER_EDGE - 1 || 1);
    samplePixel(px, py);
  }

  /*
   * Sample along the RIGHT edge (x + width + OFFSET):
   */
  for (let i = 0; i < SAMPLES_PER_EDGE; i++) {
    const px = x + width + OFFSET;
    const py = y + (height * i) / (SAMPLES_PER_EDGE - 1 || 1);
    samplePixel(px, py);
  }

  /*
   * If we couldn't sample any pixels (canvas tainted or empty box),
   * return white as a safe default.
   */
  if (samples.length === 0) {
    return { r: 255, g: 255, b: 255, a: 255 };
  }

  /*
   * Find the most common color using a frequency map.
   * We quantize colors to reduce the number of unique values:
   * round each channel to the nearest multiple of 8. This groups
   * very similar colors together (e.g., rgb(200,200,200) and
   * rgb(203,201,199) become the same bucket).
   *
   * Why quantize? Real images have slight color variations due to
   * compression artifacts, anti-aliasing, and gradients. Without
   * quantization, every pixel would be "unique" and there would be
   * no clear mode.
   */
  const QUANT = 8; /* Quantization step */
  const colorBuckets = new Map();

  for (const sample of samples) {
    const qr = Math.round(sample.r / QUANT) * QUANT;
    const qg = Math.round(sample.g / QUANT) * QUANT;
    const qb = Math.round(sample.b / QUANT) * QUANT;
    const key = `${qr},${qg},${qb}`;

    if (colorBuckets.has(key)) {
      const bucket = colorBuckets.get(key);
      bucket.count++;
      /* Accumulate actual (non-quantized) values for averaging within bucket */
      bucket.totalR += sample.r;
      bucket.totalG += sample.g;
      bucket.totalB += sample.b;
      bucket.totalA += sample.a;
    } else {
      colorBuckets.set(key, {
        count: 1,
        totalR: sample.r,
        totalG: sample.g,
        totalB: sample.b,
        totalA: sample.a
      });
    }
  }

  /*
   * Find the bucket with the highest count (the mode).
   * Then compute the average color within that bucket for accuracy.
   */
  let bestBucket = null;
  let bestCount = 0;

  for (const bucket of colorBuckets.values()) {
    if (bucket.count > bestCount) {
      bestCount = bucket.count;
      bestBucket = bucket;
    }
  }

  return {
    r: Math.round(bestBucket.totalR / bestBucket.count),
    g: Math.round(bestBucket.totalG / bestBucket.count),
    b: Math.round(bestBucket.totalB / bestBucket.count),
    a: Math.round(bestBucket.totalA / bestBucket.count)
  };
}

/*
 * --------------------------------------------------------------------------
 * Contrast Color Helper
 * --------------------------------------------------------------------------
 * Given a background color, returns black or white — whichever provides
 * better contrast for readability.
 *
 * Uses the W3C relative luminance formula:
 *   L = 0.2126 * R + 0.7152 * G + 0.0722 * B
 * where R, G, B are linearized (gamma-corrected) values.
 *
 * If the luminance is above 0.5, the background is "light" and we
 * return black text. Otherwise, white text.
 *
 * @param {{r: number, g: number, b: number}} color — RGB color (0-255)
 * @returns {string} — "black" or "white"
 */
function getContrastColor(color) {
  /*
   * Linearize: convert from sRGB to linear RGB.
   * sRGB has a gamma curve; we need to undo it for accurate luminance.
   * For simplicity we use the common approximation: (value / 255)^2.2
   */
  const r = Math.pow(color.r / 255, 2.2);
  const g = Math.pow(color.g / 255, 2.2);
  const b = Math.pow(color.b / 255, 2.2);

  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

  /* 0.179 is the threshold where 4.5:1 contrast ratio is achieved with both black and white */
  return luminance > 0.179 ? 'black' : 'white';
}

/*
 * --------------------------------------------------------------------------
 * Confidence Border Color
 * --------------------------------------------------------------------------
 * Returns a color representing the OCR confidence level:
 *   - Green  (>= 0.8): High confidence — the OCR is very sure about the text
 *   - Yellow (>= 0.5): Medium confidence — might have errors
 *   - Red    (< 0.5):  Low confidence — likely incorrect, user should verify
 *
 * @param {number} confidence — Value between 0 and 1
 * @returns {string} — CSS color string
 */
function getConfidenceBorderColor(confidence) {
  if (confidence >= 0.8) {
    return 'rgba(76, 175, 80, 0.7)';   /* Green — Material Design green */
  } else if (confidence >= 0.5) {
    return 'rgba(255, 193, 7, 0.7)';    /* Yellow/Amber */
  } else {
    return 'rgba(244, 67, 54, 0.7)';    /* Red */
  }
}

function breakTokenToFit(ctx, token, maxWidth) {
  if (ctx.measureText(token).width <= maxWidth) {
    return [token];
  }

  const fragments = [];
  let currentFragment = '';

  for (const char of Array.from(token)) {
    const testFragment = currentFragment + char;

    if (currentFragment && ctx.measureText(testFragment).width > maxWidth) {
      fragments.push(currentFragment);
      currentFragment = char;
    } else if (ctx.measureText(testFragment).width > maxWidth) {
      fragments.push(char);
      currentFragment = '';
    } else {
      currentFragment = testFragment;
    }
  }

  if (currentFragment) {
    fragments.push(currentFragment);
  }

  return fragments.length > 0 ? fragments : [token];
}

function wrapHorizontalText(
  ctx,
  text,
  availableWidth,
  availableHeight,
  lineHeight,
  { allowTruncation = true } = {}
) {
  const wrappedLines = [];
  const paragraphs = String(text || '')
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  if (paragraphs.length === 0) {
    return {
      lines: [''],
      truncated: false
    };
  }

  for (const paragraph of paragraphs) {
    const useWordTokens = /\s/.test(paragraph);
    const separator = useWordTokens ? ' ' : '';
    const tokens = useWordTokens
      ? paragraph.split(/\s+/).filter(Boolean)
      : Array.from(paragraph);

    let currentLine = '';

    for (const token of tokens) {
      const fragments = breakTokenToFit(ctx, token, availableWidth);

      for (const fragment of fragments) {
        const testLine = currentLine
          ? `${currentLine}${separator}${fragment}`
          : fragment;

        if (currentLine && ctx.measureText(testLine).width > availableWidth) {
          wrappedLines.push(currentLine);
          currentLine = fragment;
        } else if (ctx.measureText(testLine).width > availableWidth) {
          wrappedLines.push(truncateWithEllipsis(ctx, fragment, availableWidth));
          currentLine = '';
        } else {
          currentLine = testLine;
        }
      }
    }

    if (currentLine) {
      wrappedLines.push(currentLine);
    }
  }

  if (wrappedLines.length === 0) {
    return {
      lines: [''],
      truncated: false
    };
  }

  const maxLines = Math.max(1, Math.floor(availableHeight / lineHeight));

  if (wrappedLines.length <= maxLines) {
    return {
      lines: wrappedLines,
      truncated: false
    };
  }

  if (!allowTruncation) {
    return null;
  }

  const truncatedLines = wrappedLines.slice(0, maxLines);
  truncatedLines[maxLines - 1] = truncateWithEllipsis(
    ctx,
    truncatedLines[maxLines - 1],
    availableWidth
  );

  return {
    lines: truncatedLines,
    truncated: true
  };
}

/*
 * --------------------------------------------------------------------------
 * Auto-Size Font to Fit Bounding Box
 * --------------------------------------------------------------------------
 * Binary search for the largest font size that makes the translated text
 * fit within the given bounding box dimensions.
 *
 * HOW IT WORKS:
 *   1. Start with a range of possible font sizes (minSize to maxSize).
 *   2. Try the midpoint font size.
 *   3. Measure the text with that font size using ctx.measureText().
 *   4. If it fits, try a larger size. If not, try a smaller size.
 *   5. Repeat until we converge on the best size.
 *
 * For multi-line text, we split into lines that fit the width, then
 * check if all lines fit the height.
 *
 * @param {CanvasRenderingContext2D} ctx — Canvas context for measuring
 * @param {string} text — The text to fit
 * @param {number} maxWidth — Maximum width in pixels
 * @param {number} maxHeight — Maximum height in pixels
 * @param {string} fontFamily — Font family to use
 * @param {boolean} isVertical — Whether to render text vertically
 * @returns {{fontSize: number, lines: string[], truncated: boolean}}
 *          The best font size, the text split into lines, and whether the
 *          renderer had to truncate because the full translation could not fit.
 */
function autoSizeFont(ctx, text, maxWidth, maxHeight, fontFamily, isVertical) {
  /*
   * Font size boundaries for binary search.
   * MIN: 6px is the smallest readable font size.
   * MAX: We cap at the bounding box height (or width for vertical text)
   * because the font can never be larger than the box itself.
   */
  const MIN_FONT_SIZE = 6;
  const MAX_FONT_SIZE = isVertical ? maxWidth : maxHeight;

  /*
   * Padding: leave a small margin inside the bounding box so text
   * doesn't touch the edges. 4px total (2px on each side).
   */
  const PADDING = 4;
  const availableWidth = maxWidth - PADDING;
  const availableHeight = maxHeight - PADDING;
  const normalizedText = String(text || '').trim();

  if (availableWidth <= 0 || availableHeight <= 0) {
    return { fontSize: MIN_FONT_SIZE, lines: [normalizedText], truncated: false };
  }

  /*
   * Helper: Given a font size, split the text into lines that fit
   * within availableWidth, and check if total height fits.
   *
   * Returns null if it doesn't fit, or the array of lines if it does.
   */
  function tryFontSize(size, { allowTruncation = false } = {}) {
    ctx.font = `${size}px "${fontFamily}", sans-serif`;

    if (isVertical) {
      /*
       * VERTICAL TEXT LAYOUT:
       * For CJK vertical text, each character goes on its own "line"
       * (actually a column). We stack characters top-to-bottom, and
       * multiple columns go right-to-left.
       *
       * For vertical layout:
       *   - "width" of a column = font size (each character is ~square)
       *   - "height" of a column = availableHeight
       *   - Characters per column = floor(availableHeight / size)
       *   - Number of columns needed = ceil(charCount / charsPerColumn)
       *   - Total width needed = columns * size
       */
      const charsPerColumn = Math.floor(availableHeight / (size * 1.2));
      if (charsPerColumn <= 0) return null;

      const columns = Math.ceil(text.length / charsPerColumn);
      const totalWidth = columns * size * 1.2;

      if (totalWidth > availableWidth) return null;

      /* Split text into column groups */
      const lines = [];
      for (let i = 0; i < normalizedText.length; i += charsPerColumn) {
        lines.push(normalizedText.slice(i, i + charsPerColumn));
      }

      return {
        lines,
        truncated: false
      };
    } else {
      /*
       * HORIZONTAL TEXT LAYOUT:
       * Standard left-to-right text wrapping. We preserve explicit line
       * breaks from translation output and fall back to character-level
       * wrapping for text without spaces.
       *
       * Line height = font size * 1.3 (standard line spacing).
       */
      const lineHeight = size * 1.3;
      return wrapHorizontalText(
        ctx,
        normalizedText,
        availableWidth,
        availableHeight,
        lineHeight,
        { allowTruncation }
      );
    }
  }

  /*
   * Binary search for the largest font size that fits.
   *
   * Binary search works by repeatedly halving the search range:
   *   - If midpoint fits → search upper half (try bigger)
   *   - If midpoint doesn't fit → search lower half (try smaller)
   *
   * We stop when the range is smaller than 0.5px (diminishing returns
   * beyond that level of precision).
   */
  let low = MIN_FONT_SIZE;
  let high = Math.min(MAX_FONT_SIZE, 72); /* Cap at 72px for sanity */
  let bestSize = MIN_FONT_SIZE;
  let bestLines = [normalizedText];
  let foundUntruncatedFit = false;

  while (high - low > 0.5) {
    const mid = (low + high) / 2;
    const lines = tryFontSize(mid);

    if (lines !== null) {
      /* It fits! Try a larger size. */
      bestSize = mid;
      bestLines = lines.lines;
      foundUntruncatedFit = true;
      low = mid;
    } else {
      /* Doesn't fit. Try smaller. */
      high = mid;
    }
  }

  if (foundUntruncatedFit) {
    return { fontSize: bestSize, lines: bestLines, truncated: false };
  }

  const fallback = tryFontSize(MIN_FONT_SIZE, { allowTruncation: true });
  return {
    fontSize: MIN_FONT_SIZE,
    lines: fallback?.lines || [truncateWithEllipsis(ctx, normalizedText, availableWidth)],
    truncated: Boolean(fallback?.truncated)
  };
}

/*
 * --------------------------------------------------------------------------
 * Helper: Truncate text with ellipsis to fit a given width
 * --------------------------------------------------------------------------
 * Removes characters from the end of the text and adds "..." until the
 * text fits within maxWidth.
 *
 * @param {CanvasRenderingContext2D} ctx — Canvas context with font already set
 * @param {string} text — Text to truncate
 * @param {number} maxWidth — Maximum width in pixels
 * @returns {string} — Truncated text with "..." appended
 */
function truncateWithEllipsis(ctx, text, maxWidth) {
  const ellipsis = '...';
  const ellipsisWidth = ctx.measureText(ellipsis).width;

  if (ctx.measureText(text).width <= maxWidth) {
    return text;
  }

  /*
   * Remove one character at a time from the end until the text
   * plus ellipsis fits. This is O(n) in the worst case, but text
   * strings from OCR are typically short.
   */
  let truncated = text;
  while (truncated.length > 0) {
    truncated = truncated.slice(0, -1);
    if (ctx.measureText(truncated + ellipsis).width <= maxWidth) {
      return truncated + ellipsis;
    }
  }

  return ellipsis;
}

/*
 * --------------------------------------------------------------------------
 * Detect if Text Should Be Vertical
 * --------------------------------------------------------------------------
 * CJK (Chinese, Japanese, Korean) text is traditionally written vertically,
 * with columns going from right to left. We detect vertical text by:
 *
 *   1. Checking if the bounding box is tall and narrow (height > width * 1.5).
 *      This is a strong indicator that the OCR detected a vertical column.
 *   2. Checking if the text contains CJK characters.
 *
 * Both conditions must be true to render vertically.
 *
 * @param {string} text — The text content
 * @param {number} boxWidth — Bounding box width
 * @param {number} boxHeight — Bounding box height
 * @returns {boolean}
 */
function shouldRenderVertical(text, boxWidth, boxHeight) {
  /* Condition 1: Box is significantly taller than wide */
  const isTallBox = boxHeight > boxWidth * 1.5;

  /*
   * Condition 2: Text contains CJK characters.
   * Unicode ranges for CJK:
   *   \u4E00-\u9FFF  — CJK Unified Ideographs (Chinese characters)
   *   \u3040-\u309F  — Hiragana (Japanese)
   *   \u30A0-\u30FF  — Katakana (Japanese)
   *   \uAC00-\uD7AF  — Hangul Syllables (Korean)
   *
   * We check if at least 30% of characters are CJK, since text might
   * contain mixed content (numbers, punctuation, Latin characters).
   */
  const cjkRegex = /[\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF]/g;
  const cjkMatches = text.match(cjkRegex);
  const cjkRatio = cjkMatches ? cjkMatches.length / text.length : 0;
  const hasCJK = cjkRatio >= 0.3;

  return isTallBox && hasCJK;
}

/*
 * ==========================================================================
 * MAIN EXPORT: renderTranslation()
 * ==========================================================================
 * Renders translated text on the overlay canvas.
 *
 * @param {HTMLCanvasElement} canvas
 *        The overlay canvas positioned on top of the original image.
 *
 * @param {HTMLImageElement|HTMLCanvasElement} originalImage
 *        The original image element. Used for:
 *        - Determining the scale factor between OCR coords and canvas coords.
 *        - Sampling background colors from the original image pixels.
 *
 * @param {Array<{text: string, confidence: number, bbox: {x, y, width, height}}>} ocrResults
 *        OCR results. Each entry has:
 *        - text: The detected text string
 *        - confidence: How confident the OCR is (0.0 to 1.0)
 *        - bbox: Bounding box in ORIGINAL image pixel coordinates
 *          - x: Left edge
 *          - y: Top edge
 *          - width: Box width
 *          - height: Box height
 *
 * @param {string[]} translations
 *        Array of translated strings, in the same order as ocrResults.
 *        translations[i] is the translation of ocrResults[i].text.
 */
export function renderTranslation(canvas, originalImage, ocrResults, translations) {
  const ctx = canvas.getContext('2d');

  /*
   * Explicitly set the DPR transform so coordinate math is always
   * correct, regardless of any prior context state changes.
   * After this, we work in CSS pixel space — drawing at (100, 100)
   * maps to the correct internal canvas pixel on any display.
   */
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  /*
   * Calculate scale factors. OCR bounding boxes are in the image's
   * natural coordinate space. The canvas CSS dimensions match the
   * displayed image size, which might be different.
   *
   * Example:
   *   Image natural size: 1000x800
   *   Canvas CSS size: 500x400 (image scaled to 50%)
   *   scaleX = 500 / 1000 = 0.5
   *   An OCR box at x=200 maps to canvas x=100
   */
  const naturalWidth = originalImage.naturalWidth || originalImage.width;
  const naturalHeight = originalImage.naturalHeight || originalImage.height;

  /*
   * canvas.style.width gives us the CSS display width (e.g., "500px").
   * We parse it to get the number.
   */
  const displayWidth = parseFloat(canvas.style.width);
  const displayHeight = parseFloat(canvas.style.height);

  const scaleX = displayWidth / naturalWidth;
  const scaleY = displayHeight / naturalHeight;

  /*
   * Create a temporary canvas with the ORIGINAL IMAGE drawn on it.
   * We need this to sample background colors from the original image
   * pixels. We can't sample from the overlay canvas because it starts
   * empty/transparent.
   */
  const samplingCanvas = document.createElement('canvas');
  const samplingCtx = samplingCanvas.getContext('2d');
  samplingCanvas.width = displayWidth;
  samplingCanvas.height = displayHeight;
  samplingCtx.drawImage(originalImage, 0, 0, displayWidth, displayHeight);

  /*
   * Font family to use for rendered text. We use a system font stack
   * that covers most languages well. For CJK text, browsers will
   * automatically fall back to appropriate fonts (like Noto Sans CJK
   * or system CJK fonts).
   */
  const fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans", "Noto Sans CJK SC", sans-serif';

  /*
   * Clear the overlay canvas before drawing. This removes any previous
   * rendering (important if we're re-rendering after a language change).
   */
  ctx.clearRect(0, 0, displayWidth, displayHeight);

  /*
   * Process each text block (OCR result + its translation).
   */
  for (let i = 0; i < ocrResults.length; i++) {
    const ocr = ocrResults[i];
    const translatedText = translations[i];

    /* Skip if no translation is available for this block */
    if (!translatedText) continue;

    /*
     * Scale the bounding box from image coordinates to canvas coordinates.
     */
    const box = {
      x: ocr.bbox.x * scaleX,
      y: ocr.bbox.y * scaleY,
      width: ocr.bbox.width * scaleX,
      height: ocr.bbox.height * scaleY
    };

    /* Skip boxes that are too small to render text in */
    if (box.width < 10 || box.height < 8) continue;

    /*
     * STEP 1: Sample the background color from the original image
     * around this bounding box.
     */
    const bgColor = sampleBackgroundColor(samplingCtx, box.x, box.y, box.width, box.height);

    /*
     * STEP 2: Fill a rectangle over the original text area with the
     * sampled background color. This visually "erases" the original text.
     *
     * We extend the rectangle slightly (2px on each side) to cover
     * any anti-aliased edges of the original text.
     */
    const BLEED = 2; /* Extra pixels to cover anti-aliased text edges */
    ctx.fillStyle = `rgba(${bgColor.r}, ${bgColor.g}, ${bgColor.b}, ${bgColor.a / 255})`;
    ctx.fillRect(
      box.x - BLEED,
      box.y - BLEED,
      box.width + BLEED * 2,
      box.height + BLEED * 2
    );

    /*
     * STEP 3: Determine text rendering direction and auto-size the font.
     */
    const isVertical = shouldRenderVertical(translatedText, box.width, box.height);
    const { fontSize, lines } = autoSizeFont(
      ctx, translatedText, box.width, box.height, fontFamily, isVertical
    );

    /*
     * STEP 4: Determine text color for maximum contrast against the
     * sampled background.
     */
    const textColor = getContrastColor(bgColor);
<<<<<<< Updated upstream
=======
    const outlineColor = textColor === 'black' ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.4)';
>>>>>>> Stashed changes

    /*
     * STEP 5: Render the translated text.
     */
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.width, box.height);
    ctx.clip();
    ctx.font = `${fontSize}px ${fontFamily}`;
    ctx.fillStyle = textColor;
    ctx.textBaseline = 'top';

    if (isVertical) {
      /*
       * VERTICAL TEXT RENDERING:
       * Each "line" is a column of characters. Columns go right-to-left.
       *
       * Starting position: right side of the box (since columns go RTL).
       * Each column is offset leftward by (fontSize * 1.2).
       * Within each column, characters are spaced vertically by fontSize * 1.1.
       */
      const columnWidth = fontSize * 1.2;
      const charHeight = fontSize * 1.1;

      for (let colIdx = 0; colIdx < lines.length; colIdx++) {
        const column = lines[colIdx];
        /*
         * X position: start from the right side of the box and move left.
         * colIdx 0 = rightmost column.
         */
        const colX = box.x + box.width - (colIdx + 1) * columnWidth;

        /*
         * Center the column vertically within the box.
         */
        const totalColumnHeight = column.length * charHeight;
        const startY = box.y + (box.height - totalColumnHeight) / 2;

        for (let charIdx = 0; charIdx < column.length; charIdx++) {
          const char = column[charIdx];
          const charY = startY + charIdx * charHeight;

          /*
           * Center each character horizontally within the column.
           * measureText gives us the character width.
           */
          const charMetrics = ctx.measureText(char);
          const charX = colX + (columnWidth - charMetrics.width) / 2;

          ctx.fillText(char, charX, charY);
        }
      }
    } else {
      /*
       * HORIZONTAL TEXT RENDERING:
       * Standard left-to-right, top-to-bottom rendering.
       *
       * We center the text block both horizontally and vertically
       * within the bounding box.
       */
      const lineHeight = fontSize * 1.3;
      const totalTextHeight = lines.length * lineHeight;

      /*
       * Vertical centering: start Y position so the text block
       * is centered in the bounding box.
       */
      const startY = box.y + (box.height - totalTextHeight) / 2;

      ctx.textAlign = 'center';

      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx];

        /*
         * Horizontal centering: draw at the horizontal center of the box.
         * With textAlign = 'center', the text is centered on the X coord.
         */
        const lineX = box.x + box.width / 2;
        const lineY = startY + lineIdx * lineHeight;

        ctx.fillText(line, lineX, lineY);
      }

      /* Reset textAlign for future operations */
      ctx.textAlign = 'start';
    }
    ctx.restore();

    /*
     * STEP 6: Draw confidence border.
     * A thin border around the bounding box colored by confidence level.
     * This gives the user a visual indicator of OCR reliability.
     */
    const borderColor = getConfidenceBorderColor(ocr.confidence);
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(box.x, box.y, box.width, box.height);

    /*
     * Store the scaled box coordinates as a data attribute on the canvas
     * for hover detection. We'll read these in setupHoverDetection().
     * Since we can't store complex data on canvas easily, we'll use
     * a different approach — see setupHoverDetection below.
     */
  }

  console.log(`[VisionTranslate Overlay] Rendered ${ocrResults.length} text blocks`);
}

/*
 * ==========================================================================
 * EXPORT: restoreOriginal()
 * ==========================================================================
 * Restores the overlay canvas to show the original image (clears all
 * translated text). The original image underneath is always intact — we
 * just need to make the canvas transparent again.
 *
 * @param {HTMLCanvasElement} canvas — The overlay canvas
 */
export function restoreOriginal(canvas) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const displayWidth = parseFloat(canvas.style.width);
  const displayHeight = parseFloat(canvas.style.height);

  /* Clear the entire canvas to fully transparent */
  ctx.clearRect(0, 0, displayWidth, displayHeight);
}

/*
 * ==========================================================================
 * EXPORT: setupHoverDetection()
 * ==========================================================================
 * Sets up mouse hover detection on the overlay canvas. When the user
 * hovers over a translated text block, a tooltip shows the original text.
 *
 * HOW IT WORKS:
 *   1. Listen for mousemove events on the canvas.
 *   2. For each mouse position, check if it falls within any text
 *      block's bounding box.
 *   3. If yes, show a tooltip with the original text near the cursor.
 *   4. If no, hide the tooltip.
 *
 * We create a single tooltip element (shared across all blocks) and
 * reposition it as the mouse moves.
 *
 * @param {HTMLCanvasElement} canvas — The overlay canvas
 * @param {Array} ocrResults — OCR results with bounding boxes
 * @param {string[]} translations — Translated text array
 */
export function setupHoverDetection(canvas, ocrResults, translations) {
  /*
   * Compute scale factors once (same logic as in renderTranslation).
   * We need these to compare mouse coordinates with OCR bounding boxes.
   */
  const displayWidth = parseFloat(canvas.style.width);
  const displayHeight = parseFloat(canvas.style.height);

  /*
   * Get the image dimensions. The canvas's parent wrapper should
   * contain the original image element.
   */
  const wrapper = canvas.parentElement;
  const image = wrapper?.querySelector('img, canvas:not([class])');

  /*
   * If we can't find the original image, we'll assume the display
   * dimensions equal the natural dimensions (scale = 1).
   */
  let scaleX = 1;
  let scaleY = 1;

  if (image) {
    const naturalWidth = image.naturalWidth || image.width;
    const naturalHeight = image.naturalHeight || image.height;
    if (naturalWidth && naturalHeight) {
      scaleX = displayWidth / naturalWidth;
      scaleY = displayHeight / naturalHeight;
    }
  }

  /*
   * Pre-compute scaled bounding boxes for hit testing.
   * We do this once instead of on every mouse move for performance.
   */
  const scaledBoxes = ocrResults.map((ocr, index) => ({
    x: ocr.bbox.x * scaleX,
    y: ocr.bbox.y * scaleY,
    width: ocr.bbox.width * scaleX,
    height: ocr.bbox.height * scaleY,
    originalText: ocr.text,
    translatedText: translations[index],
    confidence: ocr.confidence
  }));

  /*
   * Create the tooltip element. We append it to the wrapper div so
   * it's positioned relative to the image.
   */
  const tooltip = document.createElement('div');
  tooltip.className = 'vt-lensmu-tooltip';
  tooltip.style.cssText = `
    position: absolute;
    background: rgba(0, 0, 0, 0.85);
    color: #ffffff;
    padding: 6px 10px;
    border-radius: 4px;
    font-size: 12px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    pointer-events: none;
    z-index: 10;
    max-width: 250px;
    word-wrap: break-word;
    display: none;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    line-height: 1.4;
    white-space: pre-wrap;
  `;

  if (wrapper) {
    wrapper.appendChild(tooltip);
  }

  /*
   * Track the currently hovered box index to avoid redundant updates.
   */
  let lastHoveredIndex = -1;

  /*
   * mousemove handler: Detect which box (if any) the mouse is over.
   *
   * We get the mouse position relative to the canvas using
   * getBoundingClientRect(), which returns the canvas's position
   * in the viewport.
   */
  canvas.addEventListener('mousemove', (event) => {
    const rect = canvas.getBoundingClientRect();

    /*
     * Mouse position relative to the canvas (in CSS pixels).
     * event.clientX/Y is the mouse position in the viewport.
     * Subtracting rect.left/top gives position relative to the canvas.
     */
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    /*
     * Check each bounding box to see if the mouse is inside it.
     * We iterate in reverse order so that boxes drawn later (on top)
     * are checked first.
     */
    let hoveredIndex = -1;

    for (let i = scaledBoxes.length - 1; i >= 0; i--) {
      const box = scaledBoxes[i];

      if (
        mouseX >= box.x &&
        mouseX <= box.x + box.width &&
        mouseY >= box.y &&
        mouseY <= box.y + box.height
      ) {
        hoveredIndex = i;
        break;
      }
    }

    if (hoveredIndex !== lastHoveredIndex) {
      lastHoveredIndex = hoveredIndex;

      if (hoveredIndex >= 0) {
        const box = scaledBoxes[hoveredIndex];

        /*
         * Build tooltip content showing:
         *   - Original text
         *   - Confidence percentage
         */
        const confidencePercent = Math.round(box.confidence * 100);
        tooltip.textContent = `Original: ${box.originalText}\nConfidence: ${confidencePercent}%`;

        /*
         * Position the tooltip above the hovered box.
         * If the box is near the top of the canvas, put the tooltip
         * below instead.
         */
        let tooltipX = box.x;
        let tooltipY = box.y - 40; /* 40px above the box */

        if (tooltipY < 0) {
          tooltipY = box.y + box.height + 5; /* Below the box */
        }

        tooltip.style.left = `${tooltipX}px`;
        tooltip.style.top = `${tooltipY}px`;
        tooltip.style.display = 'block';
      } else {
        tooltip.style.display = 'none';
      }
    }
  });

  /*
   * mouseleave handler: Hide the tooltip when the mouse leaves the canvas.
   */
  canvas.addEventListener('mouseleave', () => {
    lastHoveredIndex = -1;
    tooltip.style.display = 'none';
  });
}
