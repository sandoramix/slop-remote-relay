# Skipper

> **About this repository — it's slop, on purpose.** As the `slop-` prefix
> says, everything here — code, tests, docs, even this README — was generated
> by AI. The point of the project is to turn an idea into something real and
> find out whether it actually works well, not to build a maintained product.
> Use it, fork it, learn from it, but expect rough edges: the chances of it
> being maintained long-term are slim.

**Skip the intro from the sofa.** Your phone becomes the remote for whatever
video is playing on another screen.

Site and install guide: <https://sandoramix.github.io/slop-remote-relay/>.
The code and packages are still called *Relay* internally; the apps ship as
*Skipper*.

You are on the sofa. The film is running on an Android phone propped up on the
TV stand, or in a browser tab on the laptop across the room. You want to skip
the intro, jump back 30 seconds, pause, or go fullscreen — without getting up.
Relay turns the phone in your hand into that remote.

It works with any app that plays video — YouTube, Netflix, Prime Video, Twitch,
VLC, a video in Chrome or Brave — because it doesn't talk to the apps. It talks
to the device, and the device acts on whatever is in front.

---

## What you can do

- **Jump by any amount**: 10 s, 30 s, 5 minutes, 1:30, 2 hours — pick a preset or
  type one. Hold the key to keep jumping.
- **Scrub** to an exact point on a progress bar.
- **Play / pause.**
- **Enter and leave fullscreen**, including on web players in Chrome and Brave.
- **Drive several devices** — a phone and a browser, say — and switch between
  them from the top of the remote.

## Why it is built this way

Home networks are unreliable, and a remote that stops working when the Wi-Fi
hiccups is worse than no remote. So Relay never depends on a single way of
reaching the device. It keeps **six independent paths** open at once and sends
every command over the best one that is alive right now:

| Path | Needs | Good for |
|---|---|---|
| **Wi-Fi (local)** | both devices on the same network | fastest, works with the internet down |
| **WebRTC (peer-to-peer)** | internet + your relay server to set it up | fast and direct from anywhere |
| **Relay (WebSocket)** | internet + your relay server | works everywhere |
| **Relay (HTTP)** | internet + your relay server | networks that block WebSockets (hotels, offices) |
| **MQTT** | internet + an MQTT broker (public by default) | keeps working if your own relay is down |
| **Bluetooth** | a few metres of distance | no network at all |

If the current path fails, the next one takes over instantly because it is
already connected. **You choose the order** in *Settings → Paths & priority*,
and you can switch any path off.

It is also secure by design: every command is signed with a key derived from a
pairing code that only your two devices know. The relay server, an MQTT broker
or anyone else on the network can pass messages along, but cannot forge a
command or replay an old one.

## What's in the box

| Part | Runs on | What it does |
|---|---|---|
| **Skipper** (controller) | the phone in your hand (Android, iOS) | the remote |
| **Skipper Screen** (receiver) | the Android phone that plays the video | carries out the commands |
| **Skipper for Chrome** (extension) | desktop Chrome or Brave | makes any tab's video controllable |
| **Relay server** (optional) | any small server, a NAS, a Raspberry Pi | meeting point for the internet paths |

The receiver only exists for Android: iOS does not let an app control other
apps, so an iPhone can be the remote but not the screen.

---

## Getting started

### 1. Install

