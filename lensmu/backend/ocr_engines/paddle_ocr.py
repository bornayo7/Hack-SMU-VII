# =============================================================================
# PaddleOCR Wrapper for VisionTranslate
# =============================================================================
#
# PaddleOCR is a general-purpose OCR toolkit that can:
#   - Detect text regions in an image (text detection)
#   - Recognize the text inside each detected region (text recognition)
#   - Classify text direction (0 or 180 degrees)
#
# WHY WE USE IT:
#   PaddleOCR is the "first pass" in our pipeline. It finds WHERE text is on
#   the page and draws bounding boxes around each text region. It also gives
#   us a rough text recognition, but for Japanese manga text, MangaOCR
#   (see manga_ocr.py) is much more accurate.
#
# WHAT PaddleOCR.ocr() RETURNS:
#   The raw output is a list of lists. Each inner list represents one page
#   (we always send single images, so we use result[0]). Each element in the
#   inner list is a tuple of:
#     (
#       [[x1,y1], [x2,y2], [x3,y3], [x4,y4]],  # 4-corner polygon
#       ("recognized text", confidence_score)      # text + confidence
#     )
#
#   The 4 corners are in order: top-left, top-right, bottom-right, bottom-left.
#   We convert these to a simpler [x_min, y_min, x_max, y_max] bounding box
#   format that the browser extension can use directly for positioning overlays.
#
# SINGLETON PATTERN:
#   The PaddleOCR model is ~100 MB and takes several seconds to initialize.
#   We use a singleton so it is only loaded once, even if multiple requests
#   come in simultaneously. The first request triggers the load; subsequent
#   requests reuse the same instance.
# =============================================================================

import io
import logging
import threading
from typing import Optional

import numpy as np
from PIL import Image
from paddleocr import PaddleOCR

logger = logging.getLogger(__name__)


