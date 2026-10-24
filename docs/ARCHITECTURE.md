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

### Starting a player kept behind a cover (browser)

Some sites show only a poster until a person clicks it: on AnimeWorld the page
has `#player-cover` inside `#player`, and clicking it (a plain DOM click is
enough) swaps in `#player-iframe`, a same-origin frame
(`/api/episode/serverPlayerAnimeWorld?id=…`) with the `<video>`. Until then
there is nothing to play, seek or put in fullscreen. A `start` plan per site
(schema and pure logic in `src/start.ts`) names the control and the player frame:

```json
"animeworld.ac": { "start": {
  "paths": "^/play/",
  "click": "#player-cover",
  "player": "^https?://(www\\.)?animeworld\\.[a-z]+(:\\d+)?/api/episode/"
} }
```

Before `playback.*` and `fullscreen.enter` (never before `nav.*`, status or
`fullscreen.exit`), the worker looks at the tab the command would go to (the
focused one if no tab has a video). If that page has a start plan and the site's
player is not the target, it clicks the control in the top frame, waits up to
`waitMs` (6 s by default) for a video in a frame that had none before or that
matches `player`, and runs the command there. `playPause` with no `play` then
means play, and the ack says the player was started. Tabs the page opened during
the click (ad popups, by `openerTabId`) are closed and focus goes back to the
page. `player` matters beyond starting: ad banners on the same page play videos
of their own, so in a tab where the player frame has a video, that is the only
candidate. Without a control, a command fails with a clear message instead of
driving the ad. A player in an iframe means the top document holds the
fullscreen element, so fullscreen state and `fullscreen.exit` go to the top
frame.

## The skip panel (browser)

The extension can skip on its own, with no phone and no server: an overlay in one of four selectable
styles, keyboard shortcuts, and a Skip card in the popup (shown from
the first open, before any pairing). It adds no executor and no
transport. Every jump is the same `playback.seek` the phone sends, handed to the
worker's existing `execute()`, so the tab and frame pick, the start plans and
the Netflix `seekApi` apply unchanged. The phone and the panel can be used at
the same time; the panel never goes through the offscreen document, so it
touches neither signatures nor the dedupe window, and a jump made at the
keyboard shows up in the next `device.status`.

- **Logic** (`src/panel.ts`, no DOM, no `chrome.*`, unit-tested): settings and
  their normalisation, preset helpers, key combinations, conflict checks.
  Jump amounts are parsed and labelled by `@relay/protocol`'s `jump.ts`, the
  same code as the controller's seek pad.
- **In the page** (`src/overlay.ts`, started by the content script in every
  frame) is what every style shares: the settings, the shortcut handler,
  Alt + scroll, finding the video's visible rectangle, moving into the
  fullscreen element when there is one that can hold children (not a bare
  `<video>`), a centred note for messages, and the one-time tip. Buttons never
  take focus, so the player's own keys keep working. A style is one module in
  `src/styles/` implementing `StyleDef` (`styles/types.ts`): its markup and CSS
  go in the shared Shadow DOM, and the core calls its view with where the video
  is and what just happened. Adding a style is one module and one line in the
  `STYLES` table, plus a name in `panel.ts`; nothing else changes.
