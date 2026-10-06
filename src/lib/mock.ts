// Dati fittizi usati SOLO quando il frontend gira in un browser normale (npm run dev senza Tauri),
// così da poter iterare sulla UI senza il backend Rust.
import type { AccountInfo, Instance, LocalContent, SearchResponse, Settings } from "./types";

const now = Date.now();

const instances: Instance[] = [
  {
    id: "survival-performance-a1b2c3",
    name: "Survival Performance",
    mcVersion: "1.21.1",
    loader: "fabric",
    loaderVersion: "0.16.14",
    versionId: null,
    minRamMb: 1024,
    maxRamMb: 6144,
    jvmArgs: "",
    icon: "swords",
    createdAt: new Date(now - 864e5 * 20).toISOString(),
    lastPlayed: new Date(now - 36e5 * 3).toISOString(),
    playTimeSecs: 86400 + 7200,
  },
  {
    id: "create-tech-d4e5f6",
    name: "Create & Tech",
    mcVersion: "1.20.1",
    loader: "forge",
    loaderVersion: "1.20.1-47.3.0",
    minRamMb: 2048,
    maxRamMb: 8192,
    jvmArgs: "",
    icon: "precision_manufacturing",
    createdAt: new Date(now - 864e5 * 40).toISOString(),
    lastPlayed: new Date(now - 864e5 * 2).toISOString(),
    playTimeSecs: 3600 * 14,
  },
  {
    id: "vanilla-g7h8i9",
    name: "Vanilla pura",
    mcVersion: "1.21.4",
    loader: "vanilla",
    minRamMb: 1024,
    maxRamMb: 4096,
    jvmArgs: "",
    icon: "grass",
    createdAt: new Date(now - 864e5 * 60).toISOString(),
    lastPlayed: null,
    playTimeSecs: 0,
  },
];

const accounts: AccountInfo[] = [
  { uuid: "069a79f444e94726a5befca90e38aaf5", username: "Notch", kind: "microsoft", expiresAt: now / 1000 + 3600, active: true, skinVariant: "CLASSIC" },
];

let settings: Settings = {
  msClientId: "da75b6c4-4946-4202-9b90-06f39bb80605",
  activeAccount: accounts[0].uuid,
  defaultMinRamMb: 1024,
  defaultMaxRamMb: 4096,
  javaPath: null,
  autoJava: true,
  jvmArgs: "",
  optimizedGc: true,
  downloadConcurrency: 24,
  ui: null,
};

const mods: LocalContent[] = [
  { fileName: "sodium-fabric-0.6.13+mc1.21.1.jar", enabled: true, size: 1_050_000, title: "Sodium", versionNumber: "mc1.21.1-0.6.13-fabric", projectId: "AANobbMI", iconUrl: "https://cdn.modrinth.com/data/AANobbMI/295862f4724dc3f78df3447ad6072b2dcd3ef0c9_96.webp", dependency: false },
  { fileName: "lithium-fabric-0.15.0+mc1.21.1.jar", enabled: true, size: 780_000, title: "Lithium", versionNumber: "mc1.21.1-0.15.0-fabric", projectId: "gvQqBUqZ", iconUrl: null, dependency: false },
  { fileName: "fabric-api-0.116.0+1.21.1.jar", enabled: true, size: 2_300_000, title: "Fabric API", versionNumber: "0.116.0+1.21.1", projectId: "P7dR8mSH", iconUrl: null, dependency: true },
  { fileName: "iris-fabric-1.8.8+mc1.21.1.jar.disabled", enabled: false, size: 2_100_000, title: "Iris Shaders", versionNumber: "1.8.8+1.21.1-fabric", projectId: "YL57xq9U", iconUrl: null, dependency: false },
];

const search: SearchResponse = {
  offset: 0,
  limit: 24,
  total_hits: 2,
  hits: [
    {
      project_id: "AANobbMI",
      project_type: "mod",
      slug: "sodium",
      title: "Sodium",
      description: "The fastest and most compatible rendering optimization mod for Minecraft.",
      categories: ["optimization", "fabric"],
      display_categories: ["optimization", "fabric", "neoforge"],
      downloads: 68_000_000,
      follows: 25_000,
      icon_url: null,
      author: "jellysquid3",
      versions: ["1.21.1"],
      date_modified: new Date().toISOString(),
      gallery: [],
    },
    {
      project_id: "YL57xq9U",
      project_type: "mod",
      slug: "iris",
      title: "Iris Shaders",
      description: "A modern shader pack loader for Minecraft intended to be compatible with existing OptiFine shader packs",
      categories: ["decoration", "fabric"],
      display_categories: ["decoration", "fabric", "neoforge"],
      downloads: 45_000_000,
      follows: 12_000,
      icon_url: null,
      author: "coderbot",
      versions: ["1.21.1"],
      date_modified: new Date().toISOString(),
      gallery: [],
    },
  ],
};

