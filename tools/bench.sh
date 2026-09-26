#!/usr/bin/env bash
# Rebuilds the emulator test bench described in docs/STATO.md in one go:
# installs the receiver, pairs it by writing its preferences file, grants the
# accessibility service over adb, and forwards the LAN port.
#
#   tools/bench.sh [pair-code] [relay-url-as-seen-from-emulator]
#
# Run `npm run relay` separately, then `npm run smoke -- <pair-code> --relay ws://127.0.0.1:8080`.
set -euo pipefail
export MSYS_NO_PATHCONV=1

PAIR="${1:-cielo-lento-42}"
RELAY="${2:-ws://10.0.2.2:8080}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG=com.relay.receiver

adb wait-for-device
until [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = "1" ]; do sleep 2; done

(cd "$ROOT/apps/receiver-android" && ./gradlew -q installDebug)

TMP="$(mktemp)"
cat > "$TMP" <<XML
<?xml version='1.0' encoding='utf-8' standalone='yes' ?>
<map>
    <string name="pairCode">$PAIR</string>
    <string name="relayUrl">$RELAY</string>
</map>
XML
# Git Bash's /tmp is invisible to the Windows adb binary.
SRC="$TMP"; command -v cygpath >/dev/null && SRC="$(cygpath -w "$TMP")"
adb push "$SRC" /data/local/tmp/relay.config.xml >/dev/null
rm -f "$TMP"
adb shell "run-as $PKG mkdir -p shared_prefs"
adb shell "run-as $PKG cp /data/local/tmp/relay.config.xml shared_prefs/relay.config.xml"

adb shell settings put secure enabled_accessibility_services \
  "$PKG/$PKG.service.RelayAccessibilityService"
adb shell settings put secure accessibility_enabled 1

adb shell am force-stop "$PKG"
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null
adb forward tcp:47821 tcp:47821 >/dev/null
echo "bench ready: pair=$PAIR relay=$RELAY"
