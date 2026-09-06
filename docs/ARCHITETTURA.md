# Architettura

## Perché il receiver è Kotlin nativo e il controller no

`AccessibilityService` e `NotificationListenerService` non sono classi che si
istanziano: sono componenti dichiarati nel manifest che il *sistema* crea, lega e
tiene vivi per giorni. Affiancare a loro un runtime JavaScript da mantenere caldo
h24 aggiunge peso e un modo in più di morire, senza restituire nulla — la logica
del receiver non ha UI da condividere.

Il codice realmente condivisibile fra le due app è il protocollo, non la logica.
Per questo `packages/protocol` è l'unico punto di contatto, e `core/Protocol.kt`
ne è il gemello Kotlin.

## Le tre asimmetrie fra controller e receiver

**Il controller sceglie, il receiver no.** Il controller instrada su un solo
trasporto per volta (`TransportManager`), perché mandare tutto su tre percorsi
sprecherebbe batteria. Il receiver resta invece raggiungibile su tutti e tre
insieme (`TransportSet`): non gli costa quasi nulla e garantisce che il failover
del controller abbia sempre dove atterrare.

**Il controller duplica, il receiver deduplica.** Con `mirrorCritical` attivo un
comando parte su due strade contemporaneamente. È la `DedupeWindow` in
`CommandRouter` a impedire che un "+30s" premuto una volta ne salti 60.

**Il receiver risponde con l'esecutore usato.** Ogni ack contiene `executedBy`.
Sembra un dettaglio di logging, ma è ciò che permette di capire dal telefono in
mano se il seek è passato dalla MediaSession (esatto) o dai doppi tap (a blocchi
di 10 secondi) senza collegare un cavo.

## Il flusso di un comando

```
Dashboard              premi "+30s"
  ↓
RelayClient            firma HMAC, id univoco, promessa in attesa dell'ack
  ↓
TransportManager       instrada sul percorso attivo (+ mirror se critico)
  ↓  ~~~ rete ~~~
Transport (receiver)   LAN, relay o BLE — indifferente da qui in poi
  ↓
CommandRouter          verifica firma → scarta replay → dedupe → esegue
  ↓
ExecutorChain          MediaSession? sì → seekTo(pos + 30000)
  ↓
ack {ok, executedBy}   torna sullo stesso percorso
```

## Aggiungere un trasporto

Una classe che implementa `Transport` (tre metodi) e una riga nella lista dei
candidati. Nient'altro: comandi, UI e catena di esecuzione non sanno né devono
sapere quale strada abbia preso il frame.

Se un giorno vorrai WebRTC vero, entra a priorità 5 — sotto la LAN, sopra il
relay — e il relay resta come fallback quando ICE non chiude, cosa che su NAT
simmetrico di rete mobile succede spesso.

## Aggiungere un comando

1. Un caso in `Command` (TypeScript e Kotlin).
2. Una ricetta in `recipes.json` se serve un percorso specifico per app.
3. Un metodo su `RelayClient` e un pulsante.

Le operazioni che hai in mente per il futuro (volume, apertura app, navigazione)
sono tutte `performGlobalAction` o `dispatchGesture`: entrano nella catena
esistente senza aggiungere meccanismi.
