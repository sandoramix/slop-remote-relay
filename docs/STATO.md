# Stato del lavoro — ripartire da qui

Aggiornato il 2026-09-06. Branch: `feat/build-out`, staccato da `master`
(`cbeba92 first AI slop`). Niente è stato pushato.

Questo file esiste per far ripartire una sessione nuova senza rileggere tutto.
La mappa per fase resta `docs/BUILD.md`; qui c'è cosa è verificato davvero, come
riprodurlo, e cosa è ancora aperto.

---

## Dove siamo

| Fase | Stato | Verificato come |
|---|---|---|
| 0 — receiver compila | fatta | `./gradlew assembleDebug` + `test`, 8 test verdi |
| 1 — controller nativo | fatta, tranne iOS | APK debug e release, bundle Metro, app avviata su emulatore |
| 2 — collaudo LAN + seek | fatta a metà | protocollo end-to-end verde su emulatore; il seek **esatto** via MediaSession non è mai stato provato |
| 3 — failover | dedupe verificato | mirror LAN+relay: un solo ack per due invii. La risalita a 15 s no |
| 4 — fullscreen | non iniziata | serve un telefono vero con YouTube e Brave |
| 5 — resistenza h24 | non iniziata | serve una notte in carica |

Le fasi 4 e 5 sono bloccate su hardware, non su codice: servono due dispositivi
fisici, le app target installate e `uiautomator dump` sul device reale.

---

## Cosa è stato sistemato lungo la strada

Bug veri trovati, in ordine di quanto erano nascosti.

**1. `Codec.canonicalize` non era byte-identica al TypeScript.** Delegava le
stringhe a `JSONObject.quote`, che su AOSP escapa ogni `/`, sulla org.json Maven
dei test lo escapa solo dopo `<`, e `JSON.stringify` non lo escapa mai. Un ack
con dentro un URL non verificava, e l'unico sintomo era `signature` nel log — la
cosa esatta che il test dei vettori doveva prevenire, e non lo faceva perché
tutti i vettori erano ASCII pulito. Ora il Kotlin ha il suo escaper. I vettori
coprono `/`, `</`, virgolette, backslash, tab, newline, caratteri di controllo,
accenti, CJK ed emoji, più le derivazioni del pair code e un HMAC.

**2. `AccessibilityExecutor.canHandle` accettava solo `Fullscreen`.** Quindi
senza accesso alle notifiche un `+30s` cadeva fuori dalla catena invece di
degradare ai tap. Ha anche dato il primo lettore al campo `seek` di
`recipes.json`, che non lo aveva.

**3. `NsdServiceInfo().apply { setPort(port) }`.** Dentro `apply` `this` è
l'`NsdServiceInfo`, quindi `port` risolveva al suo `getPort()` = 0 e
`registerService` lanciava `Invalid port number` sul thread selector di
Java-WebSocket, ammazzando il processo.

**4. `RelayApp.onCreate` chiamava `startForegroundService`.** Android 12+ lo
rifiuta da background e l'app moriva prima di fare qualsiasi cosa. La classe
`Application` è sparita; `MainActivity.onResume` e `BootReceiver` usano
`RelayForegroundService.ensureRunning`, che logga il rifiuto invece di morirci.

**5. Il receiver rifiutava un relay in `ws://`.** Giusto in release — un relay è
una macchina pubblica e deve essere `wss://` — ma rendeva impossibile provarne
uno sul portatile. `app/src/debug/AndroidManifest.xml` abilita il cleartext solo
in debug.

Il 3 e il 4 sono usciti solo installando l'APK ed eseguendolo. Non si vedono
leggendo il codice.

---

## Come rimettere in piedi il banco di prova

Serve solo un emulatore x86_64. Niente telefoni.

```bash
# 1. Emulatore (Nexus10_34 è l'unico x86_64 fra gli AVD presenti;
#    medium_34 è ARM e non parte su questo host)
"$LOCALAPPDATA/Android/Sdk/emulator/emulator.exe" -avd Nexus10_34 \
  -no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader_indirect &

# 2. Receiver
cd android-receiver && ./gradlew installDebug

# 3. Accoppiamento senza passare dalla UI: si scrive il file di preferenze.
#    ATTENZIONE su Git Bash: MSYS_NO_PATHCONV=1 o i percorsi /data/... vengono
#    riscritti in C:/Programs/Git/data/...
cat > /tmp/relay.config.xml <<'XML'
<?xml version='1.0' encoding='utf-8' standalone='yes' ?>
<map>
    <string name="pairCode">cielo-lento-42</string>
    <string name="relayUrl">ws://10.0.2.2:8080</string>
</map>
XML
MSYS_NO_PATHCONV=1 adb push /tmp/relay.config.xml /data/local/tmp/relay.config.xml
MSYS_NO_PATHCONV=1 adb shell 'run-as com.relay.receiver cp /data/local/tmp/relay.config.xml shared_prefs/relay.config.xml'
adb shell am force-stop com.relay.receiver
adb shell monkey -p com.relay.receiver -c android.intent.category.LAUNCHER 1

# 4. Permessi, senza toccare lo schermo
MSYS_NO_PATHCONV=1 adb shell 'settings put secure enabled_accessibility_services com.relay.receiver/com.relay.receiver.service.RelayAccessibilityService'
MSYS_NO_PATHCONV=1 adb shell 'settings put secure accessibility_enabled 1'

# 5. Relay e port forward
npm run relay &
MSYS_NO_PATHCONV=1 adb forward tcp:47821 tcp:47821

# 6. Il test
npm run smoke -- cielo-lento-42 --relay ws://127.0.0.1:8080
```

