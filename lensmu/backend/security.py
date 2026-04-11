# =============================================================================
# VisionTranslate — Security Middleware & Input Validation
# =============================================================================
#
# This module adds security hardening to the FastAPI backend:
#   - Request size limits (prevent memory exhaustion from oversized payloads)
#   - Rate limiting (prevent abuse of OCR endpoints)
#   - Security headers (basic HTTP security best practices)
#
# USAGE:
#   from security import add_security_middleware, validate_image_size
#
#   # In server.py, after creating the FastAPI app:
#   add_security_middleware(app)
#
#   # In endpoint functions, after decoding base64:
#   validate_image_size(image_bytes)
# =============================================================================

import time
import logging
from collections import defaultdict
from fastapi import FastAPI, HTTPException, Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger("visiontranslate.security")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Maximum allowed image size in bytes (10 MB).
# Most manga pages and screenshots are well under this limit.
# A 4K screenshot at max PNG quality is roughly 8 MB.
MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB

# Maximum allowed request body size in bytes (15 MB).
# Slightly larger than MAX_IMAGE_SIZE to account for JSON overhead and
# base64 encoding (~33% larger than raw bytes).
MAX_REQUEST_BODY_BYTES = 15 * 1024 * 1024  # 15 MB

# Rate limiting: maximum requests per window per IP.
RATE_LIMIT_MAX_REQUESTS = 60
RATE_LIMIT_WINDOW_SECONDS = 60


# ---------------------------------------------------------------------------
# Image Size Validation
# ---------------------------------------------------------------------------

def validate_image_size(image_bytes: bytes) -> None:
    """
    Check that the decoded image is within the allowed size limit.

    Call this AFTER decoding the base64 string but BEFORE passing the
    image to the OCR engine. This prevents a malicious or oversized
    payload from consuming excessive memory during OCR processing.

    Args:
        image_bytes: The raw decoded image bytes.

    Raises:
        HTTPException(413): If the image exceeds MAX_IMAGE_SIZE_BYTES.
    """
    if len(image_bytes) > MAX_IMAGE_SIZE_BYTES:
        size_mb = len(image_bytes) / (1024 * 1024)
        limit_mb = MAX_IMAGE_SIZE_BYTES / (1024 * 1024)
        raise HTTPException(
            status_code=413,
            detail=(
                f"Image too large: {size_mb:.1f} MB exceeds the "
                f"{limit_mb:.0f} MB limit. Try resizing the image or "
                "using a lower resolution screenshot."
            ),
        )


# ---------------------------------------------------------------------------
# Rate Limiting Middleware
# ---------------------------------------------------------------------------

class RateLimitMiddleware(BaseHTTPMiddleware):
    """
    Simple in-memory rate limiter using a sliding window per client IP.

    This is sufficient for a local-only server. For a production deployment,
    use a proper rate limiter backed by Redis or similar.

    How it works:
      - Each IP gets a list of request timestamps.
      - On each request, timestamps older than the window are pruned.
      - If the remaining count exceeds the limit, return 429 Too Many Requests.
    """

    def __init__(self, app: FastAPI, max_requests: int = RATE_LIMIT_MAX_REQUESTS,
                 window_seconds: int = RATE_LIMIT_WINDOW_SECONDS):
        super().__init__(app)
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.requests: dict[str, list[float]] = defaultdict(list)

    async def dispatch(self, request: Request, call_next) -> Response:
        # Skip rate limiting for health checks
        if request.url.path == "/health":
            return await call_next(request)

        client_ip = request.client.host if request.client else "unknown"
        now = time.time()
        cutoff = now - self.window_seconds

        # Prune old timestamps
        self.requests[client_ip] = [
            t for t in self.requests[client_ip] if t > cutoff
        ]

        if len(self.requests[client_ip]) >= self.max_requests:
            logger.warning(
                f"Rate limit exceeded for {client_ip}: "
                f"{len(self.requests[client_ip])} requests in "
                f"{self.window_seconds}s window"
            )
            return Response(
                content=(
                    '{"detail": "Too many requests. Please wait before '
                    'sending more images for OCR processing."}'
                ),
                status_code=429,
                media_type="application/json",
                headers={"Retry-After": str(self.window_seconds)},
            )

        self.requests[client_ip].append(now)
        return await call_next(request)


# ---------------------------------------------------------------------------
# Security Headers Middleware
# ---------------------------------------------------------------------------

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """
    Add basic security headers to all responses.

    These headers protect against common web vulnerabilities like
    clickjacking, MIME sniffing, and XSS. While this is a local server,
    adding these headers is good practice and prevents issues if the
    server is ever exposed to a network.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        return response


# ---------------------------------------------------------------------------
# Convenience function to add all security middleware at once
# ---------------------------------------------------------------------------

def add_security_middleware(app: FastAPI) -> None:
    """
    Add all security middleware to the FastAPI app.

    Call this in server.py after creating the app and BEFORE adding
    CORS middleware (order matters — middleware runs in reverse order
    of registration).

    Usage:
        from security import add_security_middleware
        app = FastAPI(...)
        add_security_middleware(app)
        app.add_middleware(CORSMiddleware, ...)
    """
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RateLimitMiddleware)
    logger.info(
        f"Security middleware enabled: rate limit={RATE_LIMIT_MAX_REQUESTS} "
        f"req/{RATE_LIMIT_WINDOW_SECONDS}s, max image={MAX_IMAGE_SIZE_BYTES // (1024*1024)} MB"
    )