export async function mockInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  await new Promise((r) => setTimeout(r, 120));
  const out = ((): unknown => {
    switch (cmd) {
      case "get_settings":
        return settings;
      case "save_settings":
        settings = args!.settings as Settings;
        return settings;
      case "system_info":
        return { totalMemoryMb: 16384, os: "windows", arch: "x86_64", cpuCount: 12, dataDir: "C:\\Users\\demo\\AppData\\Roaming\\dev.nexus.launcher" };
      case "list_instances":
        return instances;
      case "get_instance":
        return instances.find((i) => i.id === args!.id);
      case "list_accounts":
        return accounts;
      case "running_instances":
        return {};
      case "get_minecraft_versions":
        return {
          latestRelease: "1.21.4",
          latestSnapshot: "25w10a",
          versions: ["1.21.4", "1.21.3", "1.21.1", "1.21", "1.20.6", "1.20.4", "1.20.1", "1.19.4", "1.18.2", "1.16.5", "1.12.2"].map((id) => ({
            id,
            kind: "release",
            releaseTime: "",
          })),
        };
      case "get_loader_versions":
        return args!.loader === "vanilla" ? [] : [{ id: "0.16.14", stable: true }, { id: "0.16.13", stable: true }];
      case "list_content":
        return args!.dir === "mods" ? mods : [];
      case "modrinth_search":
        return search;
      case "friends_configured":
        return true;
      case "get_friends":
        return {
          configured: true,
          friends: [
            { uuid: "ec561538f3fd461daff5086b22154bce", name: "Alex", favorite: true, online: true, status: "hosting", detail: "Sta hostando Survival Realm", joinAddress: "bore.pub:38421" },
            { uuid: "8667ba71b85a4004af54457a9734eed7", name: "Steve", favorite: false, online: true, status: "playing", detail: "Create & Tech · 1.20.1", joinAddress: "" },
            { uuid: "61699b2ed3274a019f1e0ea8c3f06bc6", name: "Herobrine", favorite: false, online: false, status: "offline", detail: "", joinAddress: "" },
          ],
          incoming: [{ uuid: "b876ec32e396476ba1158438d83c67d4", name: "Technoblade" }],
          outgoing: [
            { uuid: "069a79f444e94726a5befca90e38aaf5", name: "Notch", registered: true },
            { uuid: "853c80ef3c3749fdaa49938b674adae6", name: "jeb_", registered: false },
          ],
        };
      case "search_friends":
        return [
          { uuid: "853c80ef3c3749fdaa49938b674adae6", name: "jeb_", relation: "none", registered: false },
          { uuid: "069a79f444e94726a5befca90e38aaf5", name: "Notch", relation: "outgoing" },
        ];
      case "resolve_mc_name": {
        const n = (args?.name as string) || "";
        return n.length >= 2 ? { uuid: "d8a2f6b04c8e4f5a9b1c2d3e4f5a6b7c", name: n } : null;
      }
      case "send_friend_request":
        return "sent";
      case "respond_friend_request":
      case "remove_friend":
      case "set_friend_favorite":
        return null;
      case "start_tunnel":
        return { active: true, localPort: args?.localPort ?? 25565, remotePort: 38421, publicAddress: "bore.pub:38421", serverHost: "bore.pub" };
      case "stop_tunnel":
        return null;
      case "get_tunnel_status":
        return null;
      case "detect_lan_port":
        return 25565;
      case "apply_material3_theme":
        return null;
      case "is_material3_theme_enabled":
        return true;
      case "ollama_pull":
        return null;
      case "local_ai_status":
        return { engineInstalled: false, serverRunning: false, baseUrl: null, models: [], defaultModel: "llama3.2:1b" };
      case "local_ai_prepare":
        return "http://127.0.0.1:11501";
      case "ollama_chat":
      case "custom_api_chat": {
        // Risposta finta ma realistica: con una richiesta d'azione mostra anche la card eseguibile.
        const msgs = (args?.messages as { role: string; content: string }[] | undefined) ?? [];
        const last = msgs.filter((m) => m.role === "user").pop()?.content.toLowerCase() ?? "";
        if (/istanza|crea|shader|survival/.test(last)) {
          return (
            "Ti preparo un'istanza **Fabric 1.21.1** ottimizzata, con Iris e uno shader leggero.\n\n```nexus-action\n" +
            '{"type":"create_instance","name":"Survival Performance","mcVersion":"1.21.1","loader":"fabric","maxRamMb":6144,' +
            '"mods":["iris","lithium","ferrite-core"],"shaders":["complementary-reimagined"],"resourcepacks":[],' +
            '"summary":"Fabric 1.21.1 con Iris, Lithium, FerriteCore e Complementary Reimagined"}\n```'
          );
        }
        return "Ciao! Sono Nexus Copilot. Come posso aiutarti con le tue istanze e mod?";
      }
      default:
        throw `Comando "${cmd}" disponibile solo nell'app desktop (npm run tauri dev)`;
    }
  })();
  return out as T;
}
