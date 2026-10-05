# Nexus Launcher

Launcher open-source per **Minecraft: Java Edition** costruito con **Tauri v2 (Rust)** e **React + TypeScript + Tailwind CSS v4**, con interfaccia **Material 3 Expressive** e palette dinamica Material You.

- 🔐 Login ufficiale **Microsoft → Xbox Live → XSTS → Minecraft Services** (OAuth2 Device Code Flow), token cifrati AES‑256‑GCM con chiave nel portachiavi di sistema e refresh automatico.
- 📦 **Istanze isolate** (clona / elimina / ripara), Vanilla, **Fabric, Quilt, Forge, NeoForge**, release e snapshot.
- ⚡ Download **paralleli** con verifica **SHA1** di client.jar, librerie, natives e asset; runtime **Java Mojang** scaricato automaticamente.
- 🧩 **Mod manager Modrinth**: ricerca mod/shader/resource pack/modpack (`.mrpack`), dipendenze risolte in automatico, toggle `.jar` ↔ `.jar.disabled`.
- 🤖 **Modding Copilot** senza API key: **Puter.js** (cloud) oppure **Ollama** (100% locale). L'AI propone azioni strutturate (JSON) eseguibili con un clic e analizza i crash.
- 🖥️ Console integrata con log di download e di gioco in tempo reale.

---

## Struttura del repository

```
.
├── index.html                  entry Vite
├── package.json                script npm / dipendenze frontend
├── vite.config.ts
├── app-icon.svg                sorgente icone (npm run icons)
├── public/logo.svg
├── src/                        ── FRONTEND (React + TS)
│   ├── main.tsx / App.tsx      bootstrap, layout, listener eventi backend
│   ├── index.css               design token M3 (colori, forme, motion, elevazioni)
│   ├── lib/
│   │   ├── api.ts              wrapper tipizzati di `invoke` (+ fallback mock nel browser)
│   │   ├── theme.ts            palette dinamica (material-color-utilities)
│   │   ├── store.ts            stato globale (zustand)
│   │   ├── types.ts / format.ts / mock.ts
│   ├── components/
│   │   ├── ui.tsx              Button, FAB, IconButton, Dialog, Switch, Slider, Segmented, WavyProgress…
│   │   └── shell.tsx           TitleBar, NavigationRail, LogConsole, Snackbar, Avatar
│   └── features/
│       ├── home/               home + hero "Gioca"
│       ├── instances/          dettaglio istanza, dialog nuova istanza
│       ├── browse/             browser Modrinth
│       ├── accounts/           login Microsoft (device code) e profili con skin
│       ├── settings/           tema, Java, RAM, client ID, provider AI
│       └── ai/                 Copilot: provider, system prompt, schema azioni, pannello chat
├── src-tauri/                  ── BACKEND (Rust)
│   ├── Cargo.toml / build.rs / tauri.conf.json
│   ├── capabilities/default.json
│   ├── icons/
│   └── src/
│       ├── main.rs / lib.rs    setup Tauri + registrazione comandi IPC
│       ├── auth/               microsoft.rs (OAuth/Xbox/MC) · store.rs (archivio cifrato + keyring)
│       ├── minecraft/
│       │   ├── version.rs      modello version JSON, regole OS, merge inheritsFrom, maven
│       │   ├── install.rs      librerie, natives, asset, client.jar
│       │   ├── loaders.rs      Fabric/Quilt (meta API) · Forge/NeoForge (installer ufficiale)
│       │   ├── java.rs         rilevamento Java + runtime Mojang
│       │   └── launch.rs       command builder, avvio processo, log streaming, kill
│       ├── download.rs         downloader parallelo con SHA1 + retry + progress events
│       ├── instances.rs        CRUD istanze
│       ├── modrinth.rs         ricerca, installazione con dipendenze, .mrpack, contenuti locali
│       ├── crash.rs            analizzatore euristico dei crash
│       ├── ai.rs               proxy streaming verso Ollama
│       └── settings.rs / state.rs / paths.rs / util.rs / error.rs
└── .github/workflows/release.yml   build installer Windows + Linux in CI
```

Dati utente: `%APPDATA%\dev.nexus.launcher` (Windows) · `~/.local/share/dev.nexus.launcher` (Linux).

---

## Prerequisiti

| | Windows | Linux (Debian/Ubuntu) |
|---|---|---|
| Node.js | 20+ | 20+ |
| Rust | `winget install Rustlang.Rustup` | `curl https://sh.rustup.rs -sSf \| sh` |
| Toolchain C | Visual Studio Build Tools → "Sviluppo desktop con C++" | vedi sotto |
| WebView | WebView2 (già presente su Windows 10/11) | WebKitGTK 4.1 |

