# Nexus Social su Fly.io

Server amici & presenza, ospitato su Fly.io (datacenter che Mojang **non** blocca, a differenza
di Cloudflare Workers). Stessa logica del Worker, ma su Node + SQLite.

## Deploy (una volta)

Installa flyctl e accedi:

```bash
iwr https://fly.io/install.ps1 -useb | iex
```

```bash
fly auth login
```

Dalla cartella `server-fly/`, crea l'app (scegli un nome unico se "nexus-social-peterlini" è preso — aggiorna anche `fly.toml`):

```bash
fly apps create nexus-social-peterlini
```

Crea il volume per il database e imposta il segreto delle sessioni:

```bash
fly volumes create nexus_data --region fra --size 1 --yes
```

```bash
fly secrets set SESSION_SECRET=metti-qui-una-stringa-lunga-a-caso
```

Pubblica:

```bash
fly deploy
```

Alla fine avrai un URL tipo `https://nexus-social-peterlini.fly.dev`.
Va messo come `DEFAULT_SOCIAL_URL` in `src-tauri/src/settings.rs` (o nelle Impostazioni del launcher),
poi si ricompila l'installer.

## Verifica

```bash
curl https://nexus-social-peterlini.fly.dev/
```

Deve rispondere `{"ok":true,"service":"nexus-social"}`.
