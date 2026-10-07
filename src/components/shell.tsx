import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useMemo, useRef, useState } from "react";
import { isTauri } from "../lib/api";
import { useApp, type Page } from "../lib/store";
import type { AccountInfo, Instance } from "../lib/types";
import { Chip, cn, Icon, IconButton, WavyProgress } from "./ui";

// ---------------------------------------------------------------------------
// Avatar / icone
// ---------------------------------------------------------------------------

export function headUrl(account?: Pick<AccountInfo, "uuid" | "kind"> | null, size = 64) {
  if (!account || account.kind === "offline") return `https://mc-heads.net/avatar/MHF_Steve/${size}`;
  return `https://mc-heads.net/avatar/${account.uuid}/${size}`;
}

/** Render del corpo intero della skin (funziona per qualsiasi account Minecraft, anche senza Nexus). */
export function bodyUrl(uuid: string, size = 128) {
  return `https://mc-heads.net/body/${uuid}/${size}`;
}

export function Avatar({ account, size = 40, className }: { account?: AccountInfo | null; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div
      className={cn("shrink-0 overflow-hidden rounded-xl bg-surface-container-highest", className)}
      style={{ width: size, height: size }}
    >
      {!failed ? (
        <img
          src={headUrl(account, Math.max(64, size * 2))}
          alt=""
          className="size-full [image-rendering:pixelated]"
          onError={() => setFailed(true)}
        />
      ) : (
        <Icon name="person" className="flex size-full items-center justify-center text-on-surface-variant" />
      )}
    </div>
  );
}

const LOADER_ICON: Record<string, string> = {
  vanilla: "grass",
  fabric: "texture",
  quilt: "grid_view",
  forge: "handyman",
  neoforge: "construction",
};

const ICON_TONES = [
  "bg-primary-container text-on-primary-container",
  "bg-secondary-container text-on-secondary-container",
  "bg-tertiary-container text-on-tertiary-container",
];

