import { create } from "zustand";
import { api, errorMessage } from "./api";
import { applyTheme, DEFAULT_UI } from "./theme";
import type { AccountInfo, FriendsData, GameLog, Group, InboxMessage, Instance, Progress, ProjectType, Settings, SystemInfo, UiPrefs } from "./types";

export type Page = "home" | "instance" | "browse" | "accounts" | "settings" | "friends";

export interface LogLine extends GameLog {
  id: number;
  ts: number;
}

export interface Snack {
  id: number;
  text: string;
  tone: "info" | "error" | "success";
  action?: { label: string; run: () => void };
}

/** Notifica a comparsa in basso a destra (installazioni completate, messaggi di chat). */
export interface Notice {
  id: number;
  title: string;
  body?: string;
  icon?: string;
  /** Mostra la testa Minecraft di questo giocatore al posto dell'icona. */
  avatarUuid?: string;
  tone?: "info" | "success" | "error";
  action?: { label: string; run: () => void };
}

/** Chat aperta: privata con un amico o di gruppo. */
export type ChatTarget = { kind: "direct"; uuid: string; name: string } | { kind: "group"; id: number; name: string };

interface BrowseTarget {
  instanceId?: string;
  type?: ProjectType;
}

interface AppStore {
  page: Page;
  selectedInstanceId: string | null;
  browseTarget: BrowseTarget;
  navigate: (page: Page) => void;
  openInstance: (id: string) => void;
  openBrowse: (target: BrowseTarget) => void;

  instances: Instance[];
  refreshInstances: () => Promise<void>;
  accounts: AccountInfo[];
  refreshAccounts: () => Promise<void>;
  friends: FriendsData;
  refreshFriends: () => Promise<void>;
  /** Messaggi di chat non letti in totale (badge su "Amici"). */
  unreadTotal: number;
  setUnreadTotal: (n: number) => void;
  groups: Group[];
  refreshGroups: () => Promise<void>;
  chat: ChatTarget | null;
  openChat: (target: ChatTarget) => void;
  closeChat: () => void;
  /** Nuovo messaggio dal server (evento "social-message"). */
  onInboxMessage: (m: InboxMessage) => void;

  settings: Settings | null;
  ui: UiPrefs;
  system: SystemInfo | null;
  loadSettings: () => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  updateUi: (patch: Partial<UiPrefs>) => Promise<void>;

  progress: Record<string, Progress>;
  setProgress: (p: Progress) => void;
  clearProgress: (task: string) => void;

  running: Record<string, number>;
  setRunning: (id: string, pid: number | null) => void;

  logs: LogLine[];
  logFilter: string | null;
  pushLog: (log: GameLog) => void;
  clearLogs: () => void;
  setLogFilter: (id: string | null) => void;

  consoleOpen: boolean;
  aiOpen: boolean;
  toggleConsole: (open?: boolean) => void;
  toggleAi: (open?: boolean) => void;
  aiDraft: string | null;
  askAi: (prompt: string) => void;
  consumeAiDraft: () => string | null;

  snacks: Snack[];
  snack: (text: string, tone?: Snack["tone"], action?: Snack["action"]) => void;
  dismissSnack: (id: number) => void;
  notices: Notice[];
  notify: (n: Omit<Notice, "id">) => void;
  dismissNotice: (id: number) => void;

  launch: (id: string) => Promise<void>;
}

const MAX_LOG_LINES = 5000;
let logSeq = 0;
let snackSeq = 0;
let noticeSeq = 0;
let settingsSeq = 0;

const countUnread = (friends: FriendsData, groups: Group[]) =>
  friends.friends.reduce((sum, f) => sum + (f.unread ?? 0), 0) + groups.reduce((sum, g) => sum + (g.unread ?? 0), 0);

function mergeUi(raw: Partial<UiPrefs> | null | undefined): UiPrefs {
  return { ...DEFAULT_UI, ...(raw ?? {}), ai: { ...DEFAULT_UI.ai, ...(raw?.ai ?? {}) } };
}

