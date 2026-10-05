# Sito nexusmc.online

Pagina di download di Nexus Launcher, divisa in due parti:

| Cartella | Dove | Contenuto |
|---|---|---|
| `public/` | **Netlify** → https://nexusmc.online | Pagina, FAQ, immagini, `robots.txt`, `sitemap.xml`, manifest, chiave IndexNow |
| `cdn/` | **Cloudflare Workers** (account personale) → https://nexus-site.matthias-peterlini.workers.dev | Installer, video promo, `download/latest.json` (banda gratuita, `noindex`) |

`index.html` linka i file di `cdn/` con URL assoluti e legge versione/dimensioni da `latest.json`,
quindi la pagina su Netlify si aggiorna da sola a ogni nuova release.

## Pubblicare una nuova versione del launcher

```powershell
npm run tauri build
cd site
./deploy.ps1
```

`deploy.ps1` copia l'installer NSIS/MSI più recente in `cdn/download/` (link stabili
`nexus-launcher-setup.exe` e `nexus-launcher.msi`), scrive `latest.json` e fa `wrangler deploy`.

## Pubblicare la pagina (solo se cambi `public/`)

```powershell
npx netlify-cli deploy --prod --dir site/public --site lucky-tiramisu-122335
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