- **The four styles**, chosen in the popup (default `pills`), all of them
  answering the same shortcuts and reduced-motion aware:
  - `pills`: back on the video's left edge, forward on the right, vertically
    centred like a mobile player's double-tap zones. They slide in when the
    pointer moves over a video of at least 240×135 px and out after 2.6 s of
    rest. Hovering one shows the amounts either side, to click or scroll
    through, so the amount is discoverable without being told. A jump floats
    its number up beside the pill; quick repeats add up (+30s, +1m).
  - `dock`: one slim tab on the right edge; hovering it opens a card with back,
    forward and every amount as a chip.
  - `gesture`: nothing on the video. Alt + scroll skips (one notch is one
    jump, a trackpad's small steps add up), Shift + Alt + scroll changes the
    amount, holding Alt shows a guide, and a large number ticks up in the
    middle.
  - `timeline`: nothing on the video either; after a jump a bar glides in
    along the bottom with a marker travelling from where the video was to where
    it landed, both times and the total. Alt + scroll works here too.
  The first time a style is seen, a short tip says how it works (at most three
  times, never again once the person has used a shortcut, the picker or the
  gesture; picking a style starts it over).
- **Settings**: `chrome.storage.local` key `panel`, apart from `settings`, so
  saving them never restarts the transports. Presets, selected amount, overlay
  on/off, shortcuts on/off, toast, the shortcut for each action, and a list of
  hosts where the panel stays away.
- **Shortcuts** are stored as `KeyboardEvent.code` combinations, so they mean
  the same key on any layout. Defaults are `Alt+Shift+←/→` (jump),
  `Alt+Shift+↑/↓` (change the amount) and `Alt+Shift+S` (pill on/off). A
  combination must carry Alt, Ctrl or Meta, so nothing the panel answers can
  clash with a site's bare keys or fire while typing; `Ctrl+Alt` is flagged
  (AltGr on many layouts) and so are the browser's own. Combinations a site
  binds with a modifier are data: `keys` in `sites.json`, shown as a warning in
  the recorder. A handled key is stopped (`stopImmediatePropagation`) so the
  site never also acts on it.
- **Trust**: a content script may only ask the worker for `playback.seek`.
  Fullscreen goes through the debugger, and nothing a page's frame says reaches
  that.

### The popup and the language (browser)

The popup is three tabs, remembered between openings: **Skip** (what commands
would go to, the skip card, a one-time "New" note), **Phone** (connection status,
last command, pairing QR, paths, relay and broker; before pairing, the setup
card) and **Settings** (look and control with the four style cards and the
toggles, the shortcut recorder, updates and the about text). The Phone tab
carries a status dot, so the connection is visible from every tab. The header, the
tabs and the footer stay put and what is between them scrolls inside its own
themed scrollbar (a slim thumb in the gutter, accent-coloured on hover) with soft
fades at the edges that have more to show; the popup never scrolls as a page. The relay
address is optional in setup: the public MQTT broker works as shipped.

The language is the extension's own setting (EN | IT in the header), kept under
its own storage key `language` and English by default whatever the browser says,
like the apps. `chrome.i18n` can only follow the browser, so `src/i18n.ts`
bundles both `public/_locales` catalogs and looks messages up by hand; the
popup and the on-video panel (a content script) both use it and follow a change
live. Only the name and description in the manifest still follow the browser
(Chrome reads those itself). `i18n.test.ts` fails when a message is missing from
either language, when its `{placeholders}` differ, or when the code asks for a
message that does not exist.

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

- In Chrome, `ACTION_CLICK` works on an entry with zero bounds and on the
  site's "Precedente"/"Successivo" TextViews although they are not marked
  clickable; no scrolling into view is needed. In Brave 1.97 the same action is
  accepted and does nothing; a real tap at the node's centre works. So every
  press is *verified*: the methods in the package's `press` list (default
  `["click", "tap"]`, Brave `["tap", "click"]`) are tried in order, each given
  2 s to show its effect (another episode or another address in the bar) before
  the next. A tap scrolls the node into view first (`ACTION_SHOW_ON_SCREEN`);
  a node that stays off screen cannot be tapped. The ack names the method that
  worked; a press with no visible effect answers "Could not open episode".
- AnimeWorld opens an ad popup tab on **every** click. A link click navigates
  the page underneath anyway; a button click was swallowed by the popup (page
  unchanged) at least once. So after any click the receiver watches for a tab
  whose address the plan does not cover (or another app in front) and presses
  Back once, which closes Chrome's popup tab and returns to the opener.
- Every step waits for its effect, closing popups on the way, and answers
  within 4.5 s (the controller gives up at 6 s). A press that brought only a
  popup is repeated once with the same method before the next method is tried,
  so a slow but real click is unlikely to be doubled by a tap.
- At either end, and on a `goto` whose label no longer matches `items[index]`,
  the receiver refuses before clicking anything.

Limits: Chrome and Brave (both from dumps on the emulator; Brave's WebView node
has no title text, so its plans match on the address bar only). A popup that
opens *behind* the page (seen once, a "Loading…" tab) is not closed. The status
loop walks the browser's tree every 3 s while a plan applies (~1000 nodes,
~25 ms on the emulator).

### Starting a player kept behind a cover (Android)

Same problem as in the extension (AnimeWorld shows only `#player-cover` until a
person presses it; then `#player-iframe` holds a native `<video controls>`,
paused), solved through the accessibility tree. Data: a `start` section next to
`nav` under the browser's package in `recipes.json`; logic in
`recipes/PlayerStart.kt`, unit-tested in `PlayerStartTest`:

```json
"start": { "urlBarViewIds": [":id/url_bar"], "sites": [{
  "site": "animeworld",
  "url": "^(https?://)?(www\\.)?animeworld\\.[a-z]+/play/",
  "title": " - AnimeWorld$",
  "control": { "viewIds": ["player-cover"], "climb": 2 },
  "press": ["tap", "click"],
  "notStarted": { "viewIds": ["player-cover"] },
  "started": { "viewIds": ["player-iframe"] },
  "play": { "labels": ["play"], "within": "player-iframe" },
  "waitMs": 5000
}] }
```

