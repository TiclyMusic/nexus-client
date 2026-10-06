# Sito nexusmc.online

Pagina di download di Nexus Launcher:

| Cosa | Dove |
|---|---|
| Pagina (`public/`) | **Netlify** → https://nexusmc.online |
| Installer (Windows, macOS, Linux) | **GitHub Releases** → https://github.com/matthias-peterlini/Nexus-client/releases/latest |
| Video promo (`cdn/`) | **Cloudflare Workers** (account personale) → https://nexus-site.matthias-peterlini.workers.dev (`noindex`) |

`index.html` linka `releases/latest/download/<file>` (nomi fissi, puntano sempre all'ultima release)
e legge versione e dimensioni dall'API pubblica `api.github.com/repos/.../releases/latest`,
quindi la pagina si aggiorna da sola a ogni nuova release. I vecchi link
`nexus-site…workers.dev/download/*` vengono reindirizzati alle release (`cdn/_redirects`).

## Pubblicare una nuova versione del launcher

1. Aggiorna `version` in `package.json`, `src-tauri/tauri.conf.json` e `src-tauri/Cargo.toml`.
2. Commit, poi crea e pusha il tag:

   ```powershell
   git tag v0.3.0
   git push origin main v0.3.0
   ```

La CI (`.github/workflows/release.yml`) compila Windows (`nexus-launcher-setup.exe`, `.msi`),
macOS (`nexus-launcher.dmg`, universale Intel + Apple Silicon) e Linux (`.AppImage`, `.deb`, `.rpm`)
e crea la GitHub Release con quei file. Nessun secret richiesto.

## Funzione Netlify `has-joined`

`netlify/functions/has-joined.mjs` inoltra la verifica `hasJoined` a Mojang per il server amici
(`server/`, variabile `HASJOINED_URL`): Mojang risponde 403 alle chiamate dirette da Cloudflare Workers.

## Pubblicare la pagina (solo se cambi `public/`)

```powershell
npx netlify-cli deploy --prod --no-build --dir site/public --functions site/netlify/functions --site e1530e25-7c40-4101-9308-2912dea7549b
```

Se modifichi la pagina aggiorna anche `<lastmod>` in `public/sitemap.xml`.

## SEO

- Title, description, canonical, Open Graph/Twitter (`img/og.jpg`, 1200×630)
- Dati strutturati JSON-LD: `WebSite`, `Organization`, `SoftwareApplication`, `FAQPage`
  (le FAQ nel JSON-LD devono restare identiche a quelle visibili nella pagina)
- `robots.txt` + `sitemap.xml`; i file su Cloudflare hanno `X-Robots-Tag: noindex`
- IndexNow (Bing, Yandex…): chiave in `public/<chiave>.txt`

## DNS (zona nexusmc.online nel team Cloudflare Ticly, solo DNS / nuvola grigia)

| Tipo | Nome | Valore |
|---|---|---|
| A | `@` | `75.2.60.5` |
| CNAME | `www` | `lucky-tiramisu-122335.netlify.app` |

## Anteprima locale

```powershell
python -m http.server 8788 -d site/public
```
