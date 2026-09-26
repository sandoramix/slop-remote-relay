# Architecture

## The pieces

```
 controller (Expo)                      receivers
 ┌──────────────────┐        ┌──────────────────────────────────┐
 │ RelayClient      │        │ Android (Kotlin)                 │
 │ TransportManager │◄──────►│   TransportSet → CommandRouter   │
 │  lan  webrtc     │  six   │   → ExecutorChain                │
 │  relay http      │ paths  │     MediaSession │ Accessibility │
 │  mqtt  ble       │        │     │ Shizuku                    │
 └──────────────────┘        ├──────────────────────────────────┤
                             │ Browser extension (MV3)          │
          relay server ◄────►│   offscreen: transports + router │
          MQTT broker        │   worker: tabs, debugger         │
                             │   content script: <video>        │
                             └──────────────────────────────────┘
```

`packages/protocol` is the contract: commands, the signed envelope, the
canonical serialisation, and the failover `TransportManager`. Its Kotlin twin is
`apps/receiver-android/app/src/main/java/com/relay/receiver/core/`.
`packages/transports` holds the room-based paths (relay WS, relay HTTP, MQTT,
WebRTC) that the controller and the browser extension share; they are
symmetric, and only `role` differs.

## Why the Android receiver is native Kotlin and the controller is not

`AccessibilityService` and `NotificationListenerService` are not classes you
instantiate: they are components declared in the manifest that the *system*
creates, binds and keeps alive for days. Keeping a JavaScript runtime warm
around the clock next to them adds weight and one more way to die, and gives
nothing back — the receiver has no UI worth sharing.

The controller is the opposite: all UI, short-lived sessions, and it has to run
on iOS too. That is what Expo is good at.

## Two independent chains

**Transport** — which road a command takes. The controller keeps every
configured path connected at once and routes over the best healthy one, in the
**order the user chose** (Settings → Paths & priority; the rank becomes the
`priority`). Falling back is immediate because the standby is already open.
Moving back up to a better path waits for 15 s of continuous health, so the
remote doesn't flap between Wi-Fi and relay at the edge of coverage. During the
first four seconds after startup the best-ranked path wins at once, so the
user's default is in use from the start.

**Execution** — how a command becomes an action on the receiver:

```
MediaSession    exact to the millisecond      needs notification access
Accessibility   works on any app              needs the accessibility service
Shizuku         keys, taps, rotation          needs Shizuku running (optional)
```

The chains never talk to each other. A receiver whose accessibility grant was
revoked still seeks exactly; it only loses fullscreen. A receiver with
accessibility blocked entirely can still do fullscreen through Shizuku.

## Three asymmetries between controller and receiver

**The controller chooses, the receiver doesn't.** The controller routes over one
path at a time. The receiver stays reachable on all of them (`TransportSet`):
it costs almost nothing and guarantees the controller's failover always has
somewhere to land.

**The controller duplicates, the receiver deduplicates.** With *double send*
on, a command leaves on two paths at once. The `DedupeWindow` in
`CommandRouter` (and in the extension's offscreen router) makes sure a "+30 s"
pressed once never jumps 60.

**The receiver reports which layer acted.** Every ack carries `executedBy`. It
looks like logging, but it is what lets you tell from the phone in your hand
whether a seek went through MediaSession (exact) or through double-taps (10 s
steps), without plugging in a cable.

## The life of a command

```
Remote                 press "+30s"
  ↓
RelayClient            HMAC-sign, unique id, promise waiting for the ack
  ↓
TransportManager       route on the active path (+ mirror if double send)
  ↓  ~~~ network ~~~
Transport (receiver)   LAN, WebRTC, relay, HTTP, MQTT or BLE — irrelevant from here
  ↓
CommandRouter          verify signature → drop stale → dedupe → execute
  ↓
ExecutorChain          MediaSession? yes → seekTo(position + 30 000)
  ↓
ack {ok, executedBy}   back on the same path
```

Heartbeats are signed too: the receiver drops every unsigned frame.

## Security model

- The **pair code** is the only secret. The HMAC key is `sha256("secret:" +
  code)`, the rendezvous room is the first 24 hex chars of `sha256("room:" +
  code)`.
- The relay, an MQTT broker, or anyone on the LAN can see room ids and frames,
  but cannot forge or replay a command: frames are signed, carry a timestamp
  (±30 s) and an id the receiver remembers.
- Because the room id is a plain hash of the code, a short code could be
  brute-forced offline from an observed room id. Generated codes carry 80 bits
  (`xxxx-xxxx-xxxx-xxxx`); the UI warns when a typed code is short.
- WebRTC signalling is signed with the same key, so the relay cannot inject SDP.
- Public MQTT brokers can read commands (seek amounts, package names). Self-host
  if that matters.

## The browser extension

A Manifest V3 extension has three contexts, and each does what only it can:

- **offscreen document** — the receiver runtime: every network path (a service
  worker has no `RTCPeerConnection`), signature checks, dedupe, signed replies
- **service worker** — owns the tabs: picks the tab and frame whose video
  matters (audible, playing, largest) and executes
- **content script** (every frame) — seeks, pauses, leaves fullscreen, and
  reports media state

Entering fullscreen needs a user gesture that no extension API grants. The
worker briefly attaches the debugger (optional permission) and sends either a
real key press (the site's own shortcut, from `sites.json`) or a
gesture-flagged `requestFullscreen`, then detaches.

## Adding a transport

One class implementing `Transport` on each side, and one line in each candidate
list (`apps/controller/src/lib/transports/registry.ts`,
`RelayForegroundService.bootstrap()`, and the extension's `offscreen.ts` if it
applies to browsers). Commands, UI and the execution chain must not change —
if they have to, the abstraction has been broken.

## Adding a command

1. A case in `Command` in `messages.ts` and in `core/Protocol.kt`.
2. A recipe entry in `recipes.json` if it needs an app-specific route.
3. A method on `RelayClient` and a control on the remote.
4. A vector in `vectors.ts`, pasted into `CodecTest.kt`.

Future operations (volume, opening an app, navigation) are all
`performGlobalAction`, `dispatchGesture` or a Shizuku key event: they fit the
existing chain.
