#!/bin/zsh
# Rebuild matched @gpuix/native darwin-arm64 from the Wave 3.2 gpuix tree
# and drop the .node into the vendored native tarball.
#
# Run on Cary's Mac (arm64). Requires rustc/cargo and bun.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GPUIX="${GPUIX_ROOT:-$HOME/Projects/gpuix}"
if [[ ! -d "$GPUIX/packages/native" ]]; then
  echo "gpuix tree not found at $GPUIX"
  echo "clone: git clone --branch feat/native-spring-passthrough https://github.com/professorpalmer/gpuix.git $GPUIX"
  echo "then:  git -C $GPUIX submodule update --init --depth 1 zed"
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

cd "$GPUIX/packages/native"
bun install
bun run build

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