export const useApp = create<AppStore>((set, get) => ({
  page: "home",
  selectedInstanceId: null,
  browseTarget: {},
  navigate: (page) => set({ page }),
  openInstance: (id) => set({ page: "instance", selectedInstanceId: id }),
  openBrowse: (target) => set({ page: "browse", browseTarget: target }),

  instances: [],
  refreshInstances: async () => {
    try {
      set({ instances: await api.listInstances() });
    } catch (e) {
      get().snack(errorMessage(e), "error");
    }
  },
  accounts: [],
  refreshAccounts: async () => {
    try {
      set({ accounts: await api.listAccounts() });
    } catch (e) {
      get().snack(errorMessage(e), "error");
    }
  },
  friends: { configured: false, friends: [], incoming: [], outgoing: [] },
  unreadTotal: 0,
  setUnreadTotal: (n) => {
    const prev = get().unreadTotal;
    set({ unreadTotal: n });
    // il totale è cambiato: aggiorna i badge per amico e per gruppo
    if (n !== prev) {
      get().refreshFriends();
      get().refreshGroups();
    }
  },
  refreshFriends: async () => {
    try {
      const friends = await api.getFriends();
      set({ friends, unreadTotal: countUnread(friends, get().groups) });
    } catch (e) {
      // errori del server amici non devono spammare snackbar: li mostra la pagina
      console.warn("refreshFriends", errorMessage(e));
    }
  },
  groups: [],
  refreshGroups: async () => {
    try {
      const groups = await api.getGroups();
      set({ groups, unreadTotal: countUnread(get().friends, groups) });
    } catch (e) {
      console.warn("refreshGroups", errorMessage(e));
    }
  },
  chat: null,
  openChat: (chat) => set({ chat }),
  closeChat: () => {
    set({ chat: null });
    // la chat segna i messaggi come letti: aggiorna i badge
    get().refreshFriends();
    get().refreshGroups();
  },
  onInboxMessage: (m) => {
    const { chat, notify, openChat } = get();
    const target: ChatTarget =
      m.kind === "group" ? { kind: "group", id: m.groupId ?? 0, name: m.groupName || "Gruppo" } : { kind: "direct", uuid: m.from, name: m.name };
    // già nella chat giusta: il messaggio compare lì, niente notifica
    const open = chat && (chat.kind === "group" ? target.kind === "group" && chat.id === target.id : target.kind === "direct" && chat.uuid === target.uuid);
    if (open) return;
    notify({
      title: m.kind === "group" ? `${m.name} · ${m.groupName ?? "Gruppo"}` : m.name || "Nuovo messaggio",
      body: m.text.length > 140 ? `${m.text.slice(0, 140)}…` : m.text,
      avatarUuid: m.from,
      action: { label: "Rispondi", run: () => openChat(target) },
    });
  },

  settings: null,
  ui: DEFAULT_UI,
  system: null,
  loadSettings: async () => {
    const [settings, system] = await Promise.all([api.getSettings(), api.systemInfo()]);
    const ui = mergeUi(settings.ui);
    applyTheme(ui);
    set({ settings, system, ui });
  },
  updateSettings: async (patch) => {
    const current = get().settings;
    if (!current) return;
    const optimistic = { ...current, ...patch };
    const seq = ++settingsSeq;
    set({ settings: optimistic });
    try {
      const saved = await api.saveSettings(optimistic);
      // ignora risposte arrivate dopo una modifica più recente (digitazione veloce)
      if (seq === settingsSeq) set({ settings: saved });
    } catch (e) {
      if (seq === settingsSeq) set({ settings: current });
      get().snack(errorMessage(e), "error");
    }
  },
  updateUi: async (patch) => {
    const ui = { ...get().ui, ...patch };
    applyTheme(ui);
    set({ ui });
    await get().updateSettings({ ui });
  },

  progress: {},
  setProgress: (p) => set((s) => ({ progress: { ...s.progress, [p.task]: p } })),
  clearProgress: (task) =>
    set((s) => {
      const progress = { ...s.progress };
      delete progress[task];
      return { progress };
    }),

  running: {},
  setRunning: (id, pid) =>
    set((s) => {
      const running = { ...s.running };
      if (pid === null) delete running[id];
      else running[id] = pid;
      return { running };
    }),

  logs: [],
  logFilter: null,
  pushLog: (log) =>
    set((s) => {
      const line: LogLine = { ...log, id: ++logSeq, ts: Date.now() };
      const logs = s.logs.length >= MAX_LOG_LINES ? [...s.logs.slice(-MAX_LOG_LINES + 500), line] : [...s.logs, line];
      return { logs };
    }),
  clearLogs: () => set({ logs: [] }),
  setLogFilter: (id) => set({ logFilter: id }),

  consoleOpen: false,
  aiOpen: false,
  toggleConsole: (open) => set((s) => ({ consoleOpen: open ?? !s.consoleOpen })),
  toggleAi: (open) => set((s) => ({ aiOpen: open ?? !s.aiOpen })),
  aiDraft: null,
  askAi: (prompt) => set({ aiOpen: true, aiDraft: prompt }),
  consumeAiDraft: () => {
    const d = get().aiDraft;
    if (d) set({ aiDraft: null });
    return d;
  },

  snacks: [],
  snack: (text, tone = "info", action) => {
    const id = ++snackSeq;
    set((s) => ({ snacks: [...s.snacks.slice(-2), { id, text, tone, action }] }));
    setTimeout(() => get().dismissSnack(id), tone === "error" ? 8000 : 4500);
  },
  dismissSnack: (id) => set((s) => ({ snacks: s.snacks.filter((x) => x.id !== id) })),
  notices: [],
  notify: (n) => {
    const id = ++noticeSeq;
    set((s) => ({ notices: [...s.notices.slice(-3), { ...n, id }] }));
    setTimeout(() => get().dismissNotice(id), 7000);
  },
  dismissNotice: (id) => set((s) => ({ notices: s.notices.filter((x) => x.id !== id) })),

  launch: async (id) => {
    const { snack, setLogFilter, toggleConsole } = get();
    if (!get().accounts.length) {
      snack("Aggiungi un account prima di giocare", "error", {
        label: "Account",
        run: () => get().navigate("accounts"),
      });
      return;
    }
    setLogFilter(id);
    toggleConsole(true);
    try {
      const pid = await api.launchInstance(id);
      get().setRunning(id, pid);
      get().refreshInstances();
    } catch (e) {
      snack(errorMessage(e), "error", {
        label: "Chiedi all'AI",
        run: () => get().askAi(`L'avvio dell'istanza "${id}" è fallito con questo errore:\n\n${errorMessage(e)}\n\nCome lo risolvo?`),
      });
    }
  },
}));
