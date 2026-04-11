# =============================================================================
# VisionTranslate (lensmu) Backend Server
# =============================================================================
#
# This is the FastAPI server that the VisionTranslate browser extension talks
# to. It exposes OCR capabilities via HTTP endpoints so the extension can send
# screenshots and get back recognized text.
#
# ARCHITECTURE OVERVIEW:
#   Browser Extension (JavaScript)
#       |
#       |  HTTP POST with base64-encoded image
#       v
#   This FastAPI Server (Python)
#       |
#       |--- /ocr/paddle  --> PaddleOCR (detect text regions + rough OCR)
#       |--- /ocr/manga   --> MangaOCR  (accurate Japanese text recognition)
#       |--- /health       --> Health check
#       |
#       v
#   JSON response back to extension
#
# WHY A LOCAL SERVER?
#   Browser extensions run JavaScript and cannot directly use Python ML models.
#   This server runs locally on the user's machine (localhost:8000) and the
#   extension sends requests to it. No data leaves the user's computer.
#
# CORS (Cross-Origin Resource Sharing):
#   Browser extensions make requests from origins like:
#     - chrome-extension://<extension-id>
#     - moz-extension://<extension-id>
#     - http://localhost (for development)
#   Without CORS headers, the browser blocks these requests. We configure
#   FastAPI's CORSMiddleware to allow these origins.
#
# HOW TO RUN:
#   cd lensmu/backend
#   pip install -r requirements.txt
#   python server.py
#   # Server starts at http://localhost:8000
#   # Interactive API docs at http://localhost:8000/docs
# =============================================================================

import base64
import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from security import add_security_middleware, validate_image_size

# ---------------------------------------------------------------------------
# Import OCR engine wrappers with graceful fallback.
#
# PaddlePaddle and manga-ocr are heavy dependencies that may not be installed
# (especially on newer Python versions like 3.13+ where wheels don't exist).
# The server should still START without them — the /health endpoint tells the
# extension which engines are available, and the OCR endpoints return clear
# error messages if the engine isn't installed.
# ---------------------------------------------------------------------------

try:
    from ocr_engines.paddle_ocr import PaddleOCREngine
    PADDLE_AVAILABLE = True
except ImportError as e:
    PADDLE_AVAILABLE = False
    PaddleOCREngine = None  # type: ignore
    logging.getLogger("visiontranslate").warning(
        f"PaddleOCR not available: {e}. "
        "Install with: pip install paddlepaddle paddleocr  "
        "(see requirements-ocr.txt for platform-specific instructions)"
    )

try:
    from ocr_engines.manga_ocr import MangaOCREngine
    MANGA_AVAILABLE = True
except ImportError as e:
    MANGA_AVAILABLE = False
    MangaOCREngine = None  # type: ignore
    logging.getLogger("visiontranslate").warning(
        f"MangaOCR not available: {e}. "
        "Install with: pip install manga-ocr"
    )

# --- Logging setup ------------------------------------------------------------
# Configure logging so we can see what is happening in the terminal.
# This is especially useful during development to see when models are loading
# and how long requests take.
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("visiontranslate")


# =============================================================================
# Pydantic Models (Request & Response Schemas)
# =============================================================================
# These classes define the exact shape of JSON data that the API accepts and
# returns. FastAPI uses them for:
#   1. Automatic request validation (reject malformed requests with clear errors)
#   2. Automatic API documentation (visible at /docs)
#   3. Type hints for IDE autocompletion
#
# IMPORTANT FOR EXTENSION DEVELOPERS:
#   When sending requests from JavaScript, make sure your JSON body matches
#   these schemas exactly. FastAPI will return a 422 error with details if
#   the request body does not match.
# =============================================================================


class PaddleOCRRequest(BaseModel):
    """
    Request body for the /ocr/paddle endpoint.

    The browser extension should send a JSON body like:
    {
        "image": "<base64-encoded image data>"
    }

    How to create the base64 string in JavaScript:
        // From a canvas element:
        const base64 = canvas.toDataURL("image/png").split(",")[1];

        // From a Blob/File:
        const reader = new FileReader();
        reader.onload = () => {
            const base64 = reader.result.split(",")[1];
        };
        reader.readAsDataURL(blob);
    """
    image: str = Field(
        ...,  # "..." means this field is required
        description=(
            "Base64-encoded image data (PNG, JPEG, or WebP). "
            "Do NOT include the 'data:image/png;base64,' prefix -- "
            "send only the raw base64 string."
        ),
    )


