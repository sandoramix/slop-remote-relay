# Development

## Layout

```
apps/controller/          Expo SDK 57 app (React Native 0.86, New Architecture)
apps/receiver-android/    Kotlin app, its own Gradle build (not an npm workspace)
apps/browser-extension/   Manifest V3 extension, bundled with esbuild
services/relay/           Node relay server (ws + HTTP long-poll)
packages/protocol/        wire protocol, codec, TransportManager
packages/transports/      relay WS / relay HTTP / MQTT / WebRTC, shared
tools/                    benches, smoke tests, icon renderer
```

npm workspaces cover everything except the Kotlin receiver. The TypeScript
packages are consumed as source (`main` points at `src/index.ts`), so nothing
needs to be built before the apps.

## Environment

- Node 22+ (24 is what the benches run on).
- JDK 17 via `JAVA_HOME`. On this machine the `java` on `PATH` is 21; Gradle
  must see 17.
- Android SDK with platform 35/36 and build tools 35+; an x86_64 emulator image
  for the benches (`Nexus10_34` here — the ARM AVDs don't boot on this host).
- On Git Bash for Windows, prefix `adb` commands that take device paths with
  `MSYS_NO_PATHCONV=1`, or `/data/...` gets rewritten into a Windows path.

## Controller (Expo)

Continuous Native Generation: `android/` and `ios/` are generated and ignored by
git. All native configuration lives in `app.config.ts` and config plugins.

```bash
npm run android -w @relay/controller     # expo run:android, dev build with Metro
cd apps/controller && npx expo prebuild --platform android --clean
cd android && ./gradlew assembleRelease -PreactNativeArchitectures=x86_64   # fast local APK
```

Stack: expo-router (screens in `src/app`), gluestack-ui v5 components copied
into `src/components/ui` on NativeWind v5 / Tailwind v4 (`global.css` holds the
theme tokens), zustand + zod for persisted settings (`src/state/settings.ts`),
`@noble/hashes` for HMAC.

Notes from getting it to build:

- gluestack's CLI (`npx gluestack-ui init`) pins stale alphas and fails to
  install; the components were copied from its template instead. Three of them
  (modal, alert-dialog, badge) don't typecheck against RN 0.86 and were dropped.
- `@legendapp/motion` declares a peer on `nativewind >=4`, which a prerelease
  doesn't satisfy; it is not installed, and the components that need it
  (actionsheet, select, tooltip) are not used.
- `lightningcss` is pinned to 1.30.1 through a root `overrides`, as NativeWind
  v5 requires.
- `react-native-ble-plx`, `react-native-zeroconf` and `react-native-webrtc` are
  legacy modules; they run under the New Architecture's interop layer.
- A pairing link opens the app preconfigured, handy on an emulator:
  `adb shell am start -a android.intent.action.VIEW -d "relay://pair?code=…&kind=android&relay=ws://10.0.2.2:8080&lan=127.0.0.1" dev.sandoramix.skipper`

## Receiver (Kotlin)

```bash
cd apps/receiver-android
./gradlew test assembleDebug          # 12 unit tests: codec vectors, MQTT codec, commands
./gradlew installDebug
```

The debug build allows cleartext `ws://` (a relay on a laptop); release builds
require `wss://`.

## Browser extension

```bash
npm run build -w @relay/browser-extension     # → apps/browser-extension/dist
npm run watch -w @relay/browser-extension
```

Load `dist/` unpacked in `chrome://extensions`. Per-site strategies are in
`src/sites.json`.

## Tests

| Command | What it proves |
|---|---|
| `npm run typecheck` | every workspace typechecks |
| `npm test` | TransportManager ordering/failover/promotion; every shared transport against a live relay, WebRTC over libdatachannel |
| `RELAY_TEST_MQTT=wss://broker.hivemq.com:8884/mqtt npm test -w @relay/transports` | MQTT against a real broker |
| `./gradlew test` (receiver) | Kotlin canonicalisation matches the TS vectors byte for byte; MQTT codec matches the TS encoder |
| `npm run smoke:extension` | the built extension in Chrome for Testing, over relay WS, HTTP and WebRTC: status, seek, pause, fullscreen in and out |
| `npm run smoke -- <code> --relay <url>` | receiver on the emulator: signatures both ways, dedupe, forged and stale frames refused, mirror = one execution |
| `npm run smoke:paths -- <code> --relay <url>` | receiver on the emulator over relay WS, HTTP, MQTT and WebRTC |
| `npm run send -- <code> <op> ['{json}']` | fire one command at the receiver and print the reply |

### The emulator bench

```bash
"$LOCALAPPDATA/Android/Sdk/emulator/emulator.exe" -avd Nexus10_34 \
  -no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader_indirect &
npm run relay &
tools/bench.sh cielo-lento-42 ws://10.0.2.2:8080
npm run smoke -- cielo-lento-42 --relay ws://127.0.0.1:8080
npm run smoke:paths -- cielo-lento-42 --relay ws://127.0.0.1:8080
```

`bench.sh` installs the receiver, pairs it by writing its preferences, launches
it (explicitly — a launcher intent may only bring an old task forward), and
grants accessibility, retrying because both an install and a force-stop unbind
the service asynchronously.

## Changing the protocol

`Codec.canonicalize` exists in TypeScript (`packages/protocol/src/codec.ts`) and
Kotlin (`core/Codec.kt`) and must produce identical bytes. After changing either,
or the envelope shape:

```bash
npm run vectors -w @relay/protocol
```

paste the output into `CodecTest.kt` and run `./gradlew test`. A divergence
otherwise shows up only as a bare `signature` in the receiver log.

The same holds for the MQTT codec (`mqttCodec.ts` ↔ `MqttCodec.kt`, pinned by
`MqttCodecTest`) and WebRTC signalling (`signable()` in both `webrtc.ts` and
`WebRtcTransport.kt`).

## Recipes

Fullscreen strategies are data in
`apps/receiver-android/app/src/main/assets/recipes.json` — never code. Step kinds:
`node`, `reveal`, `tap`, `rotate`, `back`, `key` (Shizuku only), `mediasession`;
plus `exitFullscreen` and `fullscreenMarkers` per app. View ids and labels must
come from the real device (`adb shell uiautomator dump`), never from memory.
Note that uiautomator can't dump while a video is animating; pause it first.

## Conventions

- Code comments in English; documentation in English; user-facing strings
  (app UI) in Italian.
- One transport = one class + one line in each candidate list.
- Every envelope has a unique `id`; never remove the dedupe windows.
