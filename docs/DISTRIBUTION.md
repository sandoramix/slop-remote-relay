# Distribution and platform constraints

None of these are paperwork: each can make the receiver unusable on a specific
device. Worth reading before investing time in fullscreen on a new phone.

## 1. Restricted Settings (Android 13+)

A sideloaded app cannot enable Accessibility or Notification access until the
user goes through *App info → ⋮ → Allow restricted settings*. Some heavily
modified ROMs don't show that entry at all. Then there are two ways out:

- grant both from a computer:

  ```bash
  adb shell settings put secure enabled_accessibility_services \
    dev.sandoramix.skipper.screen/dev.sandoramix.skipper.screen.service.RelayAccessibilityService
  adb shell settings put secure accessibility_enabled 1
  adb shell cmd notification allow_listener \
    dev.sandoramix.skipper.screen/dev.sandoramix.skipper.screen.service.RelayNotificationListener
  ```

- or install through an installer that uses `PackageInstaller.Session`, which
  registers the app as not sideloaded.

## 2. Advanced Protection Mode (Android 17)

With it on, the system blocks apps that aren't classified as accessibility tools
from using the API and revokes it from those that have it. It is off by default,
but if the owner of the receiver turns it on, fullscreen through accessibility
stops working.

Seeking keeps working: it goes through notification access, which APM leaves
alone. And fullscreen can come back through [Shizuku](SHIZUKU.md). That is the
practical reason the execution chain has three independent layers.

## 3. Google Play: not an option

`isAccessibilityTool` may only be declared by services designed to assist people
with disabilities. Relay isn't one, and declaring it would be a false
statement. In practice: distribution by sideload (GitHub Releases) or an
internal channel, never the Play Store.

## 4. Developer verification

From 30 September 2026, apps must be registered by verified developers to
install normally on certified devices in Brazil, Indonesia, Singapore and
Thailand; a global rollout is planned for 2027. Unregistered apps remain
installable over ADB or through the advanced flow, which adds a mandatory wait.

Nothing changes in Italy today. Registering a free limited-distribution account
early removes future friction. Worth re-checking for the EU, where the DMA may
change the picture.

## 5. The silent killer: manufacturer autostart

Not a Google policy, but the most common reason a receiver stops answering after
a night on the charger. Xiaomi, Oppo, Vivo, Huawei and Samsung each kill
background services by their own rules, each behind a different screen. Step 6
of the receiver's permission list opens *App info*, from which it is reachable
on all of them.

## 6. The browser extension

The extension is loaded unpacked (Developer mode) or can be published to the
Chrome Web Store. It asks for `<all_urls>` to find videos on any page, and for
`debugger` for fullscreen. `debugger` cannot be an optional permission —
Chrome silently drops it from optional_permissions — so it is requested at
install. Store reviewers treat it strictly, so a listing would need to explain
it clearly.

For the store, build with `npm run zip:store -w @relay/browser-extension`. It
writes `skipper-chrome-web-store-<version>.zip` (every release has one) without the manifest's `key`
(the store rejects the field and assigns its own id) and without the `alarms`
permission, which only the GitHub update check uses. A store install is
recognised at runtime by the `update_url` Chrome adds to its manifest, and then
skips the GitHub update check and banner. The privacy policy the listing needs
is `pages/privacy.html`, published at
<https://sandoramix.github.io/slop-remote-relay/privacy.html>.
