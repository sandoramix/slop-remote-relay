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
`apps/receiver-android/app/src/main/java/dev/sandoramix/skipper/screen/core/`.
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
worker briefly attaches the debugger (a required permission: Chrome does not
allow `debugger` as an optional one) and sends either a
real key press (the site's own shortcut, from `sites.json`) or a
gesture-flagged `requestFullscreen`, then detaches.

## Adding a transport

One class implementing `Transport` on each side, and one line in each candidate
list (`apps/controller/src/lib/transports/registry.ts`,
`RelayForegroundService.bootstrap()`, and the extension's `offscreen.ts` if it
applies to browsers). Commands, UI and the execution chain must not change —
if they have to, the abstraction has been broken.

## Navigating a series (browser)

`nav.step` and `nav.goto` move through episodes; the status carries a `nav`
block (current, prev/next available, and the full list when the controller asks
for it with `includeNavItems`). Which sites support it is data: a `nav` plan per
site in `apps/browser-extension/src/sites.json` (schema in `src/nav.ts`):

```json
"animeworld.ac": { "nav": {
  "paths": "^/play/",
  "items": ".server.active ul.episodes li.episode a",
  "label": "data-episode-num",
  "current": ".active"
} }
```

`items` selects *every* entry in order, including those a "1 - 50" range tab
hides, so long series need nothing special. A site with no list to read can name
its own buttons instead (`"next": "...", "prev": "..."`). Read the selectors off
the real page, never guess them.

## Navigating a series (Android)

Same ops, same `nav` status block, read through the accessibility tree of the
browser instead of the DOM. Still data: a `nav` section under the browser's
package in `recipes.json`, one plan per site (schema and logic in
`recipes/Navigation.kt`, unit-tested on plain node snapshots in
`NavigationTest`; `AccessibilityExecutor` only flattens the tree and clicks):

```json
"com.android.chrome": { "nav": {
  "urlBarViewIds": [":id/url_bar"],
  "sites": [{
    "site": "animeworld",
    "url": "^(https?://)?(www\\.)?animeworld\\.[a-z]+/play/",
    "title": " - AnimeWorld$",
    "current": "Episodio (\\S+)",
    "currentNode": "episode-comment",
    "list": "animeId",
    "ranges": "^(\\d+) - (?:.* - )?(\\d+)$",
    "prev": "Precedente$",
    "next": "Successivo$"
  }]
} }
```

What the tree offers, from `uiautomator dump` on the emulator (Chrome exposes
web content only while an accessibility service is on, which ours is):

- **Which site.** `url` is matched against the address bar
  (`com.android.chrome:id/url_bar`, text like
  `animeworld.ac/play/chainsmoker-cat-ita.quc1Q/HL20PjNyUr`). Chrome drops its
  toolbar from the tree as soon as the page scrolls, which is exactly while a
  video is watched, so `title` is matched against the page title (the text of
  the `android.webkit.WebView` node) when the bar is absent.
- **Which episode.** The site's `.active` class is not exposed. `current` is a
  regex whose group 1 is the label, read from the element with HTML id
  `currentNode` (Chromium reports HTML ids as `viewIdResourceName`, bare) and
  else from the title. The node matters: the site's own previous/next buttons
  switch episode in-page and rewrite the address but **not the title** (seen:
  title "Episodio 901", address and comments tab on 900).
- **The list.** Every clickable node with a content description under the
  element whose id is `list`, in tree order (= DOM order); the label is the
  content description ("1".."11"). Off-screen entries are in the tree with
  bounds `[0,0][0,0]`.
- **Long series.** Only the *active* range is in the tree (One Piece at 937:
  901–938 only; 907 is genuinely missing on the site), and the range tabs are
  one merged TextView ("1 - 5051 - 100…901 - 938"), not individually
  clickable. `ranges` reads the ends of the whole series from that text, so
  `hasPrev`/`hasNext` stay right at a range boundary. On Android `items`,
  `index` and `count` describe the active range only — unlike the extension,
  which lists the whole series.

**How a step is made.** The neighbouring entry's link first; the site's own
button (`prev`/`next`, matched on node text, e.g. "? Precedente") only when the
neighbour is in a hidden range. Measured, not assumed:

- `ACTION_CLICK` works on an entry with zero bounds and on the site's
  "Precedente"/"Successivo" TextViews although they are not marked clickable;
  no scrolling into view is needed. (A refused click falls back to
  `ACTION_SHOW_ON_SCREEN` and a real tap at the node's centre.)
- AnimeWorld opens an ad popup tab on **every** click. A link click navigates
  the page underneath anyway; a button click was swallowed by the popup (page
  unchanged) at least once. So after any click the receiver watches for a tab
  whose address the plan does not cover (or another app in front) and presses
  Back once, which closes Chrome's popup tab and returns to the opener.
- A link step answers at once (tens of ms) and closes the popup in the
  background. A button step waits until the page shows a different episode,
  presses again once after closing a popup, and answers within 4.5 s (the
  controller gives up at 6 s); if the page has not settled by then it answers
  ok with "unverified".
- At either end, and on a `goto` whose label no longer matches `items[index]`,
  the receiver refuses before clicking anything.

Limits: Chrome only. Brave has no nav plan because its tree has not been dumped
on a device; add one from a dump, never by analogy with Chrome. A popup that
opens *behind* the page (seen once, a "Loading…" tab) is not closed. The status
loop walks the browser's tree every 3 s while a plan applies (~1000 nodes,
~25 ms on the emulator).

## Adding a command

1. A case in `Command` in `messages.ts` and in `core/Protocol.kt`.
2. A recipe entry in `recipes.json` if it needs an app-specific route.
3. A method on `RelayClient` and a control on the remote.
4. A vector in `vectors.ts`, pasted into `CodecTest.kt`.

Future operations (volume, opening an app, navigation) are all
`performGlobalAction`, `dispatchGesture` or a Shizuku key event: they fit the
existing chain.
