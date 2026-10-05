import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { LogConsole, NavRail, SnackbarHost, TitleBar } from "./components/shell";
import { Spinner } from "./components/ui";
import { AccountsPage } from "./features/accounts/AccountsPage";
import { AiPanel } from "./features/ai/AiPanel";
import { BrowsePage } from "./features/browse/BrowsePage";
import { FriendsPage } from "./features/friends/FriendsPage";
import { HomePage } from "./features/home/HomePage";
import { InstancePage } from "./features/instances/InstancePage";
import { NewInstanceDialog } from "./features/instances/NewInstanceDialog";
import { SettingsPage } from "./features/settings/SettingsPage";
import { api, errorMessage, isTauri } from "./lib/api";
import { useApp } from "./lib/store";
import { applyTheme } from "./lib/theme";
import type { GameExit, GameLog, Progress } from "./lib/types";

function useBackendEvents() {
  useEffect(() => {
    if (!isTauri()) return;
    const s = useApp.getState;
    const subscriptions: Promise<UnlistenFn>[] = [
      listen<Progress>("task-progress", (e) => s().setProgress(e.payload)),
      listen<string>("task-finished", (e) => s().clearProgress(e.payload)),
      listen<GameLog>("game-log", (e) => s().pushLog(e.payload)),
      listen<{ instanceId: string; pid: number }>("game-started", (e) => s().setRunning(e.payload.instanceId, e.payload.pid)),
      listen<GameExit>("game-exit", (e) => {
        const { instanceId, crashed, code } = e.payload;
        s().setRunning(instanceId, null);
        s().refreshInstances();
        if (crashed) {
          s().snack(`Il gioco si è chiuso con un errore (codice ${code ?? "?"})`, "error", {
            label: "Analizza con l'AI",
            run: () => s().askAi(`/crash ${instanceId}`),
          });
        }
      }),
    ];
    return () => {
      subscriptions.forEach((p) => p.then((unlisten) => unlisten()));
    };
  }, []);
}

export default function App() {
  const { page, consoleOpen, aiOpen, ui, loadSettings, refreshInstances, refreshAccounts, setRunning } = useApp();
  const [ready, setReady] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [newInstance, setNewInstance] = useState(false);

  useBackendEvents();

  useEffect(() => {
    (async () => {
      try {
        await loadSettings();
        await Promise.all([refreshInstances(), refreshAccounts()]);
        const running = await api.runningInstances();
        Object.entries(running).forEach(([id, pid]) => setRunning(id, pid));
        setReady(true);
      } catch (e) {
        setFatal(errorMessage(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tema "sistema": segue i cambi del sistema operativo.
  useEffect(() => {
    if (ui.mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme(ui);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [ui]);

  if (fatal) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
        <p className="type-title text-error">Impossibile avviare Nexus</p>
        <p className="selectable max-w-lg text-sm text-on-surface-variant">{fatal}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-surface text-on-surface">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <NavRail onNewInstance={() => setNewInstance(true)} />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-tl-[28px] bg-surface-container-low">
          <main key={page} className="min-h-0 flex-1 animate-fade overflow-y-auto">
            {!ready ? (
              <div className="flex h-full items-center justify-center text-primary">
                <Spinner size={56} />
              </div>
            ) : page === "home" ? (
              <HomePage onNewInstance={() => setNewInstance(true)} />
            ) : page === "instance" ? (
              <InstancePage />
            ) : page === "friends" ? (
              <FriendsPage />
            ) : page === "browse" ? (
              <BrowsePage />
            ) : page === "accounts" ? (
              <AccountsPage />
            ) : (
              <SettingsPage />
            )}
          </main>
          {consoleOpen && <LogConsole />}
        </div>
        {/* Il pannello AI resta montato per non perdere la conversazione */}
        <div className={aiOpen ? "flex pl-2" : "hidden"}>
          <AiPanel />
        </div>
      </div>
      <NewInstanceDialog open={newInstance} onClose={() => setNewInstance(false)} />
      <SnackbarHost />
    </div>
  );
}
