#!/usr/bin/env bash
#
# Run a command with the local Chromium library prefix on the loader path,
# when one exists. On normal machines with system packages installed this is
# a transparent passthrough.
set -euo pipefail

PREFIX="${PLAYWRIGHT_LIB_DIR:-$HOME/.cache/playwright-local-libs}/root"
ARCH_TRIPLE="$(uname -m)-linux-gnu"
[ "$(uname -m)" = "x86_64" ] && ARCH_TRIPLE="x86_64-linux-gnu"

EXTRA_PATH=""
for candidate in "$PREFIX/usr/lib/$ARCH_TRIPLE" "$PREFIX/lib/$ARCH_TRIPLE"; do
  if [ -d "$candidate" ]; then
    EXTRA_PATH="${EXTRA_PATH:+$EXTRA_PATH:}$candidate"
  fi
done

if [ -n "$EXTRA_PATH" ]; then
  export LD_LIBRARY_PATH="$EXTRA_PATH${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi

exec "$@"