class PaddleOCRDetection(BaseModel):
    """
    A single text detection result from PaddleOCR.

    This represents one piece of text found in the image, along with its
    position (bounding box), confidence score, and text orientation.
    """
    text: str = Field(
        ...,
        description="The recognized text string.",
    )
    bbox: list[int] = Field(
        ...,
        description=(
            "Bounding box as [x1, y1, x2, y2] in pixel coordinates. "
            "(x1, y1) is the top-left corner, (x2, y2) is the bottom-right."
        ),
    )
    confidence: float = Field(
        ...,
        description="Recognition confidence from 0.0 to 1.0.",
    )
    orientation: str = Field(
        ...,
        description='Text orientation: "horizontal" or "vertical".',
    )


class PaddleOCRResponse(BaseModel):
    """
    Response body from the /ocr/paddle endpoint.

    Example response:
    {
        "detections": [
            {
                "text": "こんにちは",
                "bbox": [100, 50, 300, 90],
                "confidence": 0.95,
                "orientation": "horizontal"
            },
            {
                "text": "世界",
                "bbox": [150, 100, 200, 250],
                "confidence": 0.88,
                "orientation": "vertical"
            }
        ],
        "count": 2,
        "processing_time_ms": 245.3
    }
    """
    detections: list[PaddleOCRDetection] = Field(
        ...,
        description="List of detected text regions with recognized text.",
    )
    count: int = Field(
        ...,
        description="Total number of text regions detected.",
    )
    processing_time_ms: float = Field(
        ...,
        description="Time taken to process the image, in milliseconds.",
    )


class MangaOCRRequest(BaseModel):
    """
    Request body for the /ocr/manga endpoint.

    The extension sends the same full image that was sent to /ocr/paddle,
    along with the bounding boxes that PaddleOCR detected. This endpoint
    crops each bounding box region and runs MangaOCR for more accurate
    Japanese text recognition.

    Example request:
    {
        "image": "<base64-encoded image data>",
        "bboxes": [
            [100, 50, 300, 90],
            [150, 100, 200, 250]
        ]
    }
    """
    image: str = Field(
        ...,
        description=(
            "Base64-encoded image data (same image that was sent to /ocr/paddle). "
            "Do NOT include the 'data:image/png;base64,' prefix."
        ),
    )
    bboxes: list[list[int]] = Field(
        ...,
        description=(
            "List of bounding boxes from PaddleOCR, each as [x1, y1, x2, y2]. "
            "These define the regions to crop and run MangaOCR on."
        ),
    )


class MangaOCRDetection(BaseModel):
    """A single text recognition result from MangaOCR."""
    text: str = Field(
        ...,
        description="The recognized Japanese text string.",
    )
    bbox: list[int] = Field(
        ...,
        description="The bounding box [x1, y1, x2, y2] this text came from.",
    )


class MangaOCRResponse(BaseModel):
    """
    Response body from the /ocr/manga endpoint.

    Example response:
    {
        "detections": [
            {
                "text": "こんにちは",
                "bbox": [100, 50, 300, 90]
            },
            {
                "text": "世界",
                "bbox": [150, 100, 200, 250]
            }
        ],
        "count": 2,
        "processing_time_ms": 523.1
    }
    """
    detections: list[MangaOCRDetection] = Field(
        ...,
        description="List of recognized text for each input bounding box.",
    )
    count: int = Field(
        ...,
        description="Total number of regions processed.",
    )
    processing_time_ms: float = Field(
        ...,
        description="Time taken to process all regions, in milliseconds.",
    )


class HealthResponse(BaseModel):
    """Response body from the /health endpoint."""
    status: str = Field(
        ...,
        description='Server status. Always "ok" if the server is running.',
    )
    paddle_ocr_available: bool = Field(
        ...,
        description="Whether PaddleOCR is installed and can be used.",
    )
    paddle_ocr_loaded: bool = Field(
        ...,
        description="Whether the PaddleOCR model is currently loaded in memory.",
    )
    manga_ocr_available: bool = Field(
        ...,
        description="Whether MangaOCR is installed and can be used.",
    )
    manga_ocr_loaded: bool = Field(
        ...,
        description="Whether the MangaOCR model is currently loaded in memory.",
    )