class PaddleOCREngine:
    """
    Singleton wrapper around PaddleOCR.

    Usage:
        engine = PaddleOCREngine.get_instance()
        results = engine.process_image(raw_image_bytes)
        # results is a list of dicts:
        # [
        #   {
        #     "text": "detected text string",
        #     "bbox": [x1, y1, x2, y2],
        #     "confidence": 0.95,
        #     "orientation": "horizontal"   # or "vertical"
        #   },
        #   ...
        # ]
    """

    # --- Singleton machinery ---------------------------------------------------
    # _instance holds the single PaddleOCREngine object.
    # _lock prevents two threads from creating the instance simultaneously
    # (this can happen if two HTTP requests arrive at the same time before
    # the model is loaded).
    _instance: Optional["PaddleOCREngine"] = None
    _lock: threading.Lock = threading.Lock()

    def __init__(self) -> None:
        """
        Initialize PaddleOCR with settings optimized for manga/comic text.

        Key parameters explained:
          - use_angle_cls=True : Enable the text direction classifier so we can
            detect text rotated 180 degrees (upside-down text in manga panels).
          - lang="japan"       : Use the Japanese recognition model. PaddleOCR
            supports 80+ languages; change this if you need other languages.
            Common values: "en" (English), "ch" (Chinese), "korean", "japan".
          - use_gpu=False      : Run on CPU. Set to True if you have a GPU with
            PaddlePaddle-GPU installed -- inference will be ~10x faster.
          - det_db_thresh=0.3  : Lower detection threshold to catch faint or
            small text (default is 0.3). Decrease for more sensitivity.
          - det_db_unclip_ratio=1.8 : How much to expand detected text regions.
            Higher values give larger bounding boxes that fully contain the text.
            Useful for manga where text can be close to bubble edges.
          - show_log=False     : Suppress PaddleOCR's verbose startup logs.
        """
        logger.info("Initializing PaddleOCR engine (this may take a few seconds)...")
        self._ocr = PaddleOCR(
            use_angle_cls=True,       # detect text orientation (0 vs 180 degrees)
            lang="japan",             # Japanese recognition model
            use_gpu=False,            # CPU mode (change to True for GPU)
            det_db_thresh=0.3,        # detection confidence threshold
            det_db_unclip_ratio=1.8,  # expand detected regions slightly
            show_log=False,           # suppress noisy startup logs
        )
        logger.info("PaddleOCR engine initialized successfully.")

    @classmethod
    def get_instance(cls) -> "PaddleOCREngine":
        """
        Return the singleton PaddleOCREngine instance, creating it on first call.

        Thread-safe: uses a lock so that if two requests arrive simultaneously
        before the model is loaded, only one will create the instance.
        """
        if cls._instance is None:
            with cls._lock:
                # Double-check inside the lock (another thread may have created
                # the instance while we were waiting for the lock).
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    def process_image(self, image_bytes: bytes) -> list[dict]:
        """
        Run OCR on a raw image and return structured results.

        Args:
            image_bytes: Raw image file bytes (PNG, JPEG, WebP, etc.)
                         This is the decoded content of the image file, NOT
                         a base64 string. The server.py layer handles base64
                         decoding before calling this method.

        Returns:
            A list of dictionaries, one per detected text region:
            [
                {
                    "text": "recognized text",
                    "bbox": [x1, y1, x2, y2],    # top-left and bottom-right corners
                    "confidence": 0.95,            # 0.0 to 1.0
                    "orientation": "horizontal"    # or "vertical"
                },
                ...
            ]

            The list is ordered top-to-bottom, left-to-right (reading order).
            If no text is detected, an empty list is returned.
        """
        # --- Step 1: Decode the image bytes into a numpy array ----------------
        # PaddleOCR expects a numpy array in BGR format (like OpenCV) or a
        # file path. We convert from PIL (which loads as RGB) to a numpy array.
        # PaddleOCR internally handles the RGB -> BGR conversion.
        try:
            pil_image = Image.open(io.BytesIO(image_bytes))
            # Convert to RGB in case the image is RGBA (PNG with transparency),
            # grayscale, or palette mode. PaddleOCR works best with RGB.
            pil_image = pil_image.convert("RGB")
            image_array = np.array(pil_image)
        except Exception as e:
            logger.error(f"Failed to decode image: {e}")
            raise ValueError(f"Could not decode image: {e}")

        # --- Step 2: Run PaddleOCR --------------------------------------------
        # The ocr() method returns a list of pages. Since we send a single
        # image (not a PDF), we get a list with one element: result[0].
        # Each element in result[0] is:
        #   ( [[x1,y1],[x2,y2],[x3,y3],[x4,y4]], ("text", confidence) )
        # where the 4 points are the corners of a quadrilateral (polygon)
        # bounding the detected text. The points are in order:
        #   top-left, top-right, bottom-right, bottom-left.
        result = self._ocr.ocr(image_array, cls=True)

        # --- Step 3: Handle empty results -------------------------------------
        # PaddleOCR returns [None] or [[]] when no text is detected.
        if result is None or len(result) == 0:
            return []

        page_result = result[0]  # first (and only) page
        if page_result is None or len(page_result) == 0:
            return []

        # --- Step 4: Transform raw results into our API format ----------------
        detections = []
        for detection in page_result:
            # Unpack the PaddleOCR detection tuple.
            polygon = detection[0]     # [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]
            text_info = detection[1]   # ("recognized text", confidence_float)

            text = text_info[0]
            confidence = float(text_info[1])

            # Convert the 4-corner polygon to a simple axis-aligned bounding
            # box: [x_min, y_min, x_max, y_max].
            # This is easier for the browser extension to use when positioning
            # overlay elements on the page.
            bbox = self._polygon_to_bbox(polygon)

            # Determine whether the text is horizontal or vertical.
            # This is useful for the extension to know how to render the
            # translated text overlay (vertical text needs different CSS).
            orientation = self._detect_orientation(polygon)

            detections.append({
                "text": text,
                "bbox": bbox,
                "confidence": round(confidence, 4),
                "orientation": orientation,
            })

        # --- Step 5: Sort by reading order ------------------------------------
        # Sort by vertical position first (top to bottom), then by horizontal
        # position (left to right). This gives a natural reading order for
        # most layouts. For pure vertical Japanese text (right to left), the
        # extension can re-sort on the frontend.
        detections.sort(key=lambda d: (d["bbox"][1], d["bbox"][0]))

        return detections

    @staticmethod
    def _polygon_to_bbox(polygon: list[list[float]]) -> list[int]:
        """
        Convert a 4-corner polygon to an axis-aligned bounding box.

        PaddleOCR gives us 4 corner points of a quadrilateral:
            [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]
        in order: top-left, top-right, bottom-right, bottom-left.

        We compute the tightest axis-aligned rectangle that contains all
        4 points. This handles rotated text regions correctly.

        Returns:
            [x_min, y_min, x_max, y_max] as integers (pixel coordinates).
        """
        # Extract all x and y coordinates from the 4 corners.
        x_coords = [point[0] for point in polygon]
        y_coords = [point[1] for point in polygon]

        return [
            int(min(x_coords)),   # x_min (left edge)
            int(min(y_coords)),   # y_min (top edge)
            int(max(x_coords)),   # x_max (right edge)
            int(max(y_coords)),   # y_max (bottom edge)
        ]

    @staticmethod
    def _detect_orientation(polygon: list[list[float]]) -> str:
        """
        Determine whether a detected text region is horizontal or vertical.

        We compare the width and height of the bounding polygon:
          - If width >= height, the text runs horizontally (left to right).
          - If height > width, the text runs vertically (top to bottom).

        This is a simple heuristic that works well for manga/comic text,
        where vertical text is written in tall, narrow columns inside
        speech bubbles.

        Args:
            polygon: 4-corner polygon from PaddleOCR.
                     [[top-left], [top-right], [bottom-right], [bottom-left]]

        Returns:
            "horizontal" or "vertical"
        """
        # Calculate width: distance between top-left and top-right corners.
        # We use Euclidean distance to handle slightly rotated text.
        top_left = polygon[0]
        top_right = polygon[1]
        bottom_left = polygon[3]

        width = ((top_right[0] - top_left[0]) ** 2 +
                 (top_right[1] - top_left[1]) ** 2) ** 0.5

        # Calculate height: distance between top-left and bottom-left corners.
        height = ((bottom_left[0] - top_left[0]) ** 2 +
                  (bottom_left[1] - top_left[1]) ** 2) ** 0.5

        return "vertical" if height > width else "horizontal"
