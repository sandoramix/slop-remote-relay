# Status — start here

Updated 2026-10-19. Main branch `master`; first release `v0.2.0`.

This file lets a new session pick up without rereading everything: what is
verified, how to reproduce it, and what is still open.

## What is verified, and how

| Area | Verified | How |
|---|---|---|
| Protocol, both languages | yes | canonical vectors in `CodecTest` (TS ↔ Kotlin), including the nav ops and status block |
| Failover manager | yes | unit tests: user order wins at startup, instant failover, promotion after sustained health, mirror |
| Shared transports | yes | live relay: WS, HTTP (incl. cross-channel and same-channel routing), WebRTC over libdatachannel; MQTT against broker.hivemq.com |
| Android receiver, every remote path | yes, emulator | `smoke:paths`: relay WS, HTTP, MQTT, WebRTC — 12/12 |
| Android receiver, protocol behaviour | yes, emulator | `smoke`: signatures, dedupe, forged/stale frames, mirror — 21/21 |
| Controller app | yes, emulator | release APK: pairing via deep link, "Wi-Fi locale" + standbys, `+30s` acked "via Accessibilità", path order persisted across restart |
| Fullscreen in Chrome (Android) | yes, emulator | HTML5 `<video>`: six toggles in a row, enter via the page's button, state detected, exit via Back |
| Shizuku executor | yes, emulator | Shizuku 13.6 started over adb, accessibility off: exit fullscreen via `KEYCODE_ESCAPE` |
| Browser extension | yes, Chrome for Testing | `smoke:extension` over relay WS, HTTP, WebRTC — status, seekTo, pause, fullscreen in (CDP) and out; a tab already open when the extension is (re)installed is still found and driven — 35/35 with the nav and cold-player sections |
| Episode navigation (browser) | yes, Chrome for Testing | `smoke:extension`: next, previous, goto into a hidden range, stale list refused, last episode, on markup shaped like AnimeWorld's (the plan was read from the live site, the test page imitates it) |
| Starting a covered player (browser) | yes, Chrome for Testing + live site | `smoke:extension`, on a page imitating AnimeWorld (cover that inserts the player iframe after 800 ms and calls `window.open`; a cross-origin ad iframe playing a video): from a cold page `playPause` starts and plays, `seekTo` and `fullscreen.enter` start and act, the popup tab is closed, a later pause reaches the player and not the ad, status reports fullscreen of the iframe, toggle leaves it, `nav.step`/`fullscreen.exit`/status do not start it, a page without the control fails clearly. Live `animeworld.ac` (Chainsmoker Cat ep 11, headless Chrome for Testing, built extension, commands sent to the worker from an extension page, not over a transport, no autoplay flag): cold status kept title and nav; cold `playPause` → started and playing; pause; `seekTo` 30 s / 60 s; cold `fullscreen.enter` → `#player-iframe` fullscreen; exit; `nav.step` did not start it. No popup opened on the live site in those runs, so closing a real ad popup has been seen only on the test page. Not run in a headed, everyday Chrome profile, where autoplay rules may refuse an unmuted `play()`. 7 unit tests in `start.test.ts` |
| Skip panel (browser): four styles, shortcuts, popup card | yes, Chrome for Testing (popup: looked at, picker clicked in the smoke test) | `smoke:extension`, 55 checks on the test page, with a phone connected over relay WS. **Shared:** `Alt+Shift+→/←` jump by the selected amount, quick jumps add up in the number shown, a bare arrow is left alone, `Alt+Shift+↑` picks the next amount and saves it, the phone's `device.status` shows the position after a keyboard jump and its `seekTo` still works, in fullscreen the panel sits inside the fullscreen element, `Alt+Shift+S` switches it off, a host on the off list and "shortcuts off" ignore the keys, a shortcut pressed in the page jumps the video in a player iframe. **Pills (default):** both slide in on pointer movement, the right one 14 px from the edge and vertically centred, a click jumps and floats the number, hovering shows the amounts either side and clicking one selects it, the wheel changes the amount, they slide away by themselves. **Tip:** shown the first time in the style's words, counted, taken away for good by using a shortcut, not shown a fourth time. **Dock:** only the tab shows, hovering opens the card, its forward button jumps, a chip selects an amount, it closes by itself. **Gesture:** nothing drawn until Alt is held, Alt shows the guide, Alt + scroll up/down skips forward/back and ticks the number (one notch = one jump), Shift + Alt + scroll changes the amount, the guide goes when Alt is released. **Timeline:** nothing until a jump, then the bar with both times and the total and the marker at the landing point, it leaves by itself, Alt shows it with a hint, Alt + scroll skips. **Amounts:** `parseJump` now reads hours, minutes and seconds together (`1h30m30s`, `1h 30m`, `90m`, `2 ore 5 minuti`, `1h30` = 1 h 30 min), each unit once and in any order, still `1:30` / `1:30:30` as clock forms, and refuses zero, more than a day, a repeated or unknown unit; labels use the same units as typing (`1m30s`, `1h30m`, `1h30m30s`); 23 unit tests including that every label reads back as the same amount, and typing `1h30m30s` in the popup was checked in the smoke test. The controller uses the same parser (typechecked, not run on a device). **Popup:** "Restore default amounts" in the Skip card asks before it replaces the saved amounts, Cancel keeps them, confirming restores 10s, 15s, 1m, 1m30s, 5m, 10m; three tabs (the last one used is remembered), the content scrolling inside its own area with the header, tabs and footer fixed (the themed scrollbar and edge fades were looked at in a headed Chrome window; headless hides scrollbars), four style cards, picking one saves it and restarts its tip. **Language:** the popup starts in English whatever the browser says, EN | IT switches it and is saved, survives a reload, and the tip on the video turns Italian too without reloading the popup; `i18n.test.ts` checks both catalogs have every message with the same placeholders and that every message the code names exists. The Italian wording itself has not been read by a native speaker. Also screenshots of each style, looked at. 16 unit tests in `panel.test.ts`, 3 in `i18n.test.ts`, (settings, picker neighbours, tip limits, running totals, positions and landings), 3 in `jump.test.ts` (the parser moved from the controller to `@relay/protocol`; the controller re-exports it and typechecks). **Relay optional:** in a fresh Chrome profile with the relay field empty, setup finishes, the Skip card and settings are visible before setup, and the MQTT path comes up against the public broker. **Not verified:** any real site (YouTube, Netflix, Twitch, Prime): the `keys` lists in `sites.json` come from the sites' public shortcut documentation, and whether any site uses Alt + scroll is unchecked; the shortcut recorder was never clicked through; Italian strings not seen; animations were judged from screenshots and state checks, not by eye in a headed browser; a mouse wheel's notch size on Linux and macOS (the threshold of 50 is a guess from Chromium's usual values); trackpad scrolling; a phone controlling the extension over MQTT alone; the content-script guard (only `playback.seek` from a page) has no test. **Known limits:** a video of 240×135 px or more in any frame gets the panel, so an ad banner that size does too; the pills and the dock sit over the video's edges and can cover a site's own controls there; when the fullscreen element is a bare `<video>` the panel cannot be drawn (the keys still work); a jump goes through the worker (a few tens of ms slower than seeking in place, on purpose, to keep one logic); in a page whose player is an iframe, feedback is drawn only by the frame that holds the video |
| Browser guide, screenshots, store images, logo | partly | **Guide** (`pages/extension.html`, plus the browser step on `index.html` and the README): written against the behaviour above; rendered locally and read through, not published (the Pages workflow has to run). **Screenshots and store images** are generated from the real build by `tools/extension-assets.ts` (the popup in each tab and state, each skip style on a video, the five store screenshots and both promos); every one was looked at, and a first-use tip squeezed into a one-word-wide column was found that way and fixed (a smoke check now measures it). The sample video is Big Buck Bunny, CC BY 3.0, streamed from the Internet Archive and credited on the images that show it. The phone half of two store images is the existing screenshot of the controller (taken on a device earlier; its amounts predate the new defaults). **Logo:** one drawing in `tools/make-icons.mjs` (a timeline with an arc leaping the gap to the playhead), rendered to the extension, controller and splash icons; looked at from 1024 px to 16 px on dark and light, not seen on a phone launcher or in a store listing. The controller's iOS icon pointed at the Expo template's default icon and now uses the same `icon.png`: not built. **Relay optional, end to end:** a browser with the relay field empty answers status and seeks over the default public MQTT broker alone (`smoke:extension`, skipped when the broker is unreachable). The controller's onboarding used to refuse a browser without a relay; that block is gone (typechecked, not run on a device, not built) |
| AnimeSaturn and AnimeUnity (browser nav plans) | selectors read from live HTML only | `sites.json` entries. **AnimeSaturn** `/anime/<slug>/ep-N`: 138 `a.ep-tile[data-watch-link]` tiles in the server-rendered HTML (all ranges present), current is `.is-current`; the regex was tested on a real path. **AnimeUnity**: Vue renders the list client-side with no hrefs and only the current 1–120 range, so the plan uses the page's own buttons `#video-bottom a.episode.next` / `.prev` (class names read from the site's `app.js`, buttons absent at either end). **Not verified:** no click was run on either site (a headless probe hung on AnimeUnity), no `smoke:extension` run, no phone; AnimeUnity has no `current`/`items` so the controller list is not offered there; no start plan (neither site covers its player); the Android receiver has no recipe for either (needs `uiautomator dump` from a device) |
| Episode navigation (Android, Chrome) | yes, emulator | Nexus10_34, Chrome on the live animeworld.ac, via `npm run send` over LAN: status `nav` on Chainsmoker Cat ep 11 (current 11, index 10, count 11, items only with `includeNavItems`); `nav.step -1` → 10 and `+1` → 11 (address and status confirmed); `+1` at 11 refused "Already at the last episode"; `goto` with a wrong label and an out-of-range index refused; `goto` 851 on One Piece; One Piece range crossing both ways through the site's button (901 → 900 → 901, address confirmed), then a link step 900 → 899; ad popup tab closed by Back after each click; with accessibility off the step answers "needs the accessibility service" and `nav` disappears from status. 10 unit tests in `NavigationTest` |
| Brave (Android): fullscreen, nav, start | yes, emulator (fullscreen, nav, start) | Brave 1.97.56 (Chromium 155, `BraveMonox64.apk` from the GitHub release) on Nexus10_34, Shields at default (up), via `npm run send` over LAN. **Fullscreen:** the existing recipe's label `enter full screen` matches; `fullscreen.enter` → status `fullscreen: true` (only `exit full screen` and a snackbar left in the tree, `url_bar` gone), `fullscreen.exit` (Back) → false, toggle in and out; `absentViewIds: [":id/url_bar"]` added to Brave's markers from those dumps. **Dumps:** address bar `com.brave.browser:id/url_bar`, text `animeworld.ac/play/…` like Chrome; web ids identical to Chrome's (`animeId` list with content descriptions "1".."11", `episode-comment` "Episodio 11", `? Precedente`/`> Successivo`, `player-cover` → `player-iframe` > `video-player` > Buttons `play`, `mute`, `enter full screen`). Differences: the `android.webkit.WebView` node has **empty text** (no page title, so a `title` fallback can never match); the tablet toolbar did not leave the tree on scroll; no ad popup tab ever opened (Shields). With a nav plan copied from those dumps, status `nav` was right (ep 11: index 10/11; One Piece 900 → 49/50; 901 → 0/37 with the range ends read). **`ACTION_CLICK` on AnimeWorld's web elements is accepted and does nothing in this Brave** (links, `Successivo`, the cover, the play button), while a real tap works every time. So Brave's plans press by tap first (`"press": ["tap", "click"]`) and every in-page press is verified for an effect, with a fallback to the other method; see the row below for what was verified. Note the emulator's Chrome is 113: whether a current Chrome behaves like Brave here is not known |
| Starting a covered player + verified presses (Android, Chrome and Brave) | yes, emulator | Nexus10_34 (tablet), live animeworld.ac Chainsmoker Cat ep 11, receiver built from this tree, `npm run send` over LAN, notification access granted with `cmd notification allow_listener`. **Chrome 113:** cold page (`player-cover` in the dump) → `playback.playPause` → "Started the player and playback on animeworld (tap, click)", ad popup closed by Back, status `isPlaying: true` with a media session at 31 s, screenshot shows the video; then through the normal chain: pause (mediasession), seek +30 s (mediasession, position 79 s), `fullscreen.enter` (Node, status `fullscreen: true`), `fullscreen.exit` (Back), toggle while playing → pause (mediasession), toggle while paused → the page's play button. Cold page → `fullscreen.enter` → "Started the player (tap) · Node", status fullscreen true. Measured: on Chrome `ACTION_CLICK` on the cover opens the ad popup but never the player (twice), hence the start plan's own `press: ["tap","click"]`; on the play button the click works. Nav re-run with verified presses: step -1 → 10, +1 → 11, goto 3, all "click", status confirmed. **Brave 1.97.56** (entries from the brave dumps, `press: ["tap","click"]` for the package): cold `playPause` → "Started the player and playback (tap, tap)" in 4.4 s, status playing with a Brave media session; pause, seek +30 s (mediasession, 48 s), `fullscreen.enter` (true) and `fullscreen.exit` (false); `nav.step -1` → 10, `+1` → 11, `goto` 3, each "tap", confirmed by status and the address bar. **Not seen / limits:** Brave button steps (range crossing on One Piece) not rerun after the fix; after Brave's goto the ep 3 page already had `player-iframe` and no cover, not caused by the receiver (it only starts on playback/fullscreen commands), cause unknown. Timing: cold start + play took 12 s on Chrome (tree walks of 1.8–3 s while the page loads on swiftshader), past the controller's 6 s ack timeout though the action completed; cold fullscreen 6.35 s; Brave 4.4 s. The emulator process crashed twice during these runs (swiftshader, ~23 Chrome tabs open). Italian strings not seen on screen. 8 unit tests in `PlayerStartTest` |
| Episode navigation (controller UI) | typechecked only | not yet run on a device or emulator; the Android receiver now reports `nav`, so the controls should appear. **0.7.0 report: the keys were gone on a phone.** The live animeworld.ac markup and the receiver's recipe are unchanged since 0.6.1 (checked: `animeId`, `episode-comment`, `Precedente`, `Successivo` all still present), the receiver code is identical, and `app.config.ts` has `reactCompiler: true` while 0.7.0's `useSteadyNav` wrote a ref during render. 0.7.1 rewrites it with state and an effect only. The compiler is the probable cause, not proven; the fix has not been run on a device. `EpisodeNav` keeps the last `nav` for 12 s when status stops reporting one (page load) and carries the episode list over while the count is unchanged, so the keys and open list no longer vanish and reload; keys dim while stale. Not run on a device |
| Logs (receiver, controller, extension) | receiver: yes, emulator; the others: typechecked and unit-tested only | **Receiver:** on the emulator, `files/log/skipper.log` held one line per command with path, executor and time (`Fullscreen(toggle=false) via lan -> ok (accessibility, 748 ms)`), accessibility lifecycle and the player-start timings. The share sheet, the Clear button, the Italian strings and redaction of the pair code in a real log were **not** looked at. **Controller:** `lib/log.ts` typechecks; the share sheet and the Diagnostics rows were never run on a device. **Extension:** `log.ts` scrubbing and time-sort covered by 3 unit tests (35 in all pass), builds; the popup's Report a problem card was not opened, and no `smoke:extension` run. |
| Fullscreen speed (Android) | partly, emulator | Nexus10_34, Chrome 113, live animeworld.ac. One 1280-node tree walk: 2687 ms before, 28 ms with child prefetch (API 34). Warm `fullscreen.enter`: ~750 ms before (a fixed 700 ms verify wait), 210 ms after when the first ACTION_CLICK takes, ~1.1 s when it is ignored and the tap fallback runs. Cold (cover not yet pressed): 5.4 s before and 5.6–8.4 s after, almost all of it the site loading its player after the tap (`press: tap took effect after 4307 ms`), so **not** improved. Never measured on a phone or a pre-Android-13 device (no prefetch there, only the merged walks and the polled verify apply). The emulator process died once during the runs |
| In-app update, receiver | yes, emulator | against a local fake release server: silent check, unknown-sources hand-off, redirect, checksum match, system installer, in-place update 0.1.0 → 9.0.0; a wrong checksum is refused. Not seen: real GitHub release, release-build behaviour, Italian strings on screen, signing-key mismatch |
| In-app update, controller | typechecked, manifest only | permission lands in the generated manifest. Since the merge with the Skipper line there is one checker (`state/update.ts`, banner + Settings → About); its Download button runs the in-app download, SHA-256 check and system installer on Android. That path has never run on a device |
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
9. **Browsers never connected in 0.3.0 and 0.3.1.** `shared.ts` called
   `chrome.runtime.getManifest()` at load to detect a Web Store install; the
   offscreen document imports it and has no `getManifest`, so its script threw
   and no transport started. Found by `smoke:extension` (18/18 at v0.2.6, 1/14
   at v0.3.1); after the fix the popup screenshot tool showed a phone connected
   and a seek executed. The smoke test itself was not rerun.

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
- Fullscreen in the YouTube app, and Brave on a phone. The Chrome path is
  verified; the YouTube view id is not. Brave's labels were dumped on the
  emulator (tablet layout, see the table), not on a phone.
