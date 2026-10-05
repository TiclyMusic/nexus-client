# Nexus Social — server amici & presenza

Backend gratuito per il tab **Amici** di Nexus Launcher, su **Cloudflare Workers + D1**.
Piano gratuito: 100.000 richieste/giorno, nessuna carta di credito richiesta.

Come funziona: il launcher invia il tuo token Minecraft, il server lo verifica sulle API ufficiali
Mojang (così l'identità è reale e non falsificabile) e rilascia un token di sessione firmato.
Gli amici vedono la tua presenza (che istanza stai giocando, se stai hostando un mondo e a quale
indirizzo) solo se siete amici a vicenda.

## Requisiti

- Un account Cloudflare gratuito (https://dash.cloudflare.com/sign-up)
- Node.js installato

## Deploy in 5 comandi

Dalla cartella `server/`:

```bash
npm install -g wrangler
wrangler login
```

Crea il database D1 e **incolla l'`database_id`** che ti stampa dentro `wrangler.toml`:

```bash
wrangler d1 create nexus-social
```

Crea le tabelle e imposta un segreto per firmare le sessioni (una stringa lunga a caso):

```bash
wrangler d1 execute nexus-social --remote --file=./schema.sql
wrangler secret put SESSION_SECRET
```

Pubblica:

```bash
wrangler deploy
```

Alla fine Wrangler stampa l'URL del Worker, tipo:

```
https://nexus-social.<tuo-sottodominio>.workers.dev
```

`https://nexus-social.matthias-peterlini.workers.dev` è l'URL predefinito del launcher
(`DEFAULT_SOCIAL_URL` in `src-tauri/src/settings.rs`): non serve configurare nulla. Per usare un
altro server, incolla il suo URL in **Nexus → Impostazioni → Amici & presenza → URL del server**.
Fatto: ora la ricerca, le richieste di amicizia e la presenza funzionano davvero.

## Endpoint (per riferimento)

| Metodo | Rotta | Auth | Descrizione |
|---|---|---|---|
| POST | `/auth` | token Minecraft | Verifica identità → token di sessione |
| GET | `/friends` | sessione | Amici (con presenza) + richieste in entrata/uscita |
| GET | `/search?q=` | sessione | Cerca utenti Nexus per nome |
| POST | `/request` | sessione | Invia richiesta `{uuid}` |
| POST | `/respond` | sessione | Accetta/rifiuta `{uuid, accept}` |
| POST | `/remove` | sessione | Rimuovi amico `{uuid}` |
| POST | `/favorite` | sessione | Preferito `{uuid, favorite}` |
| POST | `/presence` | sessione | Heartbeat `{status, detail, joinAddress}` |

## Note

- La presenza è "push": il launcher invia un heartbeat ogni ~30s. Un amico senza heartbeat da
  più di 70s risulta offline. Nessun processo in background sul server.
- Puoi cercare e aggiungere solo persone che hanno **già usato Nexus** almeno una volta (così
  esistono nel database e possono accettare).
- Costi: con l'uso normale resti ampiamente nel piano gratuito. Il Worker non ha stato in RAM,
  quindi scala a zero quando nessuno lo usa.