Pacchetti Linux:

```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev libdbus-1-dev pkg-config
```

### Client ID Microsoft (necessario per il login)

1. [portal.azure.com](https://portal.azure.com) → **Microsoft Entra ID → Registrazioni app → Nuova registrazione**, tipo di account: *Solo account Microsoft personali*.
2. **Autenticazione → Consenti flussi client pubblici: Sì** (serve al Device Code Flow).
3. Copia l'**ID applicazione (client)**.
4. Richiedi l'accesso alle API Minecraft con il [modulo Mojang](https://aka.ms/mce-reviewappid). Finché l'app non è approvata `login_with_xbox` risponde **403**.
5. Inserisci l'ID in **Impostazioni → Account Microsoft**, oppure incorporalo in build con la variabile `NEXUS_MS_CLIENT_ID`.

> In build di sviluppo la pagina Account offre un **account offline** per provare download e avvio senza client ID approvato. Nelle build release è disabilitato.

---

## Sviluppo

```bash
npm install
```

Avvia l'app desktop con hot-reload (frontend Vite + backend Rust):

```bash
npm run tauri dev
```

In alternativa, con la CLI Rust (`cargo install tauri-cli --version "^2"`):

```bash
cargo tauri dev
```

Solo interfaccia, in un browser normale e con dati mock (senza Rust):

```bash
npm run dev
```

Test del backend (parsing maven, versioni Java, analizzatore crash):

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Type-check del frontend:

```bash
npm run typecheck
```

## Build degli installer

```bash
npm run tauri build
```

oppure `cargo tauri build`. Con il client ID incorporato (PowerShell):

```powershell
$env:NEXUS_MS_CLIENT_ID="00000000-0000-0000-0000-000000000000"; npm run tauri build
```

Output in `src-tauri/target/release/bundle/`:

| Piattaforma | File |
|---|---|
| Windows | `nsis/Nexus Launcher_0.1.0_x64-setup.exe` · `msi/Nexus Launcher_0.1.0_x64_en-US.msi` |
| Linux | `appimage/nexus-launcher_0.1.0_amd64.AppImage` · `deb/…_amd64.deb` · `rpm/…x86_64.rpm` |

I pacchetti Linux vanno compilati su Linux (Tauri non fa cross-compilazione Windows → Linux): usa il workflow **`.github/workflows/release.yml`**, che compila entrambe le piattaforme su tag `v*`.
Per compilare solo un formato: `npm run tauri build -- --bundles nsis`.

---

## Modding Copilot (AI)

| Provider | Come funziona | Note |
|---|---|---|
| **Puter.js** (predefinito) | `puter.ai.chat()` caricato da `js.puter.com`, streaming | Nessuna API key per lo sviluppatore (modello *User-Pays*). Al primo uso Puter può chiedere di accedere con un account Puter gratuito. Modello configurabile (vuoto = predefinito di Puter). |
| **Ollama** | Il backend Rust fa da proxy verso `http://localhost:11434/api/chat` e invia i token come eventi | 100% offline: `ollama pull llama3.2`. |

L'AI risponde in markdown e, quando propone un'operazione, aggiunge un blocco ` ```nexus-action ` con JSON validato lato client:

```json
{"type":"create_instance","name":"Survival Performance","mcVersion":"1.21.1","loader":"fabric",
 "maxRamMb":4096,"mods":["sodium","lithium","iris"],"shaders":["complementary-reimagined"]}
```

Azioni supportate: `create_instance`, `install_content`, `update_instance`, `toggle_content`. Nella UI compaiono come card con il pulsante **Esegui** e l'avanzamento passo per passo. L'**analisi dei crash** gira prima in locale (`crash.rs`: versione Java errata, dipendenze mancanti, conflitti Mixin, OOM, driver…) e poi passa findings, mod installate ed estratto del log al modello.

---

## Limiti noti

- **Forge/NeoForge** vengono installati eseguendo l'installer ufficiale con `--installClient`: funziona con le versioni moderne. Le versioni Forge molto vecchie (< 1.13) non supportano questa opzione.
- **CurseForge** richiede una API key dell'utente: non è integrato, si usa Modrinth.
- **Puter.js** apre il login in un popup: in alcune webview (soprattutto WebKitGTK su Linux) il popup potrebbe essere bloccato. In quel caso usa Ollama.
- Il font Material Symbols completo pesa circa 5 MB. Per ridurre l'installer si può creare un sottoinsieme con le sole icone usate.
- macOS non è un target (la struttura dei runtime Java Mojang è gestita solo per Windows/Linux).

Nexus Launcher non è affiliato con Mojang Studios o Microsoft.
