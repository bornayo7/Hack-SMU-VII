#!/bin/bash
# =============================================================================
# VisionTranslate — One-Command Setup (macOS / Linux)
# =============================================================================
# Run this after cloning or pulling the repo:
#   chmod +x setup.sh
#   ./setup.sh
#
# What it does:
#   1. Checks for Python 3.12 — gives install instructions if missing
#   2. Creates a virtual environment with Python 3.12
#   3. Installs backend dependencies (FastAPI, PaddleOCR, MangaOCR)
#   4. Installs extension dependencies (npm)
#   5. Builds the extension
# =============================================================================

set -e

echo ""
echo "========================================"
echo "  VisionTranslate (LenSMU) Setup"
echo "========================================"
echo ""

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/lensmu/backend"
EXTENSION_DIR="$SCRIPT_DIR/lensmu/extension"

# ---------------------------------------------------------------------------
# Step 1: Find Python 3.12
# ---------------------------------------------------------------------------
echo "[1/5] Checking for Python 3.12..."

PYTHON312=""
for cmd in python3.12 python3; do
    if command -v "$cmd" &>/dev/null; then
        version=$($cmd --version 2>&1)
        if [[ "$version" == *"3.12"* ]]; then
            PYTHON312="$cmd"
            echo "  Found: $version"
            break
        fi
    fi
done

if [ -z "$PYTHON312" ]; then
    echo "  Python 3.12 not found."
    echo ""
    echo "  Install it:"
    echo "    macOS:  brew install python@3.12"
    echo "    Ubuntu: sudo apt install python3.12 python3.12-venv"
    echo "    Other:  https://www.python.org/downloads/release/python-3129/"
    echo ""
    exit 1
fi

# ---------------------------------------------------------------------------
# Step 2: Create backend virtual environment
# ---------------------------------------------------------------------------
echo ""
echo "[2/5] Setting up backend virtual environment..."

if [ ! -d "$BACKEND_DIR/venv" ]; then
    echo "  Creating venv with Python 3.12..."
    $PYTHON312 -m venv "$BACKEND_DIR/venv"
    echo "  Virtual environment created."
else
    echo "  Virtual environment already exists. Skipping."
fi

source "$BACKEND_DIR/venv/bin/activate"

# ---------------------------------------------------------------------------
# Step 3: Install backend dependencies
# ---------------------------------------------------------------------------
echo ""
echo "[3/5] Installing backend dependencies..."

pip install -r "$BACKEND_DIR/requirements.txt" --quiet

echo "  Installing PaddlePaddle (this may take a few minutes)..."
# Detect platform for PaddlePaddle install
if [[ "$(uname -m)" == "arm64" ]] && [[ "$(uname)" == "Darwin" ]]; then
    pip install paddlepaddle==2.6.2 -f https://www.paddlepaddle.org.cn/whl/mac/cpu/paddlepaddle.html --quiet
else
    pip install paddlepaddle==2.6.2 --quiet
fi

echo "  Installing PaddleOCR..."
pip install "paddleocr>=2.7.0" --quiet

echo "  Installing MangaOCR..."
pip install "manga-ocr>=0.1.8" --quiet

echo "  Backend dependencies installed."

# ---------------------------------------------------------------------------
# Step 4: Check for Node.js and build extension
# ---------------------------------------------------------------------------
echo ""
echo "[4/5] Checking for Node.js..."

if ! command -v node &>/dev/null; then
    echo "  ERROR: Node.js not found."
    echo "  Install it from: https://nodejs.org/"
    exit 1
fi

echo "  Found: Node.js $(node --version)"

# ---------------------------------------------------------------------------
# Step 5: Build extension
# ---------------------------------------------------------------------------
echo ""
echo "[5/5] Building the extension..."

cd "$EXTENSION_DIR"
npm install --silent 2>/dev/null
BUILD_TARGET=popup npx vite build 2>/dev/null
BUILD_TARGET=overlay npx vite build 2>/dev/null
cd "$SCRIPT_DIR"

echo "  Extension built."

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
echo "========================================"
echo "  Setup Complete!"
echo "========================================"
echo ""
echo "To start the backend server:"
echo "  cd lensmu/backend"
echo "  source venv/bin/activate"
echo "  python server.py"
echo ""
echo "To load the extension in Chrome:"
echo "  1. Go to chrome://extensions"
echo "  2. Enable Developer Mode (top right)"
echo "  3. Click 'Load unpacked'"
echo "  4. Select: $EXTENSION_DIR"
echo ""
echo "Set the OCR engine to PaddleOCR in the extension popup for best results."
echo ""
