# Shizuku

[Shizuku](https://shizuku.rikka.app) lets an app run a few things with the
privileges of `adb shell`, without root. Relay uses it as an **optional third
executor**, after MediaSession and Accessibility.

## What it adds

- **Key events into the foreground app.** `KEYCODE_ESCAPE` leaves a web
  player's fullscreen in Chrome and Brave; a site's own shortcut (`f` on
  YouTube) enters it.
- **Taps and rotation with no accessibility service at all.** Fullscreen keeps
  working under Android 17's Advanced Protection Mode or when Restricted
  Settings block accessibility for a sideloaded app.
- **The foreground app from the activity manager**, when accessibility is not
  there to report it.

## What it costs

- Shizuku must be started by you: over wireless debugging on the phone itself
  (Android 11+), or from a computer with `adb`.
- **It has to be restarted after every reboot.** For a receiver meant to run
  for weeks unattended, that is the main drawback — and why the chain never
  depends on it.
- A mid-2026 compatibility problem with Android 17 was reported upstream. If
  Shizuku doesn't start on your device, Relay simply keeps using the other two
  executors.

## Setting it up

1. Install Shizuku from its website or Google Play.
2. Open Shizuku once, then start it: Shizuku app → *Start via Wireless
   debugging* (Android 11+), or from a computer — the only way on Android 10
   and older — run the starter bundled in the Shizuku APK (use `x86_64` on an
   emulator, `arm64` on most phones and tablets, `arm` on 32-bit ones):

   ```bash
   DIR=$(adb shell pm path moe.shizuku.privileged.api | sed 's/package://; s/base.apk//' | tr -d '\r')
   adb shell "${DIR}lib/arm64/libshizuku.so"
   ```
3. On the receiver, open Relay and tap **Shizuku: concedi il permesso**, then
   allow in Shizuku's dialog.
4. The status card on the receiver shows *Shizuku pronto*, and the remote's
   diagnostics list `Shizuku` among the executors.

## How it is built

- `shizuku/ShellService.kt` runs inside a process Shizuku starts with shell
  privileges, reached over AIDL (`IShellService.aidl`). It takes an **argv, never
  a command line**: nothing goes through `sh -c`.
- `actions/ShizukuExecutor.kt` only builds fixed templates: `input keyevent
  KEYCODE_*` (validated by a regex), `input tap <x> <y>` (integers), `settings
  put system user_rotation 0|1`, `dumpsys activity activities`. A recipe can name
  a key code; it can never name a command.
- An injected key "succeeds" whether or not the page reacts, so each step is
  judged by the recipe's `fullscreenMarkers` when accessibility can read the
  screen, and reported as *non verificato* when nothing can.

## Verified

On the emulator (Android 14, x86_64) with Shizuku 13.6 started over `adb` and
accessibility disabled: `fullscreen.exit` via `KEYCODE_ESCAPE` leaves Chrome's
fullscreen video and stays on the page. See [STATUS.md](STATUS.md).
