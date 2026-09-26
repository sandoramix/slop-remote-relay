# Relay — istruzioni per la sessione

Leggi `README.md` e `docs/ARCHITETTURA.md` prima di modificare qualsiasi cosa.
`docs/BUILD.md` elenca cosa manca per compilare.

## Decisioni già prese, non riaprirle

- **Il receiver è Kotlin nativo.** Non proporre React Native, Capacitor o Flutter
  per l'app receiver. La motivazione è in `docs/ARCHITETTURA.md`: gli
  AccessibilityService e NotificationListenerService hanno il ciclo di vita
  gestito dal sistema e devono restare vivi per giorni.
- **Non esiste un receiver iOS.** iOS non ha equivalenti dell'AccessibilityService.
  Il controller è cross-platform, il receiver è solo Android.
- **Niente `isAccessibilityTool` nel manifest.** Sarebbe una falsa dichiarazione.
  Vedi `docs/DISTRIBUZIONE.md`.
- **Niente root, niente Shizuku per ora.** Lo slot nella catena è predisposto ma
  vuoto; vedi `docs/SHIZUKU.md` prima di proporlo.

## Invarianti da rispettare

- `Codec.canonicalize` esiste in TypeScript (`packages/protocol/src/codec.ts`) e
  in Kotlin (`core/Codec.kt`) e deve produrre byte identici. Se ne modifichi uno,
  modifica l'altro, rigenera i vettori con `npm run vectors -w @relay/protocol` e
  aggiorna `CodecTest.kt`. Una divergenza si manifesta solo come un generico
  `signature` nei log.
- **Le ricette per il fullscreen sono dati, non codice.** Vanno in
  `apps/receiver-android/app/src/main/assets/recipes.json`. Non spostare mai una
  strategia dentro un file Kotlin: si rompono ad ogni aggiornamento delle app
  target e devono essere modificabili senza ricompilare.
- **Ogni envelope porta un `id` univoco e la `DedupeWindow` lo usa.** È l'unica
  cosa che impedisce a un comando duplicato sui due trasporti di eseguirsi due
  volte. Non rimuoverla "per semplificare".
- **Aggiungere un trasporto = una classe che implementa `Transport` + una riga
  nella lista dei candidati.** Se una modifica al trasporto tocca i comandi, la
  UI o la catena di esecuzione, l'astrazione è stata violata.
- Il codice è commentato in inglese, la documentazione e le stringhe utente in
  italiano. Mantieni la convenzione.

## Come lavorare

- Un passo alla volta, seguendo `docs/BUILD.md`. Non passare alla fase
  successiva finché la precedente non compila ed è stata verificata.
- Prima di scrivere codice nuovo, di' cosa stai per fare e perché.
- Non inventare view-id o content-description per le ricette: vanno letti dal
  dispositivo reale con `uiautomatorviewer` o `adb shell dumpsys activity`.
