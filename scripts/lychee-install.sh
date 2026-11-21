#!/usr/bin/env bash
set -euo pipefail
: "${LYCHEE_INSTALL_DIR:?set a dedicated installation directory}"
mkdir -p "$LYCHEE_INSTALL_DIR"
archive="$LYCHEE_INSTALL_DIR/lychee.tar.gz"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  https://github.com/lycheeverse/lychee/releases/download/lychee-v0.24.2/lychee-x86_64-unknown-linux-gnu.tar.gz \
  --output "$archive"
printf '%s  %s\n' 1f4e0ef7f6554a6ed33dd7ac144fb2e1bbed98598e7af973042fc5cd43951c9a "$archive" | sha256sum --check --status
tar -xzf "$archive" -C "$LYCHEE_INSTALL_DIR"
"$LYCHEE_INSTALL_DIR/lychee-x86_64-unknown-linux-gnu/lychee" --version