- A web player whose control bar is below the fold: Chromium prunes those nodes,
  so the recipe falls through to rotation. Seen with an oversized test video.
- Bluetooth: both sides are implemented, neither can run on the emulator. On
  real phones the controller never found the receiver. Fixed without hardware
  to test on: the controller's `BLUETOOTH_SCAN` lacked `neverForLocation`, so
  Android 12+ returned no scan results (checked in the introspected manifest);
  the receiver lacked the pre-Android-12 `BLUETOOTH`/`BLUETOOTH_ADMIN`
  permissions; and a receiver started with Bluetooth off never advertised until
  restarted. The controller also used to save the receiver's BLE address, which
  goes stale because Android advertises from a rotating private address. Now
  the receiver puts an 8-byte tag (`bleTagFromRoom`, pinned by a vector in
  `CodecTest.kt` and checked against the TypeScript side) in its service data,
  and the controller scans for it on every connect; there is nothing to set up
  in the device form. None of this has run on two real phones yet.
- Episode navigation on a phone-sized Chrome (the emulator is a tablet layout)
  and in Brave (plans shipped and verified on the emulator, pressed by tap because
  `ACTION_CLICK` does nothing on Brave's web elements; see the table). Italian error
  strings never seen on screen. A popup that opens *behind* the page is left
  open (one "Loading…" tab seen). The emulator process died once mid-test on
  the One Piece page with ~15 tabs open on swiftshader; it was restarted and
  the test passed afterwards, nothing pointed at the receiver.
- WebRTC across real carrier NAT (a TURN server is configurable in the
  controller; the receiver uses STUN only for now).
- Overnight resistance (phase 5 of the original plan).

**Needs other hardware or accounts**

- iOS controller: prebuilt and built only in CI on macOS, never run.
- Release workflow: has to run once on GitHub; the iOS job is allowed to fail.
- Skipper rename and store build: the store zip was checked to contain no
  `key`; a store install (the `update_url` check) has not been tried because the
  extension isn't in the store yet. The renamed receiver and controller ran on
  the emulator (Pixel 6 Pro, API 34): paired over local Wi-Fi from the
  `relay://pair` link.
- Controller update check: verified on an x86_64 release build of 0.3.0 on the
  emulator — banner offering 0.3.1, "Più tardi" hides it, Settings shows the
  version and "0.3.1 disponibile". The APK download itself was not installed.
  Since then the banner's strings went through i18n (English default) and its
  Download button installs in-app instead of opening the browser: not rerun.
- Receiver tablet layout: two columns at ≥ 600 dp and a 240 dp QR, checked on
  the phone emulator in portrait and with the display forced to 2560×1600 at
  320 dpi; not on a real tablet.
  After the merge with the language row and the Updates card (debug build on the
  Nexus10-sized emulator): two columns at 2560×1600, one column at 1080×2400,
  Updates card offering 0.3.2 from the real GitHub release, QR rendered beside
  the fields; no crash. Italian not looked at.
- Package ids are now `dev.sandoramix.skipper` (controller) and
  `dev.sandoramix.skipper.screen` (receiver, Kotlin packages moved to match).
  The receiver compiles and its unit tests pass; the controller's introspected
  config shows the new ids. They install as new apps: old `com.relay.*`
  installs must be removed and paired again.
- Pages site (`pages/`, `.github/workflows/pages.yml`): deployed; guide images
  checked locally at 1100 px and 390 px. The pairing page `pages/pair/` is part
  of the same site now: one Pages workflow copies all of `pages/` and keeps the
  live `altstore.json`, and the release's AltStore job copies all of `pages/`
  too. Not yet deployed in this form.
- Chrome Web Store link on the site: `pages/` carries a `__CHROME_WEBSTORE_URL__`
  placeholder that `tools/pages-fill.sh` replaces from the `CHROME_WEBSTORE_URL`
  repository variable in both deploy jobs, failing the deploy if it is unset or
  a placeholder is left. The script was run locally on a copy of `pages/` (four
  links filled, empty variable rejected), and the Pages deploy of 0.6.1 serves
  `extension.html` with both store links filled and no placeholder left.

**Known, not done**

- `Codec.verify` accepts unsigned `hello` for symmetry with `codec.ts`; the
  router ignores it, so no impact.
- The controller cannot yet scan a QR code in-app. Receiver and extension QR codes
  now encode `https://sandoramix.github.io/slop-remote-relay/pair/#…` (camera apps
  show a bare `relay://` as plain text); that page, `pages/pair/index.html`, opens
  `relay://pair?…` (an `intent://` naming `dev.sandoramix.skipper` on Android; English,
  or Italian when the browser is). **Not verified**: it needs the Pages workflow to run once on
  GitHub, and a real phone camera to scan it. Pairing by `relay://` link itself is
  verified (see above).
- The receiver has no learning mode for recording a tap coordinate on unknown
  apps, though `RecipeEngine` already reads learned recipes.
