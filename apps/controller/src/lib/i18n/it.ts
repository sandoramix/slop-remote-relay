import type { en } from './en';

/** Italian strings. Typed against `en`, so a key missing here is a compile error. */
export const it: Record<keyof typeof en, string> = {
  // Settings screen
  'settings.language': 'Lingua',
  'settings.devices': 'Dispositivi',
  'settings.inUse': 'in uso',
  'settings.addDevice': 'Aggiungi dispositivo',
  'settings.connection': 'Connessione',
  'settings.paths': 'Percorsi e priorità',
  'settings.pathsFirst': '{name} per primo',
  'settings.none': 'nessuno',
  'settings.servers': 'Server',
  'settings.noRelay': 'nessun relay',
  'settings.diagnostics': 'Diagnostica',
  'settings.mirror': 'Doppio invio',
  'settings.mirrorHint': 'Ogni comando parte su due percorsi insieme; il ricevitore ne esegue uno solo.',
  'settings.remote': 'Telecomando',
  'settings.jumps': 'Salti',
  'settings.haptics': 'Vibrazione',
  'settings.keepAwake': 'Schermo sempre acceso',
  'settings.keepAwakeHint': 'Utile se tieni il telefono in mano mentre guardi.',
  'settings.appName': 'Relay controller',

  // Screen titles
  'nav.diagnostics': 'Diagnostica',
  'nav.settings': 'Impostazioni',
  'nav.transports': 'Percorsi e priorità',
  'nav.seek': 'Salti',
  'nav.servers': 'Server',
  'nav.device': 'Dispositivo',
  'nav.newDevice': 'Nuovo dispositivo',

  // Common
  'common.save': 'Salva',
  'common.add': 'Aggiungi',
  'common.cancel': 'Annulla',
  'common.remove': 'Rimuovi',
  'common.yes': 'sì',
  'common.no': 'no',

  // Connection states
  'state.idle': 'fermo',
  'state.connecting': 'connessione…',
  'state.connected': 'collegato',
  'state.degraded': 'instabile',
  'state.failed': 'non raggiungibile',

  // Diagnostics
  'diag.paths': 'Percorsi',
  'diag.noPaths': 'Nessun percorso attivo',
  'diag.receiver': 'Ricevitore',
  'diag.foregroundApp': 'App in primo piano',
  'diag.mediaSession': 'Sessione multimediale',
  'diag.executors': 'Esecutori',
  'diag.recipe': "Ricetta per l'app",
  'diag.recipeGeneric': 'generica',
  'diag.battery': 'Batteria',
  'diag.events': 'Eventi',
  'diag.refresh': 'Aggiorna',
  'diag.noEvents': 'Ancora niente.',

  // Executors
  'exec.accessibility': 'Accessibilità',
  'exec.settings': 'Impostazioni',
  'exec.dom': 'pagina',

  // Remote screen
  'remote.settings': 'Impostazioni',
  'remote.fullscreen': 'Schermo intero',
  'remote.exitFullscreenLabel': 'Esci dallo schermo intero',
  'remote.exitFullscreenText': 'Esci da schermo intero',
  'remote.fullscreenHint': 'Tieni premuto per uscire comunque',

  // Connection chip
  'chip.connecting': 'Connessione…',
  'chip.noPath': 'Nessun percorso raggiungibile',
  'chip.standby': '+{n} di riserva',
  'chip.label': 'Connessione: {label}. Apri la diagnostica',

  // Now playing
  'now.noForeground': 'Nessuna app in primo piano',
  'now.waiting': 'In attesa del dispositivo',
  'now.stale': ' · non aggiornato',
  'now.playing': 'In riproduzione',
  'now.noMedia': 'Nessun contenuto multimediale rilevato',
  'now.pause': 'Pausa',
  'now.play': 'Riproduci',
  'now.position': 'Posizione',
  'now.noSessionHint':
    "Il salto userà i tocchi sullo schermo (a passi di 10 s). Per salti esatti concedi al ricevitore l'accesso alle notifiche.",

  // Seek pad
  'seek.custom': 'Salto personalizzato',
  'seek.other': 'Altro',
  'seek.placeholder': 'es. 45, 2m, 1:30, 1h',
  'seek.useThis': 'Usa questo salto',
  'seek.badFormat': 'Formato non riconosciuto',
  'seek.anyDuration': 'Qualsiasi durata, fino a 24 ore',
  'seek.saveFavourite': 'Salva fra i preferiti',
  'seek.back': 'Indietro di {amount}',
  'seek.forward': 'Avanti di {amount}',
  'seek.holdHint': 'Tieni premuto per ripetere',

  // Episode navigation
  'episode.next': 'Episodio successivo',
  'episode.prev': 'Episodio precedente',
  'episode.nextShort': 'Successivo',
  'episode.prevShort': 'Precedente',
  'episode.current': 'Episodio {n}',
  'episode.list': 'Episodi',
  'episode.item': 'Episodio {n}',

  // Target switcher
  'target.label': 'Dispositivo: {name}. Cambia dispositivo',
  'target.devices': 'Dispositivi',
  'target.browser': 'Estensione del browser',
  'target.android': 'Telefono Android',
  'target.add': 'Aggiungi dispositivo',

  // Command feedback
  'cmd.via': 'via {by}',
  'cmd.done': 'Fatto',
  'cmd.failed': 'Non riuscito',
  'cmd.notConnected': 'Non collegato',
  'cmd.noPath': 'Nessun percorso verso il dispositivo',
  'cmd.error': 'Errore',

  // Client errors and log lines
  'client.noTransports': 'Nessun percorso utilizzabile per questo dispositivo',
  'client.singlePath': 'Solo un percorso attivo: nessun fallback disponibile.',
  'client.notConnected': 'Non collegato',
  'client.noReply': 'Nessuna risposta dal ricevitore',
  'client.dropped': 'Messaggio scartato: {reason}',

  // Transports
  'transport.lan.label': 'Wi-Fi locale',
  'transport.lan.summary': 'Diretto sulla stessa rete. Il più veloce, funziona senza internet.',
  'transport.lan.missing': 'Indirizzo locale non impostato',
  'transport.webrtc.label': 'WebRTC P2P',
  'transport.webrtc.summary': 'Diretto fra i dispositivi via internet. Il relay serve solo ad aprirlo.',
  'transport.webrtc.missing': 'Serve il server relay per la segnalazione',
  'transport.relay.label': 'Relay remoto',
  'transport.relay.summary': 'Attraverso il tuo server relay, via WebSocket. Funziona ovunque.',
  'transport.relay.missing': 'Server relay non impostato',
  'transport.http.label': 'Relay HTTP',
  'transport.http.summary': 'Stesso server, ma in HTTP semplice: passa dove i WebSocket sono bloccati.',
  'transport.mqtt.label': 'MQTT',
  'transport.mqtt.summary': 'Attraverso un broker MQTT: resta in piedi anche se il tuo relay è giù.',
  'transport.mqtt.missing': 'Broker MQTT non impostato',
  'transport.ble.label': 'Bluetooth',
  'transport.ble.summary': 'Nessuna rete necessaria, a pochi metri dal ricevitore.',
  'transport.ble.missing': 'Nessun ricevitore Bluetooth associato',
  'transport.disabled': 'Disattivato',
  'transport.unavailable': 'Non disponibile',
  'transport.unavailableBrowser': 'Non disponibile per il browser',
  'transport.bleDenied': 'Permessi Bluetooth negati',

  // Transports screen
  'transports.intro':
    "Il primo percorso disponibile porta i comandi; gli altri restano pronti come riserva. Usa le frecce per cambiare l'ordine.",
  'transports.orderFor': 'Ordine per {name}',
  'transports.order': 'Ordine',
  'transports.footer': "L'ordine vale per tutti i dispositivi; i percorsi che un dispositivo non supporta vengono saltati.",
  'transports.enable': 'Attiva {name}',
  'transports.up': 'Sposta su',
  'transports.down': 'Sposta giù',

  // Seek settings screen
  'seekSettings.favourites': 'Preferiti',
  'seekSettings.favouritesFooter': 'Tocca un salto per rimuoverlo. Ne resta sempre almeno uno.',
  'seekSettings.remove': 'Rimuovi {amount}',
  'seekSettings.add': 'Aggiungi',
  'seekSettings.duration': 'Durata',
  'seekSettings.duplicate': 'È già fra i preferiti',
  'seekSettings.hint': 'Secondi, minuti (2m), ore (1h) o mm:ss',

  // Servers screen
  'servers.relay': 'Relay',
  'servers.relayFooter':
    "Il tuo server services/relay. Porta WebSocket, HTTP di riserva e la segnalazione WebRTC. Non vede mai la chiave: solo l'id della stanza.",
  'servers.address': 'Indirizzo',
  'servers.wsError': 'Deve iniziare con ws:// o wss://',
  'servers.mqttFooter':
    'Un broker pubblico va bene perché ogni comando è firmato; può però leggerli. Per la massima riservatezza usa un tuo mosquitto con WebSocket.',
  'servers.mqttBroker': 'Broker (WebSocket)',
  'servers.mqttError': 'Serve un endpoint WebSocket (wss://…/mqtt)',
  'servers.webrtc': 'WebRTC',
  'servers.webrtcFooter':
    'STUN basta sulla maggior parte delle reti. Sulle reti mobili con NAT simmetrico serve un TURN, altrimenti il percorso diretto non si apre e subentra il relay.',
  'servers.stun': 'STUN',
  'servers.stunHint': 'Separati da virgola',
  'servers.turn': 'TURN',
  'servers.turnUser': 'Utente TURN',
  'servers.turnPass': 'Password TURN',

  // Device editor
  'device.remove': 'Rimuovi dispositivo',
  'device.removeTitle': 'Rimuovere il dispositivo?',
  'device.removeBody': '{name} non sarà più comandabile da qui.',
  'device.defaultBrowser': 'Browser',
  'device.defaultPhone': 'Telefono',

  // Device form
  'form.type': 'Tipo',
  'form.androidTitle': 'Telefono Android',
  'form.androidSubtitle': 'App Relay ricevitore',
  'form.browserTitle': 'Browser',
  'form.browserSubtitle': 'Estensione Chrome/Brave',
  'form.identity': 'Identità',
  'form.identityFooter':
    'Inserisci lo stesso codice nel ricevitore. Da questo codice derivano la chiave di firma e la stanza sul relay: tienilo lungo.',
  'form.name': 'Nome',
  'form.namePlaceholder': 'es. Telefono in salotto',
  'form.nameRequired': 'Serve un nome',
  'form.pairCode': 'Codice di accoppiamento',
  'form.codeRequired': 'Serve un codice',
  'form.codeWeak': 'Codice corto: chi gestisce il relay o un broker MQTT pubblico potrebbe indovinarlo.',
  'form.generateCode': 'Genera nuovo codice',
  'form.copyCode': 'Copia codice',
  'form.nearby': 'Vicino a te',
  'form.nearbyFooter': 'Facoltativi. Wi-Fi locale e Bluetooth funzionano senza internet; il resto passa dai server.',
  'form.lanAddress': 'Indirizzo sulla rete locale',
  'form.lanSearch': 'Cerca sulla rete',
  'form.lanEmpty': 'Nessun ricevitore trovato su questa rete',
  'form.bluetooth': 'Bluetooth',
  'form.bleNone': 'Nessun ricevitore associato',
  'form.bleSearching': 'Ricerca…',
  'form.bleSearch': 'Cerca',
  'form.bleEmpty': 'Nessun ricevitore Bluetooth nelle vicinanze',

  // Onboarding
  'onboarding.intro':
    'Il telecomando per il video che stai guardando su un altro schermo. Associa il primo dispositivo per iniziare.',
  'onboarding.remote': 'Da remoto',
  'onboarding.footerBrowser': "Il browser si raggiunge solo via internet: serve l'indirizzo del tuo relay.",
  'onboarding.footerAndroid': 'Facoltativo. Senza relay restano Wi-Fi locale, Bluetooth e MQTT.',
  'onboarding.relayServer': 'Server relay',
  'onboarding.start': 'Inizia',
};
