# Shizuku: cosa cambierebbe

Rimandato per scelta, non dimenticato. Ecco il conto esatto, per decidere dopo il
proof of concept con dati veri.

## Cosa comprerebbe

Privilegi a livello ADB senza root: `input tap`, `input keyevent`, `am start`,
lettura affidabile dell'app in primo piano. Il fullscreen smetterebbe di dipendere
dall'albero di accessibilità, che è la parte fragile di tutto il progetto, e
sopravviverebbe ad Advanced Protection Mode.

## Cosa costerebbe

Il debug USB deve restare attivo in permanenza sul dispositivo target. Su
Android 11+ Shizuku si riavvia dal telefono stesso via wireless debugging, senza
PC, ma va comunque riavviato dopo ogni reboot — e su Android 17 risulta rotto per
un problema di compatibilità segnalato a metà 2026, senza aggiramenti noti.

Per un'app che deve stare su h24 e riprendersi da sola dopo un riavvio, questo è
il punto che pesa di più.

## Quanto costerebbe implementarlo

Poco, ed è il motivo per cui si può decidere dopo. La catena degli esecutori è già
disegnata per questo:

```kotlin
class ShizukuExecutor(...) : ActionExecutor {
    override val id = ExecutorId.SHIZUKU
    override fun isAvailable() = Shizuku.pingBinder() && Shizuku.checkSelfPermission() == GRANTED
    override fun canHandle(command: Command) = true
    override suspend fun execute(command: Command): ExecResult { /* input tap / keyevent */ }
}
```

Più una riga in `RelayForegroundService.bootstrap()`:

```kotlin
val chain = ExecutorChain(listOf(mediaSession, AccessibilityExecutor(...), ShizukuExecutor(...)))
```

Nient'altro cambia. Nessun file di protocollo, nessuna UI, nessun trasporto.

## La raccomandazione

Fai girare l'MVP una settimana su app reali e conta quante volte il fullscreen
fallisce. Se le ricette reggono, Shizuku è complessità che non serve. Se il
fullscreen fallisce spesso su Brave — il caso più probabile, per via dei controlli
custom nei player web — allora vale il suo prezzo.
