#!/usr/bin/env bash
# Fetch the current official microG APKs (run on your PC, not the tablet).
#
# Pulls straight from the microG project's GitHub releases, records the
# SHA-256 of everything it downloads, and pushes the APKs to the tablet.
#
#   ./fetch-microg.sh            # download + checksum only
#   ./fetch-microg.sh --install  # also `adb install` them
#
# NOTE: this does NOT provide signature spoofing. See README.md — without the
# NanoDroid patcher (or a spoof-patched ROM) microG will fail its self-check.

set -euo pipefail

OUT="${OUT:-./microg-apks}"
mkdir -p "$OUT"

# repo -> asset name filter
fetch_latest() {
    local repo="$1" filter="$2"
    echo ">>> $repo"
    local url
    url=$(curl -fsSL "https://api.github.com/repos/${repo}/releases/latest" \
          | grep -o '"browser_download_url": *"[^"]*"' \
          | cut -d'"' -f4 \
          | grep -iE "$filter" \
          | head -1)
    if [ -z "$url" ]; then
        echo "    !! no asset matching /$filter/ — check the release page manually"
        return 1
    fi
    echo "    $url"
    ( cd "$OUT" && curl -fsSL -O "$url" )
}

# GmsCore = Play Services replacement; GsfProxy = legacy GCM shim
fetch_latest "microg/GmsCore"  '\.apk$'        || true
fetch_latest "microg/GsfProxy" '\.apk$'        || true

echo
echo "=== SHA-256 (record these, compare after transferring to the tablet) ==="
if command -v sha256sum >/dev/null; then
    sha256sum "$OUT"/*.apk
else
    shasum -a 256 "$OUT"/*.apk
fi

if [ "${1:-}" = "--install" ]; then
    echo
    echo "=== installing over adb ==="
    for f in "$OUT"/*.apk; do
        echo "  -> $f"
        adb install -r "$f"
    done
    echo "Reboot, then open microG Settings -> Self-Check."
fi
