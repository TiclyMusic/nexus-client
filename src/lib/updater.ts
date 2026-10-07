// Aggiornamento automatico del launcher (tauri-plugin-updater, pacchetti firmati).
import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { errorMessage, isTauri } from "./api";
import { useApp } from "./store";

const CHECK_EVERY_MS = 30 * 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let busy = false;

async function run() {
  if (busy) return;
  busy = true;
  const s = useApp.getState;
  try {
    const update = await check();
    if (!update) return;
    const version = update.version;
    s().setUpdate({ version, stage: "waiting", progress: null });

    // non interrompere una partita: si installa quando il gioco è chiuso
    while (Object.keys(s().running).length > 0) await sleep(10_000);

    let total = 0;
    let done = 0;
    s().setUpdate({ version, stage: "downloading", progress: 0 });
    await update.downloadAndInstall((e) => {
      if (e.event === "Started") total = e.data.contentLength ?? 0;
      else if (e.event === "Progress") {
        done += e.data.chunkLength;
        s().setUpdate({ version, stage: "downloading", progress: total ? done / total : null });
      } else if (e.event === "Finished") s().setUpdate({ version, stage: "installing", progress: null });
    });
    s().setUpdate({ version, stage: "installing", progress: null });
    await relaunch();
  } catch (e) {
    // es. Linux installato da .deb/.rpm: l'aggiornamento automatico vale solo per l'AppImage
    const pending = s().update;
    s().setUpdate(null);
    if (pending) {
      s().notify({
        title: `Aggiornamento ${pending.version} non installato`,
        body: errorMessage(e),
        tone: "error",
        action: { label: "Scarica dal sito", run: () => openUrl("https://nexusmc.online") },
      });
    } else {
      console.warn("updater", errorMessage(e));
    }
  } finally {
    busy = false;
  }
}

/** Controlla subito e poi ogni 30 minuti. */
export function startAutoUpdate() {
  if (!isTauri()) return;
  run();
  setInterval(run, CHECK_EVERY_MS);
}