Download the latest files from the
[Releases page](https://github.com/sandoramix/slop-remote-relay/releases):

- `relay-controller-<version>.apk` on the phone you'll hold
- `relay-receiver-<version>.apk` on the Android phone that plays video
- `relay-extension-<version>.zip` if you want to control a desktop browser

Android will ask you to allow installing apps from your browser or file
manager; that's expected for apps not from the Play Store.

**iPhone as the remote:** install [AltStore](https://altstore.io) (or
[SideStore](https://sidestore.io)), then in AltStore go to *Browse → Sources →
+* and add:

```
https://sandoramix.github.io/slop-remote-relay/altstore.json
```

Install **Skipper** from there. AltStore signs it with your own (free) Apple ID
and re-signs it every 7 days; new versions appear there automatically. Turn on
*Developer Mode* in iOS settings when asked.

### 2. Set up the receiver (the phone that plays video)

1. Open **Skipper Screen** on that phone. It generates a pairing code for you (or tap
   *Genera un codice nuovo*).
2. Optionally enter your relay server address (see *Using it away from home*).
3. Tap **Salva e riavvia**. A QR code appears.
4. Work through the **Permessi** list on the same screen:
   - **Notification access** — lets Relay find the video that's playing and
     jump to the exact second. This is what makes seeking precise.
   - **Accessibility** — needed for fullscreen and as a fallback for seeking.
     Relay only reads the screen to find the fullscreen button; it never
     records or sends what is on it.
   - **Bluetooth and notifications** — for the Bluetooth path.
   - **Battery optimisation** and **manufacturer autostart** — so the receiver
     is still listening tomorrow morning. Skipping these is the most common
     reason a receiver "stops working" overnight.

> On Android 13 and later, sideloaded apps may have Accessibility greyed out.
> Open *App info → ⋮ → Allow restricted settings* first. See
> [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md) if that option is missing.

### 3. Pair the remote

On the phone you hold, open **Skipper** and either:

- **scan the receiver's QR code** with the camera and tap the link, or
- type the **same pairing code** on the welcome screen.

That's it. The remote shows which path it is using (for example *Wi-Fi locale
· 6 ms*); tap it to see all six.

### 4. Control a browser (optional)

1. Unzip `relay-extension-<version>.zip` into a folder you'll keep, e.g.
   `Documents/relay-extension` — updates go into the same folder.
2. In Chrome or Brave open `chrome://extensions`, turn on **Developer mode**,
   click **Load unpacked** and pick that folder.
3. Click the Skipper icon and follow the three setup steps: relay address,
   pairing code, then scan the QR code with your phone.
4. That's it. Fullscreen works out of the box: it uses Chrome's debugger
   permission, because a web page only goes fullscreen when a person asks and
   this is the only way an extension can ask on your behalf. While a fullscreen
   command runs, Chrome briefly shows a "Relay is debugging this browser" bar.

The popup shows whether your phone is connected and over which path, which tab
commands go to, and the last command. A green dot on the toolbar icon means a
phone is connected.

**Updates:** the extension checks GitHub twice a day. When a new version is
out, the popup offers it: download the zip, unzip it over the same folder, and
press **Reload Skipper**. Pairing and settings are kept. (Chrome only lets Web
Store extensions update themselves; this is the closest a GitHub release gets.)

A browser can only be reached over the internet paths, so it needs a relay
server (or MQTT).

### Using it away from home — the relay server

On the same Wi-Fi, nothing else is needed. To use the remote from elsewhere, or
to control a browser, run the small relay server somewhere both devices can
reach:

```bash
docker run -d --name relay -p 8080:8080 ghcr.io/sandoramix/slop-remote-relay-server:latest
```

Put it behind HTTPS (the receiver only accepts `wss://` in release builds). The
simplest way is [Caddy](https://caddyserver.com):

```
relay.example.com {
    reverse_proxy localhost:8080
}
```

Then enter `wss://relay.example.com` in the receiver, the controller
(*Settings → Server*) and the extension.

The server only ever sees an anonymous room id. It never learns your pairing
code or the signing key, and it stores nothing.

---

## Tips and troubleshooting

- **Seeking is imprecise (jumps in 10 s steps).** The receiver is missing
  *Notification access*, or the app doesn't publish its playback state. With
  notification access, jumps are exact to the second.
- **Fullscreen does nothing.** Check that *Accessibility* is on for Skipper Screen. For a
  video in a browser, the player's controls must exist on the page; Relay taps
  the page's own fullscreen button.
- **It worked yesterday, not today.** Almost always the manufacturer's battery
  saver killed the receiver. Redo the last two permission steps.
- **Advanced users: Shizuku.** If accessibility is blocked on the receiver (for
  example by Android's Advanced Protection Mode), Relay can use
  [Shizuku](https://shizuku.rikka.app) instead for fullscreen keys and taps.
  See [docs/SHIZUKU.md](docs/SHIZUKU.md).
- **Diagnostics.** On the remote, tap the path indicator: you'll see every
  path's health and latency, what the receiver can do, and a log of recent
  commands with which layer carried them out.

---

## For developers

The repository is a monorepo with one folder per app:

```
apps/
  controller/          Expo (React Native) app — the remote
  receiver-android/    native Kotlin app — the receiver
  browser-extension/   Manifest V3 extension — the browser receiver
services/
  relay/               Node relay server
packages/
  protocol/            wire protocol, signing, failover manager (TypeScript)
  transports/          relay / HTTP / MQTT / WebRTC transports shared by controller and extension
tools/                 test benches and smoke tests
```

```bash
npm install
npm run typecheck && npm test
npm run relay                                   # relay on :8080
npm run android -w @relay/controller            # controller (needs Android SDK)
cd apps/receiver-android && ./gradlew installDebug
npm run build -w @relay/browser-extension       # extension in apps/browser-extension/dist
```

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how the pieces fit, and why
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — building each app, test benches, conventions
- [docs/STATUS.md](docs/STATUS.md) — what is verified, how, and what is still open
- [docs/SHIZUKU.md](docs/SHIZUKU.md) — the optional shell-privileged executor
- [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md) — Android platform restrictions that affect installing
- [docs/RELEASE.md](docs/RELEASE.md) — tagging a release and signing keys