Ultimo esito noto: **21 passati, 0 falliti** — 10 su LAN, 10 su relay, più il
mirror. Il relay ha loggato l'ingresso nella stanza `0192d130ee3206a13382f6a8`,
che è lo stesso id fissato in `CodecTest` a partire dai vettori TypeScript: la
derivazione che coincide fra i due linguaggi su traffico vero, non in una
fixture.

### Controller sullo stesso emulatore

Il debug build vuole Metro; il release incorpora il bundle e si installa e basta.

```bash
cd apps/controller/android && ./gradlew assembleRelease
adb install -r app/build/outputs/apk/release/app-release.apk
```

Poi nelle impostazioni: codice `cielo-lento-42`, indirizzo `127.0.0.1` (le due
app girano sullo stesso device). Attenzione: `adb shell input text` scrive più
in fretta di quanto React ridisegni un TextInput controllato e perde caratteri —
va battuto un carattere alla volta con ~0,4 s di pausa. Non è un bug dell'app.

Con questo la dashboard mostra "Wi-Fi locale" in verde, il pacchetto in primo
piano letto dal receiver, e un `+30s` torna con **"Fatto via accessibility"**.

---

## Cosa resta aperto

**Serve un dispositivo vero**

- Seek esatto via MediaSession. Sull'emulatore non c'è nessuna sessione media,
  quindi la catena cade sempre sui tap. È il percorso principale del progetto e
  non è mai stato eseguito. `MediaSessionExecutor.currentPositionMs` con la sua
  estrapolazione è codice mai girato una volta.
- Fase 4 per intero. I view-id in `recipes.json` restano plausibili e non
  verificati, come dice `docs/BUILD.md`.
- Risalita del failover dopo 15 s di salute continua.
- Fase 5.

**Noto, non toccato**

- `BleGattTransport` è ancora lo scaffold voluto. `TransportSet` lo tollera.
- `Codec.verify` accetta `type:"hello"` senza firma, per simmetria con
  `codec.ts`. Oggi `CommandRouter` lo scarta, quindi impatto nullo, ma è un
  frame non autenticato che entra.
- `QUERY_ALL_PACKAGES` è dichiarato nel manifest del receiver e non lo usa
  nessuno: non c'è una sola chiamata a `PackageManager`. Va tolto o usato.
- La nuova architettura React Native è spenta di proposito
  (`apps/controller/android/gradle.properties`): sia `react-native-ble-plx` sia
  `react-native-zeroconf` sono moduli legacy senza codegen. Riaccenderla è una
  riga, da riprovare quando LAN e relay sono solidi.
- `BUILD.md` in root e `docs/BUILD.md` sono ancora due file identici. Vanno
  tenuti in pari a mano finché qualcuno non ne cancella uno.
- Il progetto iOS esiste ma non è mai stato aperto: serve un Mac, e `pod install`
  non è mai girato.

**Ambiente, per non ripercorrerlo**

- `JAVA_HOME` deve essere il JDK 17 (`C:\Users\sando\.jdks\ms-17.0.16`); il
  `java` sul PATH è il 21.
- Il wrapper del receiver è alla 8.11.1, non alla 8.9 suggerita in `BUILD.md`:
  la 8.9 in cache era un download interrotto.
- Il monorepo npm sposta tutto in `node_modules` alla radice. Le tre correzioni
  che servono sono in `apps/controller/android/settings.gradle`,
  `android/app/build.gradle` (compreso `hermesCommand`, senza il quale il
  bundling release non parte) e `metro.config.js`.

---

## Ordine consigliato per ripartire

1. Prendere un telefono vero, installarci il receiver, ripetere il giro del
   banco di prova. È l'unica cosa che sblocca tutto il resto.
2. Fase 2 per davvero: YouTube in riproduzione, solo l'accesso alle notifiche
   concesso, `+30s`. Attendersi `executedBy: "mediasession"` e un salto esatto.
3. Fase 4 con `adb shell uiautomator dump`, correggendo `recipes.json`.
4. Solo dopo, le cose lasciate aperte qui sopra.
