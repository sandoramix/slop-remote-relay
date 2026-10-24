/**
 * English strings: the source of truth. `it.ts` must define every key here
 * (it is typed against this object), so a missing translation fails the build.
 * `{name}` marks a placeholder filled in by `t(key, { name: ... })`.
 */
export const en = {
  // Settings screen
  'settings.language': 'Language',
  'settings.devices': 'Devices',
  'settings.inUse': 'in use',
  'settings.addDevice': 'Add device',
  'settings.connection': 'Connection',
  'settings.paths': 'Paths and priority',
  'settings.pathsFirst': '{name} first',
  'settings.none': 'none',
  'settings.servers': 'Servers',
  'settings.noRelay': 'no relay',
  'settings.diagnostics': 'Diagnostics',
  'settings.mirror': 'Double send',
  'settings.mirrorHint': 'Every command goes out on two paths at once; the receiver runs only one.',
  'settings.remote': 'Remote',
  'settings.jumps': 'Jumps',
  'settings.haptics': 'Vibration',
  'settings.keepAwake': 'Keep screen on',
  'settings.keepAwakeHint': 'Handy if you hold the phone while watching.',
  'settings.appName': 'Skipper {version}',

  // Updates: banner on the remote and the About section
  'update.importantTitle': 'Important update: Skipper {version}',
  'update.availableTitle': 'Skipper {version} is available',
  'update.youHave': 'You have {version}.',
  'update.howIos': 'Update it from AltStore.',
  'update.howAndroid': 'Download the new APK and install it over this one: pairings and settings stay.',
  'update.whatsNew': "What's new",
  'update.releasePage': 'Release page',
  'update.download': 'Download',
  'update.later': 'Later',
  'update.downloading': 'Downloading {percent}%',
  'update.install': 'Install',
  'update.readyHint': 'The download is ready. Confirm the installation in the system dialog.',
  'update.blockedHint':
    'If the installer did not start, Android may not allow this app to install updates yet. Allow it in the system settings, come back and tap Install.',
  'update.openSettings': 'Open install settings',
  'update.downloadFailed': 'Download failed: {reason}',
  'update.installFailed': 'Could not start the installer: {reason}',
  'update.noChecksum': 'the release checksums do not list this file',
  'update.badChecksum': 'the file does not match its checksum, not installed',
  'about.title': 'About',
  'about.footer': 'Checks by itself every 12 hours. Updating is never mandatory.',
  'about.version': 'Version',
  'about.updates': 'Updates',
  'about.checking': 'Checking…',
  'about.available': '{version} available',
  'about.failed': 'Check failed',
  'about.upToDate': 'Up to date',
  'about.checkNow': 'Check now',

  // Screen titles
  'nav.diagnostics': 'Diagnostics',
  'nav.settings': 'Settings',
  'nav.transports': 'Paths and priority',
  'nav.seek': 'Jumps',
  'nav.servers': 'Servers',
  'nav.device': 'Device',
  'nav.newDevice': 'New device',

  // Common
  'common.save': 'Save',
  'common.add': 'Add',
  'common.cancel': 'Cancel',
  'common.remove': 'Remove',
  'common.yes': 'yes',
  'common.no': 'no',

  // Connection states
  'state.idle': 'idle',
  'state.connecting': 'connecting…',
  'state.connected': 'connected',
  'state.degraded': 'unstable',
  'state.failed': 'unreachable',

  // Diagnostics
  'diag.log': 'Report a problem',
  'diag.logHint': 'Sends the app log to the developer. It lists what the app did and when; it never contains your pair code.',
  'diag.logShare': 'Share log',
  'diag.logGithub': 'Report on GitHub',
  'diag.logClear': 'Clear log',
  'diag.logCleared': 'Log cleared',
  'diag.paths': 'Paths',
  'diag.noPaths': 'No active paths',
  'diag.receiver': 'Receiver',
  'diag.foregroundApp': 'Foreground app',
  'diag.mediaSession': 'Media session',
  'diag.executors': 'Executors',
  'diag.recipe': 'Recipe for the app',
  'diag.recipeGeneric': 'generic',
  'diag.battery': 'Battery',
  'diag.events': 'Events',
  'diag.refresh': 'Refresh',
  'diag.noEvents': 'Nothing yet.',

  // Executors
  'exec.accessibility': 'Accessibility',
  'exec.settings': 'Settings',
  'exec.dom': 'page',

  // Remote screen
  'remote.settings': 'Settings',
  'remote.fullscreen': 'Fullscreen',
  'remote.exitFullscreenLabel': 'Exit fullscreen',
  'remote.exitFullscreenText': 'Exit fullscreen',
  'remote.fullscreenHint': 'Press and hold to exit regardless',

  // Connection chip
  'chip.connecting': 'Connecting…',
  'chip.noPath': 'No reachable path',
  'chip.standby': '+{n} standby',
  'chip.label': 'Connection: {label}. Open diagnostics',

  // Now playing
  'now.noForeground': 'No app in the foreground',
  'now.waiting': 'Waiting for the device',
  'now.stale': ' · out of date',
  'now.playing': 'Playing',
  'now.noMedia': 'No media detected',
  'now.pause': 'Pause',
  'now.play': 'Play',
  'now.position': 'Position',
  'now.noSessionHint':
    'Jumping will use screen taps (in 10 s steps). For exact jumps, grant the receiver access to notifications.',

  // Seek pad
  'seek.custom': 'Custom jump',
  'seek.other': 'Other',
  'seek.placeholder': 'e.g. 45, 2m, 1:30, 1h30m',
  'seek.useThis': 'Use this jump',
  'seek.badFormat': 'Unrecognised format',
  'seek.anyDuration': 'Any duration, up to 24 hours',
  'seek.saveFavourite': 'Save to favourites',
  'seek.back': 'Back {amount}',
  'seek.forward': 'Forward {amount}',
  'seek.holdHint': 'Press and hold to repeat',

  // Episode navigation
  'episode.next': 'Next episode',
  'episode.prev': 'Previous episode',
  'episode.nextShort': 'Next',
  'episode.prevShort': 'Previous',
  'episode.current': 'Episode {n}',
  'episode.list': 'Episodes',
  'episode.item': 'Episode {n}',

  // Target switcher
  'target.label': 'Device: {name}. Change device',
  'target.devices': 'Devices',
  'target.browser': 'Browser extension',
  'target.android': 'Android phone',
  'target.add': 'Add device',

  // Command feedback
  'cmd.via': 'via {by}',
  'cmd.done': 'Done',
  'cmd.failed': 'Failed',
  'cmd.notConnected': 'Not connected',
  'cmd.noPath': 'No path to the device',
  'cmd.error': 'Error',

  // Client errors and log lines
  'client.noTransports': 'No usable path for this device',
  'client.singlePath': 'Only one active path: no fallback available.',
  'client.notConnected': 'Not connected',
  'client.noReply': 'No reply from the receiver',
  'client.dropped': 'Message dropped: {reason}',

  // Transports
  'transport.lan.label': 'Local Wi-Fi',
  'transport.lan.summary': 'Direct on the same network. The fastest, works without internet.',
  'transport.lan.missing': 'Local address not set',
  'transport.webrtc.label': 'WebRTC P2P',
  'transport.webrtc.summary': 'Direct between devices over the internet. The relay is only needed to open it.',
  'transport.webrtc.missing': 'The relay server is needed for signalling',
  'transport.relay.label': 'Remote relay',
  'transport.relay.summary': 'Through your relay server, over WebSocket. Works anywhere.',
  'transport.relay.missing': 'Relay server not set',
  'transport.http.label': 'Relay HTTP',
  'transport.http.summary': 'Same server, but over plain HTTP: gets through where WebSockets are blocked.',
  'transport.mqtt.label': 'MQTT',
  'transport.mqtt.summary': 'Through an MQTT broker: stays up even if your relay is down.',
  'transport.mqtt.missing': 'MQTT broker not set',
  'transport.ble.label': 'Bluetooth',
  'transport.ble.summary': 'No network needed, within a few metres of the receiver.',
  'transport.disabled': 'Disabled',
  'transport.unavailable': 'Not available',
  'transport.unavailableBrowser': 'Not available for the browser',
  'transport.bleDenied': 'Bluetooth permissions denied',
  'transport.bleNotFound': 'Bluetooth receiver not found',

  // Transports screen
  'transports.intro':
    'The first available path carries the commands; the others stay ready as a fallback. Use the arrows to change the order.',
  'transports.orderFor': 'Order for {name}',
  'transports.order': 'Order',
  'transports.footer': "The order applies to every device; paths a device doesn't support are skipped.",
  'transports.enable': 'Enable {name}',
  'transports.up': 'Move up',
  'transports.down': 'Move down',

  // Seek settings screen
  'seekSettings.favourites': 'Favourites',
  'seekSettings.favouritesFooter': 'Tap a jump to remove it. At least one always stays.',
  'seekSettings.remove': 'Remove {amount}',
  'seekSettings.add': 'Add',
  'seekSettings.duration': 'Duration',
  'seekSettings.duplicate': 'Already in favourites',
  'seekSettings.hint': 'Seconds, minutes (2m), hours (1h), mixed (1h30m30s) or mm:ss',

  // Servers screen
  'servers.relay': 'Relay',
  'servers.relayFooter':
    'Your services/relay server. Carries WebSocket, the HTTP fallback and WebRTC signalling. It never sees the key: only the room id.',
  'servers.address': 'Address',
  'servers.wsError': 'Must start with ws:// or wss://',
  'servers.mqttFooter':
    'A public broker is fine because every command is signed; it can still read them, though. For maximum privacy use your own mosquitto with WebSocket.',
  'servers.mqttBroker': 'Broker (WebSocket)',
  'servers.mqttError': 'A WebSocket endpoint is needed (wss://…/mqtt)',
  'servers.webrtc': 'WebRTC',
  'servers.webrtcFooter':
    "STUN is enough on most networks. On mobile networks with symmetric NAT you need a TURN server, otherwise the direct path won't open and the relay takes over.",
  'servers.stun': 'STUN',
  'servers.stunHint': 'Comma-separated',
  'servers.turn': 'TURN',
  'servers.turnUser': 'TURN user',
  'servers.turnPass': 'TURN password',

  // Device editor
  'device.remove': 'Remove device',
  'device.removeTitle': 'Remove the device?',
  'device.removeBody': "{name} won't be controllable from here any more.",
  'device.defaultBrowser': 'Browser',
  'device.defaultPhone': 'Phone',

  // Device form
  'form.type': 'Type',
  'form.androidTitle': 'Android phone',
  'form.androidSubtitle': 'Skipper Screen app',
  'form.browserTitle': 'Browser',
  'form.browserSubtitle': 'Chrome/Brave extension',
  'form.identity': 'Identity',
  'form.identityFooter':
    'Enter the same code in the receiver. The signing key and the room on the relay are derived from this code: keep it long.',
  'form.name': 'Name',
  'form.namePlaceholder': 'e.g. Living room phone',
  'form.nameRequired': 'A name is required',
  'form.pairCode': 'Pairing code',
  'form.codeRequired': 'A code is required',
  'form.codeWeak': 'Short code: whoever runs the relay or a public MQTT broker could guess it.',
  'form.generateCode': 'Generate new code',
  'form.copyCode': 'Copy code',
  'form.nearby': 'Nearby',
  'form.nearbyFooter':
    'Optional. Local Wi-Fi works without internet. Bluetooth needs no setup: it finds the receiver by itself when you are a few metres away.',
  'form.lanAddress': 'Local network address',
  'form.lanSearch': 'Search the network',
  'form.lanEmpty': 'No receiver found on this network',

  // Onboarding
  'onboarding.intro':
    'Skip the intro from the sofa. Your phone becomes the remote for the video playing on another screen. Pair your first device to get started.',
  'onboarding.remote': 'Remote access',
  'onboarding.footerBrowser': 'Optional. Without a relay a browser is reached over MQTT, which works as is.',
  'onboarding.footerAndroid': 'Optional. Without a relay you keep local Wi-Fi, Bluetooth and MQTT.',
  'onboarding.relayServer': 'Relay server',
  'onboarding.start': 'Get started',
};

export type TranslationKey = keyof typeof en;
