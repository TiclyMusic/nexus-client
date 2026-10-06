// Wrapper tipizzati attorno ai comandi `invoke` del backend Rust.
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type {
  AccountInfo,
  ChatMessage,
  ContentDir,
  ContentEntry,
  CrashAnalysis,
  CreateInstanceRequest,
  DeviceCode,
  DirectMessage,
  Group,
  GroupMessage,
  FriendsData,
  SearchUser,
  GameVersions,
  Instance,
  JavaInstall,
  Loader,
  LoaderVersion,
  LocalAiStatus,
  LocalContent,
  ProjectType,
  SearchResponse,
  Settings,
  SystemInfo,
  TunnelInfo,
} from "./types";

export const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** In Tauri chiama il backend Rust; in un browser normale usa dati mock (solo per sviluppo UI). */
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri()) return tauriInvoke<T>(cmd, args);
  const { mockInvoke } = await import("./mock");
  return mockInvoke<T>(cmd, args);
}

export const api = {
  // Impostazioni
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<Settings>("save_settings", { settings }),
  systemInfo: () => invoke<SystemInfo>("system_info"),
  detectJava: () => invoke<JavaInstall[]>("detect_java"),
  fetchTexture: (url: string) => invoke<string>("fetch_texture", { url }),

  // Account
  authStart: () => invoke<DeviceCode>("auth_start"),
  authComplete: (code: DeviceCode) => invoke<AccountInfo>("auth_complete", { code }),
  authCancel: () => invoke<void>("auth_cancel"),
  listAccounts: () => invoke<AccountInfo[]>("list_accounts"),
  setActiveAccount: (uuid: string) => invoke<void>("set_active_account", { uuid }),
  removeAccount: (uuid: string) => invoke<void>("remove_account", { uuid }),
  refreshAccount: (uuid: string) => invoke<AccountInfo>("refresh_account", { uuid }),
  addOfflineAccount: (username: string) => invoke<AccountInfo>("add_offline_account", { username }),

  // Versioni
  minecraftVersions: () => invoke<GameVersions>("get_minecraft_versions"),
  loaderVersions: (loader: Loader, mcVersion: string) =>
    invoke<LoaderVersion[]>("get_loader_versions", { loader, mcVersion }),

  // Istanze
  listInstances: () => invoke<Instance[]>("list_instances"),
  getInstance: (id: string) => invoke<Instance>("get_instance", { id }),
  createInstance: (request: CreateInstanceRequest) => invoke<Instance>("create_instance", { request }),
  updateInstance: (instance: Instance) => invoke<Instance>("update_instance", { instance }),
  cloneInstance: (id: string, name: string) => invoke<Instance>("clone_instance", { id, name }),
  deleteInstance: (id: string) => invoke<void>("delete_instance", { id }),
  openInstanceFolder: (id: string) => invoke<void>("open_instance_folder", { id }),
  installInstance: (id: string, verify = false) => invoke<Instance>("install_instance", { id, verify }),
  launchInstance: (id: string) => invoke<number>("launch_instance", { id }),
  killInstance: (id: string) => invoke<void>("kill_instance", { id }),
  runningInstances: () => invoke<Record<string, number>>("running_instances"),

  // Contenuti / Modrinth
  search: (p: {
    query: string;
    projectType: ProjectType;
    gameVersion?: string | null;
    loader?: string | null;
    offset?: number;
    sort?: string;
  }) => invoke<SearchResponse>("modrinth_search", p),
  installProject: (instanceId: string, project: string, versionId?: string | null) =>
    invoke<ContentEntry[]>("modrinth_install", { instanceId, project, versionId }),
  installModpack: (project: string, versionId?: string | null, name?: string | null) =>
    invoke<Instance>("modrinth_install_modpack", { project, versionId, name }),
  listContent: (instanceId: string, dir: ContentDir) => invoke<LocalContent[]>("list_content", { instanceId, dir }),
  toggleContent: (instanceId: string, dir: ContentDir, fileName: string, enabled: boolean) =>
    invoke<string>("toggle_content", { instanceId, dir, fileName, enabled }),
  deleteContent: (instanceId: string, dir: ContentDir, fileName: string) =>
    invoke<void>("delete_content", { instanceId, dir, fileName }),

  // AI
  analyzeCrash: (instanceId: string) => invoke<CrashAnalysis>("analyze_crash", { instanceId }),
  ollamaModels: (baseUrl: string) => invoke<string[]>("ollama_models", { baseUrl }),
  ollamaPull: (baseUrl: string, model: string) => invoke<void>("ollama_pull", { baseUrl, model }),
  ollamaChat: (requestId: string, baseUrl: string, model: string, messages: ChatMessage[]) =>
    invoke<string>("ollama_chat", { requestId, baseUrl, model, messages }),
  customApiChat: (requestId: string, endpoint: string, apiKey: string, model: string, messages: ChatMessage[]) =>
    invoke<string>("custom_api_chat", { requestId, endpoint, apiKey, model, messages }),

  // Motore AI locale auto-gestito (si installa al primo uso)
  localAiStatus: () => invoke<LocalAiStatus>("local_ai_status"),
  localAiPrepare: (model?: string) => invoke<string>("local_ai_prepare", { model }),

  // Tunnel: si apre da solo con "Apri in LAN"
  getTunnelStatus: () => invoke<TunnelInfo | null>("get_tunnel_status"),

  // Amici
  friendsConfigured: () => invoke<boolean>("friends_configured"),
  getFriends: () => invoke<FriendsData>("get_friends"),
  searchFriends: (query: string) => invoke<SearchUser[]>("search_friends", { query }),
  resolveMcName: (name: string) => invoke<{ uuid: string; name: string } | null>("resolve_mc_name", { name }),
  sendFriendRequest: (uuid: string, name?: string) => invoke<string>("send_friend_request", { uuid, name }),
  respondFriendRequest: (uuid: string, accept: boolean) =>
    invoke<void>("respond_friend_request", { uuid, accept }),
  removeFriend: (uuid: string) => invoke<void>("remove_friend", { uuid }),
  setFriendFavorite: (uuid: string, favorite: boolean) =>
    invoke<void>("set_friend_favorite", { uuid, favorite }),
  getChatMessages: (uuid: string, after?: number) => invoke<DirectMessage[]>("get_chat_messages", { uuid, after: after ?? 0 }),
  sendChatMessage: (uuid: string, text: string) => invoke<DirectMessage>("send_chat_message", { uuid, text }),

  // Gruppi
  getGroups: () => invoke<Group[]>("get_groups"),
  createGroup: (name: string, members: string[]) => invoke<number>("create_group", { name, members }),
  addGroupMembers: (id: number, members: string[]) => invoke<void>("add_group_members", { id, members }),
  renameGroup: (id: number, name: string) => invoke<void>("rename_group", { id, name }),
  kickGroupMember: (id: number, uuid: string) => invoke<void>("kick_group_member", { id, uuid }),
  leaveGroup: (id: number) => invoke<void>("leave_group", { id }),
  getGroupMessages: (id: number, after?: number) => invoke<GroupMessage[]>("get_group_messages", { id, after: after ?? 0 }),
  sendGroupMessage: (id: number, text: string) => invoke<GroupMessage>("send_group_message", { id, text }),

  // Material 3 In-Game Theme
  applyMaterial3Theme: (instanceId: string, enabled: boolean) =>
    invoke<void>("apply_material3_theme", { instanceId, enabled }),
  isMaterial3ThemeEnabled: (instanceId: string) =>
    invoke<boolean>("is_material3_theme_enabled", { instanceId }),
};

export function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
