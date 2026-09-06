# Distribuzione e vincoli di piattaforma

Nessuno di questi punti è un dettaglio burocratico: ognuno può rendere l'app
inutilizzabile su un dispositivo specifico. Vale la pena leggerli prima di
investire tempo sul fullscreen.

## 1. Restricted Settings (Android 13+)

Un'app installata via APK non può abilitare né Accessibilità né Accesso alle
notifiche finché l'utente non passa da "Consenti impostazioni con restrizioni"
nella schermata App info. Su alcune ROM pesantemente modificate quella voce non
compare affatto; in quel caso restano i comandi ADB nel README, oppure
l'installazione tramite un installer che usa `PackageInstaller.Session`, che
registra l'app come non-sideloaded.

## 2. Advanced Protection Mode (Android 17)

Con la modalità attiva, il sistema blocca le app non classificate come strumenti
di accessibilità dall'usare l'API, e revoca il permesso a quelle che già ce
l'hanno. Non è il default, ma se il proprietario del dispositivo target la
attiva, lo schermo intero smette di funzionare e non c'è aggiramento.

Il seek continua a funzionare: passa dall'accesso alle notifiche, che APM non
tocca. È la ragione concreta per cui le due catene sono separate.

## 3. Google Play: escluso

`isAccessibilityTool` può essere dichiarato solo da servizi progettati per
assistere persone con disabilità. Questo non lo è, e dichiararlo sarebbe una
falsa dichiarazione. La conseguenza pratica: distribuzione via sideload o canale
interno, mai Play Store.

## 4. Verifica sviluppatore

Dal 30 settembre 2026 le app devono essere registrate da sviluppatori verificati
per installarsi normalmente sui dispositivi certificati in Brasile, Indonesia,
Singapore e Thailandia; il rollout globale è previsto nel 2027. Le app non
registrate restano installabili via ADB o tramite il flusso avanzato, che
introduce un'attesa obbligatoria.

Per l'Italia oggi non cambia nulla. Consiglio comunque di registrare un account a
distribuzione limitata in anticipo: è gratuito e toglie una frizione futura. Da
riverificare per l'UE, dove il DMA potrebbe modificare il quadro.

## 5. Il killer silenzioso: l'autostart del produttore

Non è una policy Google ma è la causa più frequente di receiver che smettono di
rispondere dopo una notte in carica. Xiaomi, Oppo, Vivo, Huawei e Samsung
applicano ciascuno criteri propri per uccidere i servizi in background, e ognuno
ha una schermata diversa. Il punto 5 dell'onboarding porta alla pagina App info,
da cui si raggiunge in tutti i casi.
