# NBA Stats Hub Mobile — 2026–2027

PWA statica per smartphone (Android e iPhone), con aggiornamento programmato tramite GitHub Actions e pubblicazione gratuita su GitHub Pages.

## Pubblicazione (necessita account GitHub)

1. Crea un **repository pubblico** su GitHub (es. `nba-stats-hub`). Non inserire password o dati personali.
2. Carica **tutti i file e le cartelle** di questo ZIP nella radice del repository, inclusa `.github/workflows/sync.yml` (cartella nascosta).
3. In **Settings → Pages → Build and deployment** seleziona **Deploy from a branch**, branch `main`, cartella `/(root)` e salva.
4. In **Actions → Aggiorna statistiche NBA → Run workflow** esegui una prima sincronizzazione.
5. Attendi il completamento dell'azione e apri l'indirizzo fornito da GitHub Pages, tipicamente `https://TUO-UTENTE.github.io/nba-stats-hub/`.
6. Sul Samsung: apri l'indirizzo in Chrome → menu ⋮ → **Aggiungi a schermata Home** / **Installa app**.

## Aggiornamento

Il workflow esegue `sync.py` alle **12:20 UTC** ogni giorno (13:20 in Italia in inverno, 14:20 in estate). GitHub può ritardare o disabilitare le attività pianificate inattive. Il pulsante “Aggiorna” nell'app ricarica l'archivio già pubblicato, **non** avvia una sincronizzazione dal telefono.

La sorgente è il feed JSON pubblico `cdn.nba.com`. La disponibilità del feed e la compatibilità del suo schema non sono garantite; possibili blocchi o modifiche richiedono manutenzione. Lo script preserva i dati esistenti in caso di errore del calendario e importa fino a 35 box score mancanti per esecuzione. Le classifiche sono derivate dalle sole partite archiviate, quindi inizialmente possono essere incomplete. Il sistema è per uso personale, non è affiliato all'NBA.

## Funzioni

- 30 squadre, calendario/risultati, classifiche Est/Ovest, ricerca giocatori, medie punti/rimbalzi/assist.
- Design responsive, manifest PWA, service worker per l'interfaccia offline.
- Archivio JSON persistente versionato in GitHub (non è un database SQLite remoto).
- **Non sono ancora implementati:** confronti grafici avanzati, notifiche push, autenticazione, play-by-play e pagine box score di dettaglio. La dashboard visualizza un massimo di 120 partite recenti per prestazioni; l'archivio ne conserva di più.

## Test locale

`python -m http.server 8000` poi apri `http://localhost:8000`. Per importare dati: `python sync.py` (richiede accesso internet).

## Privacy

Con un repository pubblico, anche i file JSON delle statistiche saranno pubblici. Non caricare dati privati.
