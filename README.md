# Relay

Telecomando remoto per un dispositivo Android: schermo intero e salti di playback
su qualunque app in primo piano, comandati da un altro telefono.

## Cosa c'è dentro

| Cartella | Cosa fa | Stato |
|---|---|---|
| `packages/protocol` | Comandi, envelope firmato, `TransportManager` con failover | completo, typecheck pulito |
| `apps/controller` | App React Native (Android + iOS) | schermate e trasporti scritti, mai compilata |
| `services/relay` | Server di rendezvous Node, ~40 righe di logica | completo |
| `apps/receiver-android` | App Kotlin nativa | seek completo, fullscreen completo, BLE è uno scheletro |

## Le due catene

Il progetto è costruito attorno a due catene di fallback indipendenti. È l'idea
centrale: nessun comando è legato a un singolo percorso di rete né a un singolo
meccanismo di esecuzione.

**Trasporto** — quale strada prende il comando:

```
LAN WebSocket   priorità 0    ~5 ms     funziona senza internet
Relay remoto    priorità 10   ~80 ms    funziona ovunque
BLE             priorità 20   ~200 ms   funziona senza alcuna rete
```

Il controller apre tutti e tre insieme e instrada su quello migliore che risponde.
Il passaggio verso il basso è immediato perché la riserva è già aperta; la
risalita aspetta 15 secondi di salute continua, altrimenti l'app rimbalza fra
Wi-Fi e relay ai bordi della copertura.

**Esecuzione** — come il comando diventa un'azione sul dispositivo:

```
MediaSession    esatto al ms      serve l'accesso alle notifiche
Accessibility   funziona ovunque  serve il servizio di accessibilità
Shizuku         non presente      slot già predisposto, vedi docs/SHIZUKU.md
```

Le due catene non si parlano. Un dispositivo a cui è stata revocata
l'accessibilità continua a fare seek correttamente: perde solo lo schermo intero.

## Avvio rapido

```bash
# 1. Protocollo
npm install
npm run typecheck

# 2. Relay (opzionale, serve solo per il percorso remoto)
npm run dev -w @relay/server        # ascolta su :8080

# 3. Controller
npm run android -w @relay/controller

# 4. Receiver
cd apps/receiver-android && ./gradlew installDebug
```

Poi sul receiver: apri l'app, inserisci un codice di accoppiamento, concedi i
permessi nell'ordine indicato dalla schermata. Sul controller inserisci lo stesso
codice. Da quel codice si derivano sia la chiave HMAC sia la stanza del relay, per
cui non c'è altro da configurare.

## Permessi via ADB

Se la voce "Consenti impostazioni con restrizioni" non c'è (succede su diverse ROM
modificate), i due grant si possono forzare da ADB:

```bash
adb shell settings put secure enabled_accessibility_services \
  com.relay.receiver/com.relay.receiver.service.RelayAccessibilityService
adb shell settings put secure accessibility_enabled 1

adb shell cmd notification allow_listener \
  com.relay.receiver/com.relay.receiver.service.RelayNotificationListener
```

## Prima di toccare il protocollo

`Codec.canonicalize` esiste in due lingue e deve produrre byte identici. Quando
cambi la forma dell'envelope:

```bash
npm run vectors -w @relay/protocol     # stampa i vettori di riferimento
```

Incolla l'output in `apps/receiver-android/app/src/test/java/com/relay/receiver/CodecTest.kt`
e lancia `./gradlew test`. Senza questo passaggio la deriva si manifesta come un
generico `signature` nei log, che non dice nulla su cosa sia cambiato.

## Documentazione

- `docs/STATO.md` — dove siamo adesso, cosa è verificato e come riprodurlo
- `docs/BUILD.md` — cosa manca per compilare, fase per fase
- `docs/ARCHITETTURA.md` — perché il receiver è nativo e il controller no
- `docs/DISTRIBUZIONE.md` — Restricted Settings, Advanced Protection Mode, verifica sviluppatore
- `docs/SHIZUKU.md` — cosa cambierebbe se lo aggiungessi
