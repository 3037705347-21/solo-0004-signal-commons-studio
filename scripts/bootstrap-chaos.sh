#!/usr/bin/env bash
#
# Reproducible local/CI bootstrap for chaos drills.
#
# Installs npm dependencies, the Playwright Chromium build, and the Chromium
# shared libraries. On CI images that grant root this is a normal
# `playwright install-deps`. On locked-down machines (no root, custom apt
# sources) it downloads the Debian packages into a user-owned prefix and runs
# Playwright through scripts/with-browser-libs.sh, which exports
# LD_LIBRARY_PATH. Everything lives under the user home / project tree, so
# the setup is fully removable.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_LIB_DIR="${PLAYWRIGHT_LIB_DIR:-$HOME/.cache/playwright-local-libs}"

case "$(uname -m)" in
  x86_64) ARCH_TRIPLE="x86_64-linux-gnu" ;;
  aarch64 | arm64) ARCH_TRIPLE="aarch64-linux-gnu" ;;
  *) ARCH_TRIPLE="$(uname -m)-linux-gnu" ;;
esac

cd "$ROOT_DIR"

npm install
npx playwright install chromium

HEADLESS_SHELL="$(find "$HOME/.cache/ms-playwright/chromium_headless_shell-"*"/chrome-headless-shell-linux-"*"/chrome-headless-shell" 2>/dev/null | head -1)"

needs_local_libs=0
if [ -z "$HEADLESS_SHELL" ] || ldd "$HEADLESS_SHELL" 2>/dev/null | grep -q "not found"; then
  needs_local_libs=1
fi

if [ "$needs_local_libs" -eq 0 ]; then
  echo "bootstrap: Chromium shared libraries already available"
  exit 0
fi

echo "bootstrap: resolving Chromium shared libraries"
if npx playwright install-deps chromium >/dev/null 2>&1; then
  echo "bootstrap: system dependencies installed via playwright install-deps"
  exit 0
fi

echo "bootstrap: insufficient privileges for system packages; using local prefix $LOCAL_LIB_DIR"

APT_ETC="$LOCAL_LIB_DIR/apt-etc"
APT_STATE="$LOCAL_LIB_DIR/apt-state"
APT_CACHE="$LOCAL_LIB_DIR/apt-cache"
DEB_DIR="$LOCAL_LIB_DIR/debs"
PREFIX="$LOCAL_LIB_DIR/root"
mkdir -p "$APT_ETC" "$APT_STATE/lists/partial" "$APT_CACHE/archives/partial" "$DEB_DIR" "$PREFIX"
cp -r /etc/apt/. "$APT_ETC/" 2>/dev/null || true

APT_OPTS=(-o "Dir::Etc=$APT_ETC" -o "Dir::State=$APT_STATE" -o "Dir::Cache=$APT_CACHE")
apt-get "${APT_OPTS[@]}" update

PACKAGES=(
  libnspr4 libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libxkbcommon0
  libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2
  libatspi2.0-0 libpango-1.0-0 libcairo2 libdrm2 libxi6 libdbus-1-3
  libwayland-server0
)
(cd "$DEB_DIR" && apt-get "${APT_OPTS[@]}" download "${PACKAGES[@]}")
for deb in "$DEB_DIR"/*.deb; do
  dpkg-deb -x "$deb" "$PREFIX"
done

if LD_LIBRARY_PATH="$PREFIX/usr/lib/$ARCH_TRIPLE:$PREFIX/lib/$ARCH_TRIPLE" \
  ldd "$HEADLESS_SHELL" | grep -q "not found"; then
  echo "bootstrap: WARNING - some Chromium libraries are still missing; see ldd output" >&2
else
  echo "bootstrap: local library prefix is complete"
fi
