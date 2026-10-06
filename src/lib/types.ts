// Tipi condivisi con il backend Rust (serde camelCase, tranne le risposte Modrinth grezze).

export type Loader = "vanilla" | "fabric" | "quilt" | "forge" | "neoforge";

export interface Instance {
  id: string;
  name: string;
  mcVersion: string;
  loader: Loader;
  loaderVersion?: string | null;
  versionId?: string | null;
  minRamMb: number;
  maxRamMb: number;
  javaPath?: string | null;
  jvmArgs: string;
  windowWidth?: number | null;
  windowHeight?: number | null;
  icon?: string | null;
  createdAt: string;
  lastPlayed?: string | null;
  playTimeSecs: number;
}

export interface CreateInstanceRequest {
  name: string;
  mcVersion: string;
  loader: Loader;
  loaderVersion?: string | null;
  minRamMb?: number;
  maxRamMb?: number;
  icon?: string | null;
}

export interface GameVersion {
  id: string;
  kind: "release" | "snapshot" | "old_beta" | "old_alpha" | string;
  releaseTime: string;
}

export interface GameVersions {
  latestRelease: string;
  latestSnapshot: string;
  versions: GameVersion[];
}

export interface LoaderVersion {
  id: string;
  stable: boolean;
}

export interface CapeItem {
  id: string;
  name: string;
  year?: string;
  description: string;
  imageUrl: string;
  color: string;
}

export interface AccountInfo {
  uuid: string;
  username: string;
  kind: "microsoft" | "offline";
  skinUrl?: string | null;
  skinVariant?: string | null;
  capeUrl?: string | null;
  capeId?: string | null;
  expiresAt: number;
  active: boolean;
}

export type FriendStatus = "online" | "playing" | "hosting" | "offline";

export interface FriendPresence {
  uuid: string;
  name: string;
  favorite: boolean;
  online: boolean;
  status: FriendStatus;
  detail: string;
  joinAddress: string;
  /** Messaggi di chat non letti da questo amico. */
  unread?: number;
}

/** Messaggio della chat tra amici (`created` in millisecondi). */
export interface DirectMessage {
  id: number;
  from: string;
  to: string;
  text: string;
  created: number;
}

export interface UserRef {
  uuid: string;
  name: string;
  /** false = non ha ancora mai aperto Nexus (si può invitare). */
  registered?: boolean;
}

export interface FriendsData {
  configured: boolean;
  friends: FriendPresence[];
  incoming: UserRef[];
  outgoing: UserRef[];
  /** Motivo per cui il server amici non ha risposto. */
  error?: string | null;
}

export type FriendRelation = "self" | "friend" | "outgoing" | "incoming" | "none";

export interface SearchUser {
  uuid: string;
  name: string;
  registered?: boolean;
  relation: FriendRelation;
}

export interface TunnelInfo {
  active: boolean;
  localPort: number;
  remotePort: number;
  publicAddress: string;
  serverHost: string;
}

export interface DeviceCode {
  userCode: string;
  deviceCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
  message: string;
}

export interface UiPrefs {
  seedColor: string;
  variant: SchemeVariant;
  mode: "dark" | "light" | "system";
  ai: AiPrefs;
}

export type SchemeVariant = "tonalSpot" | "expressive" | "vibrant" | "fidelity";

export type AiProvider = "local" | "custom" | "ollama";

export interface AiPrefs {
  provider: AiProvider;
  /** Modello per il motore locale auto-gestito (leggero, es. qwen2.5:0.5b). */
  localModel: string;
  customEndpoint: string;
  customApiKey: string;
  customModel: string;
  ollamaUrl: string;
  ollamaModel: string;
}

/** Modelli locali leggeri consigliati (scaricati al primo uso). */
export interface LocalModelPreset {
  id: string;
  label: string;
  size: string;
}

export interface LocalAiStatus {
  engineInstalled: boolean;
  serverRunning: boolean;
  baseUrl?: string | null;
  models: string[];
  defaultModel: string;
}

export interface Settings {
  msClientId: string;
  activeAccount?: string | null;
  defaultMinRamMb: number;
  defaultMaxRamMb: number;
  javaPath?: string | null;
  autoJava: boolean;
  jvmArgs: string;
  optimizedGc: boolean;
  downloadConcurrency: number;
  socialUrl?: string | null;
  ui: Partial<UiPrefs> | null;
}

export interface JavaInstall {
  path: string;
  version: string;
  major: number;
  managed: boolean;
}

export interface SystemInfo {
  totalMemoryMb: number;
  os: string;
  arch: string;
  cpuCount: number;
  dataDir: string;
}

export interface Progress {
  task: string;
  stage: string;
  done: number;
  total: number;
  bytes: number;
}

export type LogLevel = "info" | "warn" | "error" | "launcher";

export interface GameLog {
  instanceId: string;
  level: LogLevel;
  line: string;
}

export interface GameExit {
  instanceId: string;
  code: number | null;
  crashed: boolean;
  durationSecs: number;
}

export type ProjectType = "mod" | "modpack" | "shader" | "resourcepack";

export interface SearchHit {
  project_id: string;
  project_type: ProjectType;
  slug: string;
  title: string;
  description: string;
  categories: string[];
  display_categories: string[];
  downloads: number;
  follows: number;
  icon_url?: string | null;
  author: string;
  versions: string[];
  date_modified: string;
  gallery: string[];
  color?: number | null;
}

export interface SearchResponse {
  hits: SearchHit[];
  offset: number;
  limit: number;
  total_hits: number;
}

export interface ContentEntry {
  projectId: string;
  versionId: string;
  versionNumber: string;
  title: string;
  projectType: string;
  fileName: string;
  dir: string;
  iconUrl?: string | null;
  dependency: boolean;
}

export type ContentDir = "mods" | "shaderpacks" | "resourcepacks";

export interface LocalContent {
  fileName: string;
  enabled: boolean;
  size: number;
  title: string;
  versionNumber?: string | null;
  projectId?: string | null;
  iconUrl?: string | null;
  dependency: boolean;
}

export interface Finding {
  severity: "error" | "warning";
  title: string;
  detail: string;
  suggestion: string;
}

export interface CrashAnalysis {
  findings: Finding[];
  excerpt: string;
  crashReportFile?: string | null;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
