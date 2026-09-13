#!/bin/zsh
# Rebuild matched @gpuix/native darwin-arm64 from the Wave 3.2 gpuix tree
# and drop the .node into the vendored native tarball.
#
# Run on Cary's Mac (arm64). Requires rustc/cargo + bun.
# Uses --features runtime_shaders so the Metal *CLI* (full Xcode) is NOT required;
# shaders compile at runtime via the Metal framework.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GPUIX="${GPUIX_ROOT:-$HOME/Projects/gpuix}"
if [[ ! -d "$GPUIX/packages/native" ]]; then
  echo "gpuix tree not found at $GPUIX"
  exit 1
fi

if [[ "$(uname -m)" != "arm64" ]]; then
  echo "expected darwin-arm64, got $(uname -m)"
  exit 1
fi

export PATH="$HOME/.cargo/bin:$PATH"
PATCH="$ROOT/vendor/gpuix-native-spring-passthrough.patch"
if [[ -f "$PATCH" ]] && ! git -C "$GPUIX" log --oneline | grep -q "pass spring transitions through to native"; then
  echo "applying $PATCH onto $GPUIX"
  git -C "$GPUIX" apply --check "$PATCH" && git -C "$GPUIX" apply "$PATCH"
fi

# Ensure runtime_shaders feature exists on packages/native
NATIVE_TOML="$GPUIX/packages/native/Cargo.toml"
if ! grep -q 'runtime_shaders' "$NATIVE_TOML"; then
  python3 - <<PY
from pathlib import Path
p = Path("$NATIVE_TOML")
text = p.read_text()
needle = 'test-support = ["gpui/test-support", "gpui_platform/test-support", "gpui_macos/test-support", "gpui_macos/font-kit"]\n'
if needle not in text:
    raise SystemExit("unexpected Cargo.toml features")
p.write_text(text.replace(needle, needle + 'runtime_shaders = ["gpui_macos/runtime_shaders"]\n'))
print("added runtime_shaders feature")
PY
fi

cd "$GPUIX/packages/native"
bun install
bunx napi build --platform --release --features test-support,runtime_shaders

NODE="gpuix-native.darwin-arm64.node"
if [[ ! -f "$NODE" ]]; then
  echo "build did not produce $NODE"
  ls -la
  exit 1
fi

STAGE="$(mktemp -d)"
mkdir -p "$STAGE/package"
tar -xzf "$ROOT/vendor/gpuix-native-0.6.2.tgz" -C "$STAGE"
cp "$NODE" "$STAGE/package/$NODE"
tar -czf "$ROOT/vendor/gpuix-native-0.6.2.tgz" -C "$STAGE" package
echo "wrote $ROOT/vendor/gpuix-native-0.6.2.tgz with $NODE ($(wc -c < "$STAGE/package/$NODE") bytes)"
cd "$ROOT"
bun install
echo "next: bun test && bun run app"
