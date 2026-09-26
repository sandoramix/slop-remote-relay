# Status — start here

Updated 2026-09-26. Main branch `master`; first release `v0.2.0`.

This file lets a new session pick up without rereading everything: what is
verified, how to reproduce it, and what is still open.

## What is verified, and how

| Area | Verified | How |
|---|---|---|
| Protocol, both languages | yes | canonical vectors in `CodecTest` (TS ↔ Kotlin), 12 Kotlin + 13 TS tests |
| Failover manager | yes | unit tests: user order wins at startup, instant failover, promotion after sustained health, mirror |
| Shared transports | yes | live relay: WS, HTTP (incl. cross-channel and same-channel routing), WebRTC over libdatachannel; MQTT against broker.hivemq.com |
| Android receiver, every remote path | yes, emulator | `smoke:paths`: relay WS, HTTP, MQTT, WebRTC — 12/12 |
| Android receiver, protocol behaviour | yes, emulator | `smoke`: signatures, dedupe, forged/stale frames, mirror — 21/21 |
| Controller app | yes, emulator | release APK: pairing via deep link, "Wi-Fi locale" + standbys, `+30s` acked "via Accessibilità", path order persisted across restart |
| Fullscreen in Chrome (Android) | yes, emulator | HTML5 `<video>`: six toggles in a row, enter via the page's button, state detected, exit via Back |
| Shizuku executor | yes, emulator | Shizuku 13.6 started over adb, accessibility off: exit fullscreen via `KEYCODE_ESCAPE` |
| Browser extension | yes, Chrome for Testing | `smoke:extension` over relay WS, HTTP, WebRTC — status, seekTo, pause, fullscreen in (CDP) and out; a tab already open when the extension is (re)installed is still found and driven — 18/18 |
| Release pipeline pieces | partly | receiver signed via injected properties with tag version (verified locally); extension zip; relay build as in the Dockerfile. The workflow itself has not run on GitHub yet |

## Bugs found and fixed along the way

In order of how well hidden they were.

1. **Heartbeats were unsigned.** `TransportManager` sent plain pings and the
   receiver drops unsigned frames, so every path missed its heartbeats and was
   torn down and redialled every ~8 s while looking connected.
2. **Promotion back to a better path never happened.** `reselect()` only ran on
   connect and failure, never on heartbeat, so "move back to Wi-Fi after 15 s"
   could not occur.
3. **`flagReportViewIds` was missing** from the accessibility config.
   `viewIdResourceName` was always null for the service, so no `viewIds` entry
   in `recipes.json` could ever match. uiautomator sets the flag for itself,
   which is why dumps showed ids the service couldn't see.
4. **Web fullscreen buttons were invisible to the matcher.** Chromium puts a web
   control's name in the node *text*; only the content description was read.
5. **WebRTC re-offer race.** A receiver joining mid-negotiation superseded the
   first offer, whose `setLocalDescription` never settled on the closed peer,
   so the controller never armed its "open" waiter.
6. **Empty STUN list** produced `{urls: []}`, a SyntaxError in spec-strict stacks.
7. **Foreground package went stale** when an app came back to an existing task
   without a window-state event; now read from the active window first.
8. **Shizuku key steps always "succeeded"** — injection has exit code 0 whether
   or not the page reacts. Now judged by the fullscreen markers.

Earlier, from the first build-out: canonicalisation divergence on `/`,
`AccessibilityExecutor` ignoring seeks, the NSD port bug, the background
foreground-service start, cleartext relay in debug.

## Reproducing the bench

See [DEVELOPMENT.md](DEVELOPMENT.md#the-emulator-bench). The fullscreen check
used a page served from the host with a `<video>` (`max-height: 70vh`, so the
control bar is on screen) opened in the emulator's Chrome at
`http://10.0.2.2:8090/`, then:

```bash
npm run send -- cielo-lento-42 fullscreen.enter '{"toggle":true}'
npm run send -- cielo-lento-42 device.status
```

## Still open

**Needs a real phone**

- Exact seek through MediaSession. The emulator has no media session, so the
  chain always falls back to taps. Expect `executedBy: "mediasession"`.
- Fullscreen in the YouTube app and in Brave. The Chrome path is verified; the
  YouTube view id and Brave's ids and labels are not (Brave uses Chromium's
  labels, but that is inference until dumped on a device).
- A web player whose control bar is below the fold: Chromium prunes those nodes,
  so the recipe falls through to rotation. Seen with an oversized test video.
- Bluetooth: both sides are implemented, neither can run on the emulator.
- WebRTC across real carrier NAT (a TURN server is configurable in the
  controller; the receiver uses STUN only for now).
- Overnight resistance (phase 5 of the original plan).

**Needs other hardware or accounts**

- iOS controller: prebuilt and built only in CI on macOS, never run.
- Release workflow: has to run once on GitHub; the iOS job is allowed to fail.

**Known, not done**

- `Codec.verify` accepts unsigned `hello` for symmetry with `codec.ts`; the
  router ignores it, so no impact.
- The controller cannot yet scan a QR code in-app; it relies on the system camera
  opening the `relay://pair` link.
- The receiver has no learning mode for recording a tap coordinate on unknown
  apps, though `RecipeEngine` already reads learned recipes.
