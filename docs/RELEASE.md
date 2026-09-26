# Releasing

Push a tag in the form `v<major>.<minor>.<patch>` and GitHub Actions builds
every app and publishes a GitHub Release (`.github/workflows/release.yml`):

```bash
git tag v0.3.0
git push origin v0.3.0
```

| Artifact | Built by |
|---|---|
| `relay-receiver-<v>.apk` | Gradle, `apps/receiver-android` |
| `relay-controller-<v>.apk` | `expo prebuild` + Gradle (arm64-v8a, armeabi-v7a) |
| `relay-controller-<v>-unsigned.ipa` | `expo prebuild` + `xcodebuild` on macOS, unsigned |
| `relay-extension-<v>.zip` | esbuild, `apps/browser-extension` |
| `relay-server-<v>.tgz` | `tsc`, `services/relay` |
| `ghcr.io/<owner>/relay-server:<v>` and `:latest` | Docker, linux/amd64 + linux/arm64 |
| `SHA256SUMS.txt` | checksums of all of the above |

Release notes are written for you: `tools/release-notes.mjs` lists the commits
since the previous tag, grouped by Conventional Commit type (`feat`, `fix`,
`docs`, …), and adds the download table. For a hand-written introduction,
commit `.github/release-notes/<tag>.md` before tagging; it goes on top as
*Highlights*. Preview locally with `node tools/release-notes.mjs <tag>`.

The version comes from the tag everywhere: Android `versionName`/`versionCode`
(`major*10000 + minor*100 + patch`), the iOS build number, the extension
manifest. You can also run the workflow by hand (*Actions → Release → Run
workflow*) with a version input.

The iOS job is `continue-on-error`: without an Apple developer account it can
only produce an unsigned `.ipa` (re-sign it with AltStore, Sideloadly or your
own Xcode), and a failure there must not hold back the rest.

## Android signing

Both APKs are signed with the same key, passed through AGP's injected signing
properties — no signing config lives in the repository. Set four repository
secrets (*Settings → Secrets and variables → Actions*):

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | the keystore, base64-encoded |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | key alias |
| `ANDROID_KEY_PASSWORD` | key password |

Create a keystore once and keep it safe — every future update must be signed
with it, or Android refuses to install it over the old version:

```bash
keytool -genkeypair -v -keystore relay-release.jks -alias relay \
  -keyalg RSA -keysize 4096 -validity 10000
base64 -w0 relay-release.jks      # paste into ANDROID_KEYSTORE_BASE64
```

Without the secrets the workflow generates a throwaway key for that run and says
so in the release notes: the APKs install, but cannot update an install from a
different run.

## Building signed APKs locally

Keep the keystore and a properties file outside the repo, e.g.
`~/.relay/relay-release.jks` and `~/.relay/signing.properties`:

```properties
storeFile=$HOME/.relay/relay-release.jks
storePassword=…
keyAlias=relay
keyPassword=…
```

```bash
tools/build-signed.sh v0.2.0        # → out/relay-{receiver,controller}-v0.2.0.apk
```

The script passes the same injected signing properties as the workflow, never
prints the secrets, and ends by printing each APK's version and signing
certificate — compare the SHA-256 with `keytool -list -v -keystore … -alias relay`.

## Before tagging

```bash
npm run typecheck && npm test
cd apps/receiver-android && ./gradlew test
npm run build -w @relay/browser-extension && npm run smoke:extension
```

and, with the emulator bench up (see [DEVELOPMENT.md](DEVELOPMENT.md)):

```bash
npm run smoke -- <code> --relay ws://127.0.0.1:8080
npm run smoke:paths -- <code> --relay ws://127.0.0.1:8080
```
