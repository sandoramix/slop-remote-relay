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

## Fase 1 — Controller: il progetto nativo — FATTA (iOS a parte)

`android/` e `ios/` generati da `@react-native-community/template` 0.76.5,
rinominati in RelayController, package `com.relay.controller`.

Verificato: `npm run typecheck` pulito su tutti e tre i workspace,
`./gradlew assembleDebug` e `assembleRelease`, e l'app avviata su emulatore che
mostra la schermata impostazioni. iOS esiste come progetto ma non è mai stato
aperto: serve un Mac.

Le trappole del monorepo, tutte risolte: il plugin Gradle di React Native e
`reactNativeDir`/`codegenDir`/`cliFile` puntano alla radice del repo, non alla
cartella dell'app; `hermesCommand` idem, altrimenti il bundling release muore
con "Couldn't determine Hermesc location"; `metro.config.js` guarda la radice e
fissa la risoluzione, o Metro trova due copie di react. `@relay/protocol` ha ora
un campo `react-native` che punta a `src/index.ts`, così l'app consuma il
workspace come sorgente senza che nessuno debba ricordarsi di compilarlo.

La nuova architettura è spenta di proposito: `react-native-ble-plx` e
`react-native-zeroconf` sono moduli legacy senza codegen.

## Fase 2 — Primo collaudo end-to-end, solo LAN + seek — A METÀ

La parte di protocollo è verificata su emulatore, senza secondo telefono, con
`npm run smoke`. Vedi `docs/STATO.md` per la procedura completa. Ultimo esito:
21 controlli verdi, 10 su LAN, 10 sul relay, più il mirror dello stesso comando
sui due percorsi che produce un solo ack.

Il controller vero, installato sullo stesso emulatore e puntato a `127.0.0.1`,
chiude il giro: la dashboard passa a "Wi-Fi locale", legge il pacchetto in primo
piano dal receiver, e un `+30s` torna con "Fatto via accessibility".

**Cosa manca ed è il punto della fase.** Un emulatore non ha nessuna sessione
media, quindi la catena cade sempre sui tap e il percorso principale — seek
esatto via MediaSession — non è mai stato eseguito. `currentPositionMs` e la sua
estrapolazione sono codice mai girato. Serve un telefono con YouTube in
riproduzione e il solo accesso alle notifiche concesso. Attendersi
`executedBy: "mediasession"` e un salto esatto.

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

Questa metà è già verde senza hardware: `npm run smoke -- <codice> --relay <url>`
apre LAN e relay insieme, manda lo stesso envelope sui due percorsi e pretende
un solo ack. Resta da provare sul campo la risalita dopo ~15 secondi.

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
