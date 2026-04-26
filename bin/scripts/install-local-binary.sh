#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE_BINARY="$ROOT_DIR/r1q"
TARGET_DIR="$HOME/.ntee-r1quest"
TARGET_BINARY="$TARGET_DIR/r1q"
TARGET_CONFIG="$TARGET_DIR/.r1qconfig.json"
SOURCE_CONFIG="$ROOT_DIR/bin/templates/.r1qconfig.json"

if [[ ! -f "$SOURCE_BINARY" ]]; then
  echo "Missing built binary: $SOURCE_BINARY" >&2
  echo "Run 'bun run build' first." >&2
  exit 1
fi

mkdir -p "$TARGET_DIR"
cp "$SOURCE_BINARY" "$TARGET_BINARY"
chmod +x "$TARGET_BINARY"

if [[ ! -f "$TARGET_CONFIG" ]]; then
  cp "$SOURCE_CONFIG" "$TARGET_CONFIG"
fi

echo "Installed r1q to $TARGET_BINARY"
echo "Config file: $TARGET_CONFIG"
echo
echo "Add this to your shell profile if needed:"
echo 'export PATH="$HOME/.ntee-r1quest:$PATH"'
