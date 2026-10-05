# Sito nexusmc.online

Pagina di download di Nexus Launcher, divisa in due parti:

| Cartella | Dove | Contenuto |
|---|---|---|
| `public/` | **Netlify** → https://nexusmc.online | Pagina, FAQ, immagini, `robots.txt`, `sitemap.xml`, manifest, chiave IndexNow |
| `cdn/` | **Cloudflare Workers** (account personale) → https://nexus-site.matthias-peterlini.workers.dev | Installer, video promo, `download/latest.json` (banda gratuita, `noindex`) |

`index.html` linka i file di `cdn/` con URL assoluti e legge versione/dimensioni da `latest.json`,
quindi la pagina su Netlify si aggiorna da sola a ogni nuova release.

## Pubblicare una nuova versione del launcher

1. Aggiorna `version` in `package.json`, `src-tauri/tauri.conf.json` e `src-tauri/Cargo.toml`.
2. Commit, poi crea e pusha il tag:

   ```powershell
   git tag v0.3.0
   git push origin main v0.3.0
   ```

La CI (`.github/workflows/release.yml`) compila Windows (exe, msi), macOS (dmg universale
Intel + Apple Silicon) e Linux (AppImage, deb, rpm), scrive `latest.json`
(`site/scripts/write-latest.mjs`) e pubblica tutto su Cloudflare. Serve il secret GitHub
`CLOUDFLARE_API_TOKEN` (token Cloudflare con permesso *Workers Scripts: Edit* sull'account personale);
senza, gli installer restano scaricabili come artifact della run.

`site/deploy.ps1` resta per emergenze (solo Windows, da build locale): si rifiuta di pubblicare se
mancano i pacchetti Mac/Linux, perché verrebbero rimossi dal sito (`-Force` per farlo comunque).

## Pubblicare la pagina (solo se cambi `public/`)

```powershell
npx netlify-cli deploy --prod --no-build --dir site/public --site e1530e25-7c40-4101-9308-2912dea7549b
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
