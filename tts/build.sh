#!/usr/bin/env bash
# Build script for libpiper and the Odin TTS server
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="$SCRIPT_DIR/.build"
LIBPIPER_DIR="$BUILD_DIR/piper1-gpl"

# Clone or update libpiper
if [ ! -d "$LIBPIPER_DIR" ]; then
    echo "Cloning piper1-gpl..."
    git clone --depth 1 --branch v1.3.0 https://github.com/OHF-Voice/piper1-gpl.git "$LIBPIPER_DIR"
fi

# Build libpiper
echo "Building libpiper..."
cd "$LIBPIPER_DIR/libpiper"
cmake -Bbuild -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$BUILD_DIR/install"
cmake --build build -j$(nproc)
cmake --install build

# Copy espeak-ng data
echo "Setting up espeak-ng data..."
ESPEAK_DATA_SRC="$LIBPIPER_DIR/libpiper/build/espeak_ng-install/share/espeak-ng-data"
MODELS_DIR="${MODELS_DIR:-$SCRIPT_DIR/../.models}/piper"
mkdir -p "$MODELS_DIR"
if [ -d "$ESPEAK_DATA_SRC" ]; then
    cp -r "$ESPEAK_DATA_SRC" "$MODELS_DIR/"
fi

# Build Odin TTS server
echo "Building Odin TTS server..."
cd "$SCRIPT_DIR"

INSTALL_DIR="$BUILD_DIR/install"
export LD_LIBRARY_PATH="$INSTALL_DIR/lib:${LD_LIBRARY_PATH:-}"

odin build . -out:tts-server \
    -extra-linker-flags:"-L$INSTALL_DIR/lib -lpiper -lonnxruntime -Wl,-rpath,$INSTALL_DIR/lib"

echo ""
echo "Build complete!"
echo "  Library: $INSTALL_DIR/lib/libpiper.so"
echo "  Binary:  $SCRIPT_DIR/tts-server"
echo ""
echo "To run:"
echo "  export LD_LIBRARY_PATH=$INSTALL_DIR/lib:\$LD_LIBRARY_PATH"
echo "  ./tts-server"