export function InstanceIcon({ instance, size = 56, className }: { instance: Instance; size?: number; className?: string }) {
  const tone = ICON_TONES[[...instance.id].reduce((a, c) => a + c.charCodeAt(0), 0) % ICON_TONES.length];
  const icon = instance.icon;
  const isUrl = icon?.startsWith("http");
  return (
    <div
      className={cn("flex shrink-0 items-center justify-center overflow-hidden rounded-[30%]", tone, className)}
      style={{ width: size, height: size }}
    >
      {isUrl ? (
        <img src={icon!} alt="" className="size-full object-cover" />
      ) : (
        <Icon name={icon || LOADER_ICON[instance.loader] || "deployed_code"} filled size={size * 0.5} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Title bar (finestra senza decorazioni)
// ---------------------------------------------------------------------------

export function TitleBar() {
  const win = isTauri() ? getCurrentWindow() : null;
  const progress = useApp((s) => s.progress);
  const active = Object.values(progress)[0];
  return (
    <header data-tauri-drag-region className="flex h-11 shrink-0 items-center gap-3 pr-1 pl-5">
      <div data-tauri-drag-region className="flex items-center gap-2.5">
        <img src="/logo.svg" alt="" className="size-6" />
        <span data-tauri-drag-region className="text-[15px] font-semibold tracking-tight" style={{ fontVariationSettings: '"wdth" 120' }}>
          Nexus<span className="text-primary">Launcher</span>
        </span>
      </div>
      <div data-tauri-drag-region className="flex flex-1 items-center justify-center">
        {active && (
          <div className="flex w-72 animate-fade items-center gap-3 text-xs text-on-surface-variant">
            <span className="shrink-0">{active.stage}</span>
            <WavyProgress value={active.total ? active.done / active.total : null} />
            <span className="shrink-0 tabular-nums">
              {active.done}/{active.total}
            </span>
          </div>
        )}
      </div>
      {win && (
        <div className="flex items-center">
          <IconButton icon="remove" label="Riduci" size={36} onClick={() => win.minimize()} />
          <IconButton icon="crop_square" label="Ingrandisci" size={36} onClick={() => win.toggleMaximize()} />
          <IconButton
            icon="close"
            label="Chiudi"
            size={36}
            className="hover:bg-error hover:text-on-error"
            onClick={() => win.close()}
          />
        </div>
      )}
    </header>
  );
}

// ---------------------------------------------------------------------------
// Navigation Rail M3 Expressive
// ---------------------------------------------------------------------------

const NAV: { page: Page; icon: string; label: string }[] = [
  { page: "home", icon: "home", label: "Home" },
  { page: "friends", icon: "group", label: "Amici" },
  { page: "browse", icon: "explore", label: "Esplora" },
  { page: "accounts", icon: "account_circle", label: "Account" },
  { page: "settings", icon: "settings", label: "Impostazioni" },
];

export function NavRail({ onNewInstance }: { onNewInstance: () => void }) {
  const { page, navigate, aiOpen, toggleAi, consoleOpen, toggleConsole, accounts, unreadTotal } = useApp();
  const active = accounts.find((a) => a.active) ?? accounts[0];
  const current = page === "instance" ? "home" : page;
  return (
    <nav className="flex w-24 shrink-0 flex-col items-center gap-2 pt-2 pb-4">
      <button
        type="button"
        onClick={onNewInstance}
        title="Nuova istanza"
        className="state-layer elev-2 mb-5 flex size-14 cursor-pointer items-center justify-center rounded-2xl bg-tertiary-container text-on-tertiary-container transition-[border-radius] duration-300 ease-spring hover:rounded-[20px] active:rounded-[28px]"
      >
        <Icon name="add" size={28} />
      </button>

      {NAV.map((item) => {
        const selected = current === item.page;
        return (
          <button
            key={item.page}
            type="button"
            onClick={() => navigate(item.page)}
            className="group flex w-full cursor-pointer flex-col items-center gap-1 py-1"
          >
            <span
              className={cn(
                "state-layer relative flex h-8 items-center justify-center rounded-full transition-all duration-300 ease-spring",
                selected ? "w-14 bg-secondary-container text-on-secondary-container" : "w-8 text-on-surface-variant group-hover:w-14",
              )}
            >
              <Icon name={item.icon} filled={selected} />
              {item.page === "friends" && unreadTotal > 0 && (
                <span className="absolute -top-0.5 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-error px-1 text-[10px] font-bold text-on-error">
                  {unreadTotal > 9 ? "9+" : unreadTotal}
                </span>
              )}
            </span>
            <span className={cn("text-xs", selected ? "font-bold text-on-surface" : "font-medium text-on-surface-variant")}>
              {item.label}
            </span>
          </button>
        );
      })}

      <div className="flex-1" />

      <IconButton
        icon="auto_awesome"
        label="Modding Copilot (AI)"
        variant={aiOpen ? "filled" : "tonal"}
        selected={aiOpen}
        size={48}
        onClick={() => toggleAi()}
      />
      <IconButton
        icon="terminal"
        label="Console"
        variant="standard"
        selected={consoleOpen}
        size={48}
        onClick={() => toggleConsole()}
      />
      <button
        type="button"
        onClick={() => navigate("accounts")}
        title={active ? active.username : "Accedi"}
        className="mt-2 cursor-pointer rounded-xl transition-transform duration-300 ease-spring hover:scale-105"
      >
        <Avatar account={active} size={40} />
      </button>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Console log integrata
// ---------------------------------------------------------------------------

const LEVEL_COLOR: Record<string, string> = {
  info: "text-on-surface-variant",
  warn: "text-tertiary",
  error: "text-error",
  launcher: "text-primary",
};

export function LogConsole() {
  const { logs, logFilter, setLogFilter, clearLogs, toggleConsole, instances, progress, askAi } = useApp();
  const scroller = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);

  const sources = useMemo(() => [...new Set(logs.map((l) => l.instanceId))], [logs]);
  const visible = useMemo(
    () => (logFilter ? logs.filter((l) => l.instanceId === logFilter) : logs).slice(-1500),
    [logs, logFilter],
  );
  const nameOf = (id: string) => instances.find((i) => i.id === id)?.name ?? id;
  const tasks = Object.values(progress);

  useEffect(() => {
    if (follow && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [visible, follow]);

  return (
    <section className="flex h-72 shrink-0 animate-slide-up flex-col border-t border-outline-variant/40 bg-surface-container-lowest">
      <div className="flex items-center gap-2 px-4 py-2">
        <Icon name="terminal" className="text-primary" />
        <span className="type-label mr-2">Console</span>
        <div className="flex flex-1 items-center gap-1.5 overflow-x-auto">
          <Chip label="Tutto" selected={!logFilter} onClick={() => setLogFilter(null)} />
          {sources.map((id) => (
            <Chip key={id} label={nameOf(id)} selected={logFilter === id} onClick={() => setLogFilter(id)} />
          ))}
        </div>
        {logFilter && (
          <IconButton
            icon="auto_awesome"
            label="Analizza con l'AI"
            size={36}
            onClick={() => askAi(`/crash ${logFilter}`)}
          />
        )}
        <IconButton
          icon="content_copy"
          label="Copia"
          size={36}
          onClick={() => navigator.clipboard.writeText(visible.map((l) => l.line).join("\n"))}
        />
        <IconButton icon="delete_sweep" label="Pulisci" size={36} onClick={clearLogs} />
        <IconButton icon="expand_more" label="Chiudi" size={36} onClick={() => toggleConsole(false)} />
      </div>

      {tasks.length > 0 && (
        <div className="flex flex-col gap-1 px-5 pb-2">
          {tasks.map((t) => (
            <div key={t.task} className="flex items-center gap-3 text-xs text-on-surface-variant">
              <span className="w-40 truncate">
                {nameOf(t.task)} · {t.stage}
              </span>
              <WavyProgress value={t.total ? t.done / t.total : null} />
              <span className="w-24 text-right tabular-nums">
                {t.done}/{t.total}
              </span>
            </div>
          ))}
        </div>
      )}

      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
        }}
        className="selectable min-h-0 flex-1 overflow-y-auto px-5 pb-3 font-mono text-[12px] leading-[1.55]"
      >
        {visible.length === 0 && <p className="py-6 text-center text-on-surface-variant">Nessun output. Avvia un'istanza per vedere i log in tempo reale.</p>}
        {visible.map((l) => (
          <div key={l.id} className={cn("break-all whitespace-pre-wrap", LEVEL_COLOR[l.level])}>
            {!logFilter && <span className="mr-2 text-outline">[{nameOf(l.instanceId)}]</span>}
            {l.line}
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Snackbar
// ---------------------------------------------------------------------------

export function SnackbarHost() {
  const { snacks, dismissSnack } = useApp();
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {snacks.map((s) => (
        <div
          key={s.id}
          className={cn(
            "pointer-events-auto flex max-w-xl min-w-80 animate-pop items-center gap-3 rounded-2xl py-2 pr-2 pl-4 text-sm elev-3",
            s.tone === "error" ? "bg-error-container text-on-error-container" : "bg-inverse-surface text-inverse-on-surface",
          )}
        >
          <Icon name={s.tone === "error" ? "error" : s.tone === "success" ? "check_circle" : "info"} filled size={20} />
          <span className="selectable flex-1 py-1.5">{s.text}</span>
          {s.action && (
            <button
              type="button"
              className="state-layer cursor-pointer rounded-full px-3 py-1.5 font-semibold text-inverse-primary"
              onClick={() => {
                s.action!.run();
                dismissSnack(s.id);
              }}
            >
              {s.action.label}
            </button>
          )}
          <button type="button" className="cursor-pointer p-1 opacity-70 hover:opacity-100" onClick={() => dismissSnack(s.id)}>
            <Icon name="close" size={18} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Notifiche a comparsa (in basso a destra)
// ---------------------------------------------------------------------------

function UpdateCard() {
  const update = useApp((s) => s.update);
  if (!update) return null;
  const text =
    update.stage === "waiting"
      ? "Si installa da solo appena chiudi il gioco."
      : update.stage === "downloading"
        ? `Download in corso${update.progress != null ? ` · ${Math.round(update.progress * 100)}%` : "…"}`
        : "Installazione: Nexus si riavvia tra un attimo.";
  return (
    <div role="status" className="pointer-events-auto flex animate-notice items-start gap-3 rounded-3xl bg-primary-container p-3.5 text-on-primary-container elev-3">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-on-primary">
        <Icon name="system_update_alt" size={22} />
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-sm font-semibold">Aggiornamento a Nexus {update.version}</p>
        <p className="mt-0.5 text-sm opacity-80">{text}</p>
        {update.stage !== "waiting" && <WavyProgress value={update.stage === "downloading" ? update.progress : null} className="mt-2" />}
      </div>
    </div>
  );
}

export function NotificationHost() {
  const { notices, dismissNotice } = useApp();
  return (
    <div className="pointer-events-none fixed right-5 bottom-5 z-[70] flex w-[360px] max-w-[calc(100vw-40px)] flex-col items-stretch gap-2.5">
      <UpdateCard />
      {notices.map((n) => (
        <div
          key={n.id}
          role="status"
          className="pointer-events-auto flex animate-notice items-start gap-3 rounded-3xl bg-surface-container-highest p-3.5 pr-2 text-on-surface elev-3"
        >
          {n.avatarUuid ? (
            <Avatar account={{ uuid: n.avatarUuid, kind: "microsoft", username: "", expiresAt: 0, active: false }} size={40} />
          ) : (
            <div
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-xl",
                n.tone === "error" ? "bg-error-container text-on-error-container" : "bg-primary-container text-on-primary-container",
              )}
            >
              <Icon name={n.icon ?? (n.tone === "error" ? "error" : "check_circle")} filled size={22} />
            </div>
          )}
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="truncate text-sm font-semibold">{n.title}</p>
            {n.body && <p className="mt-0.5 line-clamp-3 text-sm break-words text-on-surface-variant">{n.body}</p>}
            {n.action && (
              <button
                type="button"
                className="state-layer -ml-2 mt-1.5 cursor-pointer rounded-full px-2 py-1 text-sm font-semibold text-primary"
                onClick={() => {
                  n.action!.run();
                  dismissNotice(n.id);
                }}
              >
                {n.action.label}
              </button>
            )}
          </div>
          <button type="button" aria-label="Chiudi" className="cursor-pointer p-1 text-on-surface-variant opacity-70 hover:opacity-100" onClick={() => dismissNotice(n.id)}>
            <Icon name="close" size={18} />
          </button>
        </div>
      ))}
    </div>
  );
}
