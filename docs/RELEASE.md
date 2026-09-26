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
| `ghcr.io/<owner>/slop-remote-relay-server:<v>` and `:latest` | Docker, linux/amd64 + linux/arm64 |
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

## Build caches

Every release rebuilds every app, so versions and the download set stay
consistent. The controller is the slow part (Gradle ~17 min, `xcodebuild`
~11 min), almost all of it compiling native code that doesn't change between
releases. `expo prebuild` itself takes seconds, so `android/` and `ios/` are
still generated fresh each run.

The controller jobs use the Gradle cache (`setup-gradle`, `--build-cache`) and
ccache (`.github/actions/ccache`; on iOS through `expo-build-properties`
`ccacheEnabled`, switched on by `RELAY_CCACHE=1` so local builds are
unaffected). GitHub lets a tag run read only caches written on its own ref or on
`master`, so the release never writes them: `.github/workflows/controller.yml`
builds the controller on every `master` push that touches it and fills them.
That workflow is also the only check that the native builds still work before
a tag. Each build ends with `ccache --show-stats` to show the hit rate.

## AltStore source (iOS)

After each release with a working iOS build, the `altstore` job builds an
AltStore / SideStore source from all releases that carry an `.ipa`
(`tools/altstore-source.mjs`) and deploys it to GitHub Pages:

```
https://sandoramix.github.io/slop-remote-relay/altstore.json
```

Privacy strings, entitlements and the minimum iOS version are read from the
built app, since AltStore requires a source to declare every permission. Pages
is set to *GitHub Actions* as its source, and the `github-pages` environment
allows `v*` tags as well as `master`, because releases run on the tag ref.

Only AltStore **Classic** and SideStore: they install unsigned builds and sign
them with the user's Apple ID. AltStore PAL needs Apple notarization, which
requires the paid developer program.

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
