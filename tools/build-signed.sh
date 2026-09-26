#!/usr/bin/env bash
# Builds signed release APKs of both Android apps locally, with the same
# injected signing properties the Release workflow uses, then verifies them.
#
#   tools/build-signed.sh [version] [signing.properties]
#
# signing.properties (default ~/.relay/signing.properties), never in the repo:
#   storeFile=/c/Users/me/.relay/relay-release.jks   ($HOME is expanded)
#   storePassword=…
#   keyAlias=…
#   keyPassword=…
#
# Secrets are passed to Gradle and never printed.
set -euo pipefail

VERSION="${1:-v0.0.0-local}"
PROPS="${2:-$HOME/.relay/signing.properties}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/out"

prop() { grep -E "^$1=" "$PROPS" | head -1 | cut -d= -f2- | tr -d '\r'; }
[ -f "$PROPS" ] || { echo "missing $PROPS" >&2; exit 2; }

STORE_FILE="$(prop storeFile)"
STORE_FILE="${STORE_FILE//\$HOME/$HOME}"
STORE_FILE="${STORE_FILE/#\~/$HOME}"
# Gradle runs on the Windows JVM here and needs a Windows path.
command -v cygpath >/dev/null && STORE_FILE="$(cygpath -w "$STORE_FILE")"
STORE_PASSWORD="$(prop storePassword)"
KEY_ALIAS="$(prop keyAlias)"
KEY_PASSWORD="$(prop keyPassword)"
for v in STORE_FILE STORE_PASSWORD KEY_ALIAS KEY_PASSWORD; do
  [ -n "${!v}" ] || { echo "$v is empty in $PROPS" >&2; exit 2; }
done

SIGNING=(
  "-Pandroid.injected.signing.store.file=$STORE_FILE"
  "-Pandroid.injected.signing.store.password=$STORE_PASSWORD"
  "-Pandroid.injected.signing.key.alias=$KEY_ALIAS"
  "-Pandroid.injected.signing.key.password=$KEY_PASSWORD"
)
mkdir -p "$OUT"

echo "== receiver ($VERSION)"
(cd "$ROOT/apps/receiver-android" && ./gradlew -q assembleRelease "-PrelayVersion=$VERSION" "${SIGNING[@]}")
cp "$ROOT/apps/receiver-android/app/build/outputs/apk/release/app-release.apk" "$OUT/relay-receiver-$VERSION.apk"

echo "== controller ($VERSION)"
(cd "$ROOT/apps/controller" && CI=1 RELAY_VERSION="$VERSION" npx expo prebuild --platform android --clean --no-install >/dev/null)
(cd "$ROOT/apps/controller/android" && RELAY_VERSION="$VERSION" ./gradlew -q assembleRelease \
  -PreactNativeArchitectures=arm64-v8a,armeabi-v7a "${SIGNING[@]}")
cp "$ROOT/apps/controller/android/app/build/outputs/apk/release/app-release.apk" "$OUT/relay-controller-$VERSION.apk"

BT="$(ls -d "${ANDROID_HOME:-$LOCALAPPDATA/Android/Sdk}"/build-tools/* | sort -V | tail -1)"
APKSIGNER="$BT/apksigner"; [ -f "$APKSIGNER.bat" ] && APKSIGNER="$APKSIGNER.bat"
AAPT2="$BT/aapt2"; [ -f "$AAPT2.exe" ] && AAPT2="$AAPT2.exe"
for apk in "$OUT"/relay-*-"$VERSION".apk; do
  echo "== $(basename "$apk")"
  "$AAPT2" dump badging "$apk" | head -1 | grep -oE "name='[^']+'|versionCode='[^']+'|versionName='[^']+'" | tr '\n' ' '; echo
  "$APKSIGNER" verify --print-certs "$apk" | grep -E "certificate DN|SHA-256"
done
