// Scrive site/cdn/download/latest.json: versione e dimensioni degli installer presenti,
// lette dalla pagina nexusmc.online. Usato dalla CI (release.yml) e da deploy.ps1.
import { readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dir = join(root, "site", "cdn", "download");
const { version } = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));

const entry = (file) => {
  const p = join(dir, file);
  return existsSync(p) ? { file, size: statSync(p).size } : undefined;
};

const platforms = {
  windows: { exe: entry("nexus-launcher-setup.exe"), msi: entry("nexus-launcher.msi") },
  macos: { dmg: entry("nexus-launcher.dmg") },
  linux: {
    appimage: entry("nexus-launcher.AppImage"),
    deb: entry("nexus-launcher.deb"),
    rpm: entry("nexus-launcher.rpm"),
  },
};

const info = {
  version,
  date: new Date().toISOString(),
  platforms,
  // compatibilità con le versioni precedenti della pagina
  exe: platforms.windows.exe,
  msi: platforms.windows.msi,
};

writeFileSync(join(dir, "latest.json"), JSON.stringify(info, null, 2));
console.log(JSON.stringify(info, null, 2));