# =============================================================================
# Application Lifespan
# =============================================================================
# The lifespan context manager runs code at server startup and shutdown.
# We use it to log startup information. We do NOT pre-load the OCR models
# here because they are heavy (takes 5-30 seconds). Instead, models are
# lazy-loaded on the first request to each endpoint. This means the server
# starts quickly, and the user only waits for model loading when they
# actually use a feature.
# =============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan handler.

    Code before 'yield' runs at startup.
    Code after 'yield' runs at shutdown.
    """
    logger.info("=" * 60)
    logger.info("VisionTranslate backend starting up")
    logger.info("API docs available at http://localhost:8000/docs")
    logger.info(
        "PaddleOCR: %s", "AVAILABLE" if PADDLE_AVAILABLE else "NOT INSTALLED"
    )
    logger.info(
        "MangaOCR:  %s", "AVAILABLE" if MANGA_AVAILABLE else "NOT INSTALLED"
    )
    if PADDLE_AVAILABLE or MANGA_AVAILABLE:
        logger.info(
            "OCR models will be loaded on first request (lazy loading)"
        )
    else:
        logger.warning(
            "No OCR engines installed! The server will still run but "
            "OCR endpoints will return 501 errors. Install OCR deps with: "
            "pip install -r requirements-ocr.txt"
        )
    logger.info("=" * 60)
    yield
    logger.info("VisionTranslate backend shutting down")


# =============================================================================
# FastAPI App Configuration
# =============================================================================

app = FastAPI(
    title="VisionTranslate OCR Backend",
    description=(
        "Local OCR server for the VisionTranslate browser extension. "
        "Provides text detection (PaddleOCR) and Japanese manga text "
        "recognition (MangaOCR) via REST API endpoints."
    ),
    version="1.0.0",
    lifespan=lifespan,
)


# --- Security Middleware -------------------------------------------------------
# Rate limiting, request size validation, and security headers.
# Must be added BEFORE CORS middleware (middleware runs in reverse order).
# ---------------------------------------------------------------------------

add_security_middleware(app)


# --- CORS Middleware ----------------------------------------------------------
# CORS (Cross-Origin Resource Sharing) is a browser security feature that
# blocks web pages from making requests to a different origin (domain/port)
# than the one that served the page.
#
# Browser extensions need to talk to our localhost server, but the browser
# treats extension pages as a different origin. Without CORS headers, the
# browser silently blocks the request and the extension gets a network error.
#
# We allow:
#   - http://localhost:*    -- for local development and testing
#   - chrome-extension://* -- for Chrome/Edge/Brave extensions
#   - moz-extension://*    -- for Firefox extensions
#
# allow_methods=["*"] lets the extension use GET, POST, OPTIONS, etc.
# allow_headers=["*"] lets the extension send Content-Type and other headers.
# ---------------------------------------------------------------------------

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost",           # local dev (no port)
        "http://localhost:3000",      # common React dev port
        "http://localhost:5173",      # common Vite dev port
        "http://localhost:8080",      # common alt dev port
        "http://127.0.0.1",          # localhost alias
    ],
    # allow_origin_regex lets us match dynamic extension origins.
    # Chrome extensions have origins like: chrome-extension://abcdef123456
    # Firefox extensions have origins like: moz-extension://abcdef-1234-5678
    allow_origin_regex=r"^(chrome-extension|moz-extension)://.*$",
    allow_credentials=True,   # allow cookies (not used, but doesn't hurt)
    allow_methods=["*"],      # allow all HTTP methods
    allow_headers=["*"],      # allow all headers (especially Content-Type)
)


# =============================================================================
# Helper Functions
# =============================================================================

def decode_base64_image(base64_string: str) -> bytes:
    """
    Decode a base64 string into raw image bytes.

    The browser extension sends images as base64 strings in the JSON body.
    This function converts that back to raw bytes that PIL/OCR can read.

    Handles two formats:
      1. Raw base64: "iVBORw0KGgoAAAANS..."
      2. Data URL:   "data:image/png;base64,iVBORw0KGgoAAAANS..."
         (we strip the prefix if present)

    Args:
        base64_string: The base64-encoded image string.

    Returns:
        Raw image bytes.

    Raises:
        HTTPException(400): If the base64 string is invalid.
    """
    # Strip the data URL prefix if the extension accidentally includes it.
    # JavaScript's canvas.toDataURL() returns "data:image/png;base64,..."
    # but we only want the part after the comma.
    if "," in base64_string:
        base64_string = base64_string.split(",", 1)[1]

    try:
        return base64.b64decode(base64_string)
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Invalid base64 image data: {e}. "
                "Make sure you are sending only the base64 string, "
                "not the full data URL. If using canvas.toDataURL(), "
                "split on ',' and send only the second part."
            ),
        )


# =============================================================================
# API Endpoints
# =============================================================================


@app.get(
    "/health",
    response_model=HealthResponse,
    summary="Health check",
    description=(
        "Check if the server is running and which OCR models are loaded. "
        "Use this from the extension to verify the backend is available "
        "before attempting OCR requests."
    ),
)
async def health_check() -> HealthResponse:
    """
    Health check endpoint.

    Returns the server status and whether each OCR model is loaded.
    Models are lazy-loaded, so they may not be in memory until the first
    request to their respective endpoints.

    This endpoint is lightweight and does not load any models.
    """
    return HealthResponse(
        status="ok",
        paddle_ocr_available=PADDLE_AVAILABLE,
        paddle_ocr_loaded=PADDLE_AVAILABLE and PaddleOCREngine._instance is not None,
        manga_ocr_available=MANGA_AVAILABLE,
        manga_ocr_loaded=MANGA_AVAILABLE and MangaOCREngine._instance is not None,
    )


@app.post(
    "/ocr/paddle",
    response_model=PaddleOCRResponse,
    summary="Detect and recognize text using PaddleOCR",
    description=(
        "Send a base64-encoded image and receive detected text regions with "
        "bounding boxes, recognized text, confidence scores, and text "
        "orientation. This is the 'first pass' that finds where text is."
    ),
)
async def paddle_ocr(request: PaddleOCRRequest) -> PaddleOCRResponse:
    """
    PaddleOCR endpoint: detect text regions and recognize text.

    WHAT THIS DOES:
      1. Decodes the base64 image from the request.
      2. Runs PaddleOCR to detect all text regions in the image.
      3. For each region, extracts the bounding box, recognized text,
         confidence score, and text orientation.
      4. Returns everything in a structured JSON response.

    WHEN TO USE THIS:
      Use this as the first step when the user screenshots a manga page.
      The response gives you bounding boxes that you can then send to
      /ocr/manga for more accurate Japanese text recognition.

    LAZY LOADING:
      The PaddleOCR model is loaded on the first call to this endpoint.
      First request takes 5-15 seconds (model loading + inference).
      Subsequent requests take 0.2-2 seconds (inference only).
    """
    # Guard: check if PaddleOCR is installed at all.
    if not PADDLE_AVAILABLE:
        raise HTTPException(
            status_code=501,
            detail=(
                "PaddleOCR is not installed. This usually means your Python "
                "version is too new (PaddlePaddle supports 3.8–3.12) or "
                "you haven't installed the OCR dependencies yet. "
                "See requirements-ocr.txt for install instructions. "
                "In the meantime, use Tesseract.js (in-browser) or "
                "Google Cloud Vision from the extension settings."
            ),
        )

    start_time = time.time()

    # Step 1: Decode the base64 image.
    image_bytes = decode_base64_image(request.image)

    # Step 1b: Validate image size (reject oversized payloads).
    validate_image_size(image_bytes)

    # Step 2: Get or create the PaddleOCR engine (lazy-loaded singleton).
    # On the first request, this triggers model download and initialization.
    try:
        engine = PaddleOCREngine.get_instance()
    except Exception as e:
        logger.error(f"Failed to initialize PaddleOCR: {e}")
        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to initialize PaddleOCR engine: {e}. "
                "Check that paddleocr and paddlepaddle are installed correctly."
            ),
        )

    # Step 3: Run OCR on the image.
    try:
        detections = engine.process_image(image_bytes)
    except ValueError as e:
        # ValueError is raised by our engine for invalid images.
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"PaddleOCR processing failed: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"OCR processing failed: {e}",
        )

    # Step 4: Calculate processing time and return response.
    elapsed_ms = (time.time() - start_time) * 1000

    logger.info(
        f"PaddleOCR: detected {len(detections)} text regions "
        f"in {elapsed_ms:.1f}ms"
    )

    return PaddleOCRResponse(
        detections=[PaddleOCRDetection(**d) for d in detections],
        count=len(detections),
        processing_time_ms=round(elapsed_ms, 1),
    )


@app.post(
    "/ocr/manga",
    response_model=MangaOCRResponse,
    summary="Recognize Japanese manga text using MangaOCR",
    description=(
        "Send a base64-encoded image and a list of bounding boxes (from "
        "PaddleOCR). Each bounding box region is cropped and processed by "
        "MangaOCR, which is specialized for Japanese manga text."
    ),
)
async def manga_ocr(request: MangaOCRRequest) -> MangaOCRResponse:
    """
    MangaOCR endpoint: accurate Japanese text recognition.

    WHAT THIS DOES:
      1. Decodes the base64 image from the request.
      2. For each bounding box, crops that region from the image.
      3. Runs MangaOCR on each cropped region to get accurate Japanese text.
      4. Returns the recognized text paired with its bounding box.

    TYPICAL WORKFLOW:
      1. Extension sends screenshot to /ocr/paddle.
      2. /ocr/paddle returns bounding boxes + rough text.
      3. Extension sends the SAME screenshot + bounding boxes to /ocr/manga.
      4. /ocr/manga returns accurate Japanese text for each region.
      5. Extension uses the text for translation + overlay.

    WHY TWO STEPS?
      PaddleOCR is good at FINDING text but mediocre at READING Japanese.
      MangaOCR is excellent at READING Japanese but cannot FIND text.
      Together they form a complete pipeline.

    LAZY LOADING:
      The MangaOCR model is loaded on the first call to this endpoint.
      First request takes 10-30 seconds (model download + loading).
      Subsequent requests take 0.5-3 seconds depending on number of regions.
    """
    # Guard: check if MangaOCR is installed at all.
    if not MANGA_AVAILABLE:
        raise HTTPException(
            status_code=501,
            detail=(
                "MangaOCR is not installed. This usually means your Python "
                "version is too new (manga-ocr requires 3.8–3.12 + PyTorch) "
                "or you haven't installed the OCR dependencies yet. "
                "See requirements-ocr.txt for install instructions. "
                "In the meantime, use PaddleOCR, Tesseract.js (in-browser), "
                "or Google Cloud Vision from the extension settings."
            ),
        )

    start_time = time.time()

    # Validate that bounding boxes were provided.
    if not request.bboxes:
        raise HTTPException(
            status_code=400,
            detail=(
                "No bounding boxes provided. Send bounding boxes from "
                "the /ocr/paddle response in the 'bboxes' field."
            ),
        )

    # Step 1: Decode the base64 image.
    image_bytes = decode_base64_image(request.image)

    # Step 1b: Validate image size (reject oversized payloads).
    validate_image_size(image_bytes)

    # Step 2: Get or create the MangaOCR engine (lazy-loaded singleton).
    try:
        engine = MangaOCREngine.get_instance()
    except Exception as e:
        logger.error(f"Failed to initialize MangaOCR: {e}")
        raise HTTPException(
            status_code=500,
            detail=(
                f"Failed to initialize MangaOCR engine: {e}. "
                "Check that manga-ocr is installed correctly. "
                "First run requires internet to download the model (~400 MB)."
            ),
        )

    # Step 3: Process each bounding box region.
    try:
        detections = engine.process_regions(image_bytes, request.bboxes)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"MangaOCR processing failed: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"MangaOCR processing failed: {e}",
        )

    # Step 4: Calculate processing time and return response.
    elapsed_ms = (time.time() - start_time) * 1000

    logger.info(
        f"MangaOCR: processed {len(detections)} regions "
        f"in {elapsed_ms:.1f}ms"
    )

    return MangaOCRResponse(
        detections=[MangaOCRDetection(**d) for d in detections],
        count=len(detections),
        processing_time_ms=round(elapsed_ms, 1),
    )


# =============================================================================
# Entry Point
# =============================================================================
# This block runs when you execute: python server.py
# It starts the uvicorn ASGI server on localhost:8000.
#
# Alternatively, you can run the server directly with uvicorn:
#   uvicorn server:app --host 0.0.0.0 --port 8000 --reload
#
# The --reload flag enables auto-restart when you edit code (useful during
# development, but do NOT use in production).
# =============================================================================

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "server:app",  # module:variable format so uvicorn can find the app
        host="0.0.0.0",  # listen on all interfaces (accessible from localhost)
        port=8000,        # port number (the extension should use this port)
        reload=False,     # set to True during development for auto-restart
        log_level="info", # show info-level logs in the terminal
    )
