# Cosa manca per compilare

Lo scheletro è coerente ma non è mai stato compilato. Questi sono i buchi noti,
in ordine di lavoro.

## Fase 0 — Receiver Android: farlo compilare — FATTA

`./gradlew assembleDebug` e `./gradlew test` passano (3 test, 0 fallimenti).

Risorse aggiunte:

- `res/drawable/ic_relay.xml` — vector monocromo per la notifica persistente.
- `res/drawable/ic_launcher_foreground.xml`, `res/mipmap-anydpi-v26/ic_launcher.xml`
  e `res/values/colors.xml` — icona adattiva. Con `minSdk = 26` non serve la
  scala di PNG per densità: `anydpi-v26` copre ogni dispositivo in grado di
  installare l'app.
- `res/values/themes.xml` con `Theme.Relay`, parent
  `@android:style/Theme.Material.Light.DarkActionBar`. Il parent di piattaforma
  è obbligato: `MainActivity` estende `Activity`, e un parent AppCompat farebbe
  crashare `setContentView`.
- Gradle wrapper alla **8.11.1**, non alla 8.9 suggerita prima: la 8.9 in cache
  era un download interrotto, la 8.11.1 era già estratta. AGP 8.7.2 richiede
  Gradle ≥ 8.9, quindi va bene.
- `local.properties` con `sdk.dir`, non versionato.
- `xmlns:tools` spostato sull'elemento `<manifest>`.

Un errore di compilazione che qui non era previsto: in `LanServerTransport` due
override di `NsdManager.RegistrationListener` avevano corpo a espressione,
`override fun onServiceRegistered(info) = Log.i(...)`. `Log.i` ritorna `Int`, i
metodi del listener sono `void`, e Kotlin rifiuta l'override. Risolto passando al
corpo a blocco.

Ambiente verificato su questa macchina: JDK 17 via `JAVA_HOME`, platform
`android-35`, build-tools `35.0.0`, licenze SDK accettate. Il compilatore Kotlin
non emette warning.

## Fase 1 — Controller: il progetto nativo non esiste

`apps/controller` contiene solo `src/`, `index.js`, `app.json` e i file di
progetto. Mancano le cartelle native `android/` e `ios/`, senza le quali React
Native non compila.

Approccio consigliato: inizializzare un progetto RN pulito in una cartella
temporanea con la stessa versione indicata in `package.json`, poi copiare le
cartelle `android/` e `ios/` generate dentro `apps/controller`, allineando
`applicationId` e nome dell'app a quelli in `app.json`.

Poi vanno completate le configurazioni native delle librerie:
- `react-native-ble-plx` richiede permessi Bluetooth nel manifest Android e le
  chiavi `NSBluetoothAlwaysUsageDescription` in Info.plist su iOS.
- `react-native-zeroconf` richiede su iOS `NSLocalNetworkUsageDescription` e
  `NSBonjourServices` con `_relayctl._tcp`, altrimenti la discovery fallisce in
  silenzio.
- Android 9+ blocca il traffico in chiaro: il WebSocket LAN è `ws://`, quindi
  serve una network security config che consenta il cleartext verso la rete
  locale, oppure `usesCleartextTraffic` limitato.

Verifica della fase: `npm run typecheck -w @relay/controller` pulito e l'app che
si avvia sul dispositivo mostrando la schermata impostazioni.

## Fase 2 — Primo collaudo end-to-end, solo LAN + seek

Accoppia i due dispositivi con lo stesso codice, concedi sul receiver solo
l'accesso alle notifiche (non ancora l'accessibilità), apri YouTube sul target e
prova `+30s`.

Cosa deve succedere: l'ack torna con `executedBy: "mediasession"` e il salto è
esatto. Se il salto è di qualche centinaio di millisecondi fuori, il colpevole è
l'estrapolazione della posizione in `MediaSessionExecutor.currentPositionMs`.

Se non torna nulla, nell'ordine: il receiver è raggiungibile sulla porta 47821?
La firma verifica (cerca `signature` nei log)? Il notification listener risulta
`isBound`?

## Fase 3 — Failover

Con relay attivo e LAN funzionante, stacca il Wi-Fi del controller a metà sessione
e verifica che la barra di stato in cima alla dashboard passi a "Relay remoto" e
che i comandi continuino ad arrivare. Poi riattacca il Wi-Fi e verifica che la
risalita avvenga dopo ~15 secondi, non subito.

Con `mirrorCritical` attivo, controlla nei log del receiver che i duplicati
vengano scartati dalla `DedupeWindow`: un `+30s` non deve mai saltare 60.

## Fase 4 — Fullscreen

Qui i view-id in `recipes.json` sono plausibili ma **non verificati**. Vanno letti
dal dispositivo reale:

```bash
adb shell uiautomator dump /sdcard/ui.xml && adb pull /sdcard/ui.xml
```

Apri YouTube a video in riproduzione con i controlli visibili, cerca il nodo del
pulsante schermo intero e correggi `descriptions` e `viewIds`. Ripeti per Brave.

Aspettati che Brave sia il caso difficile: i player web con controlli custom
(YouTube nel browser è il peggiore) non espongono un pulsante raggiungibile, e si
finisce sul fallback della rotazione o sul tap appreso.

## Fase 5 — Resistenza h24

Lascia il receiver in carica una notte con lo schermo spento e verifica al
mattino che risponda ancora. Se non risponde, il colpevole è quasi sempre
l'autostart del produttore, non il codice. Vedi `docs/DISTRIBUZIONE.md`.

## Non ancora fatto, di proposito

- `BleGattTransport` è uno scaffold con i TODO nei punti giusti. `TransportSet`
  tollera già un trasporto che non si alza mai, quindi non blocca nulla.
- Nessuna modalità apprendimento per il tap: la UI per registrare la coordinata
  del pulsante fullscreen su app sconosciute non esiste ancora, ma `RecipeEngine`
  legge già le ricette apprese da SharedPreferences.