Pages are matched like nav plans. A matcher takes `viewIds` (a bare HTML id is
exact, one with `:` a suffix), `labels` (whole text or description, any case),
`contains` (substring) and `within` (an ancestor's HTML id), and only looks
inside the WebView. From the dump: before, a `TextView` with id `player-cover`;
after, `player-iframe` > `player` > `video-player` > Buttons `play`, `mute`,
`enter full screen` (the frame's document is not a WebView node of its own).

`ExecutorChain` runs a prepare step, `AccessibilityExecutor.ensurePlayer`,
before `playback.*` and `fullscreen.enter` (not `nav.*`, status,
`fullscreen.exit`, or an explicit pause). When the page in front has a plan and
`notStarted` matches (and `started` does not), it presses `control` (verified
press as for navigation, popups closed; the plan's own `press` overrides the
package's: in Chrome an `ACTION_CLICK` on the cover opens the ad popup but never
the player), waits up to `waitMs` for `started`, and then:

- `playPause` (play unset or true): presses the player's `play` button too,
  believed once that button stops saying "play", and answers "Started the player
  and playback" without running the command (a toggle would pause it again).
- anything else: runs the command, its ack prefixed with "Started the player".
- On a started page whose `play` button is visible, `playPause` presses it.

Media sessions are deliberately not consulted: on the emulator Chrome held one
(from another tab) while the page in front still showed its cover. The cost is
one tree walk per such command, only on a browser with a plan. Nothing is
started after `nav.*`.

## Logs

Every app keeps its own log on the device, so a person can send it to the
developer without a cable. Same shape everywhere: one line per command (what was
asked, over which path, which layer acted, how long it took), path state changes,
service lifecycle, and crashes. Where to find the button: receiver, the
*Diagnostics* card; controller, *Settings → Diagnostics → Report a problem*;
extension, *Settings → Report a problem* (copy, or save as a file).

- **Receiver** (`core/AppLog.kt`): drop-in for `android.util.Log`, so call sites
  read the same. Debug and up go to `files/log/skipper.log`, which rotates at
  256 KB and keeps one older file; verbose lines (the status loop) stay in logcat.
  An uncaught exception is written before the process dies. Shared through the
  system share sheet with a header (version, device, grants).
- **Controller** (`lib/log.ts`): newest 600 lines in AsyncStorage, written a moment
  after the last one, immediately on a crash. Captures the global error handler
  and `console.warn/error`.
- **Extension** (`src/log.ts`): the worker and the offscreen document each write
  their own storage key and the popup merges them by time, so two contexts never
  overwrite each other.

**Report on GitHub.** Each app also has a button that opens a prefilled
`issues/new` link: title `[app version] `, a "What happened?" placeholder, the
details (app, version, device, language, receiver grants or path states) and the
newest log lines, all in English whatever the app language. It needs no token
and no server, so nothing secret ships in an app and the person submits from their
own account. A URL holds only about 8 KB, so the newest ~60 lines are cut until
the link fits (`MAX_ENCODED_BODY`), and the full report is put on the clipboard
for pasting. Code: `packages/protocol/src/issue.ts` (controller, extension) and
its Kotlin twin `core/IssueReport.kt`; both are unit-tested.

The pair code, its secret and its room are registered with `hide` / `hideFromLog`
as soon as they are known and replaced by `‹hidden›` in every line, so a log can
be pasted into a public issue. Nothing is uploaded: sharing is the person's act.

## Why a fullscreen command used to take seconds (Android)

Almost all of it was the accessibility tree. Each `getChild` is a binder call into
the browser, and a web page is a thousand nodes: one walk measured 2.7 s on the
emulator, and one command made several (the start check, the fullscreen state
twice, the control twice, then the state again to verify). Now the walk asks for
descendants to be prefetched with the child (`FLAG_PREFETCH_DESCENDANTS_DEPTH_FIRST`,
Android 13+; the same 1280-node walk took 28 ms), the fullscreen state and the
control are each found in one pass, and the verify step polls every 100 ms and
returns as soon as the state flips instead of waiting a fixed 700 ms. What is left
is the player's own load after the cover is pressed, which is the site's.

## Adding a command

1. A case in `Command` in `messages.ts` and in `core/Protocol.kt`.
2. A recipe entry in `recipes.json` if it needs an app-specific route.
3. A method on `RelayClient` and a control on the remote.
4. A vector in `vectors.ts`, pasted into `CodecTest.kt`.

Future operations (volume, opening an app, navigation) are all
`performGlobalAction`, `dispatchGesture` or a Shizuku key event: they fit the
existing chain.
