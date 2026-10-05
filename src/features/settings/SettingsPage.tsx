import { openUrl } from "@tauri-apps/plugin-opener";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState, type ReactNode } from "react";
import { api, errorMessage } from "../../lib/api";
import { gb } from "../../lib/format";
import { useApp } from "../../lib/store";
import { SEED_PRESETS } from "../../lib/theme";
import { LOCAL_MODEL_PRESETS } from "../ai/providers";
import type { JavaInstall } from "../../lib/types";
import { Badge, Button, cn, Icon, Segmented, Slider, Switch, TextField } from "../../components/ui";

const API_PRESETS = [
  {
    name: "Groq",
    tag: "Ultraveloce",
    desc: "~500 token/sec, tier gratuito disponibile",
    endpoint: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
  },
  {
    name: "OpenAI",
    tag: "Ufficiale",
    desc: "GPT-4o mini, economico e affidabile",
    endpoint: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
  },
  {
    name: "OpenRouter",
    tag: "Multi-Provider",
    desc: "Decine di modelli, inclusi modelli gratuiti",
    endpoint: "https://openrouter.ai/api/v1",
    model: "meta-llama/llama-3.2-3b-instruct:free",
  },
  {
    name: "NVIDIA NIM",
    tag: "Accelerato",
    desc: "Modelli Llama e Nemotron su cloud NVIDIA",
    endpoint: "https://integrate.api.nvidia.com/v1",
    model: "meta/llama-3.3-70b-instruct",
  },
];

const OLLAMA_LIGHT_MODELS = [
  {
    id: "llama3.2:1b",
    name: "Llama 3.2 1B",
    size: "~1.3 GB",
    badge: "Consigliato · Velocissimo",
    desc: "Ultra-rapido su qualsiasi processore (anche senza scheda video dedicata), minima RAM.",
  },
  {
    id: "llama3.2:3b",
    name: "Llama 3.2 3B",
    size: "~2.0 GB",
    badge: "Bilanciato",
    desc: "Più intelligente nel comprendere richieste complesse di modding e shader.",
  },
  {
    id: "qwen2.5:1.5b",
    name: "Qwen 2.5 1.5B",
    size: "~1.0 GB",
    badge: "Specialista JSON",
    desc: "Leggerissimo e molto accurato nell'emissione di azioni strutturate.",
  },
];

function Section({ icon, title, children }: { icon: string; title: string; children: ReactNode }) {
  return (
    <section className="animate-enter rounded-[32px] bg-surface-container p-6">
      <h2 className="type-title mb-5 flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-secondary-container text-on-secondary-container">
          <Icon name={icon} size={22} />
        </span>
        {title}
      </h2>
      <div className="flex flex-col gap-5">{children}</div>
    </section>
  );
}

function Row({ title, text, children }: { title: string; text?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-6">
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        {text && <p className="text-sm text-on-surface-variant">{text}</p>}
      </div>
      {children}
    </div>
  );
}

export function SettingsPage() {
  const { settings, ui, system, updateSettings, updateUi, snack } = useApp();
  const [javas, setJavas] = useState<JavaInstall[] | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [pullingModel, setPullingModel] = useState<string | null>(null);
  const [pullProgress, setPullProgress] = useState<{ stage: string; done: number; total?: number } | null>(null);
  const [clientId, setClientId] = useState(settings?.msClientId ?? "");

  useEffect(() => {
    // Monitora il progresso del download modelli Ollama
    const unlistenProgress = listen<{ task: string; stage: string; done: number; total?: number }>(
      "task-progress",
      (e) => {
        if (e.payload.task.startsWith("ollama-pull-")) {
          setPullProgress(e.payload);
        }
      },
    );
    const unlistenFinish = listen<string>("task-finished", (e) => {
      if (e.payload.startsWith("ollama-pull-")) {
        setPullingModel(null);
        setPullProgress(null);
      }
    });

    return () => {
      unlistenProgress.then((u) => u());
      unlistenFinish.then((u) => u());
    };
  }, []);

  if (!settings) return null;
  const maxRam = Math.max(4096, Math.floor(((system?.totalMemoryMb ?? 16384) * 0.85) / 512) * 512);

  return (
    <div className="flex max-w-4xl flex-col gap-5 px-10 pt-8 pb-12">
      <h1 className="type-headline animate-enter">Impostazioni</h1>

      <Section icon="palette" title="Aspetto">
        <div>
          <p className="mb-3 font-medium">Colore dinamico (Material You)</p>
          <div className="flex flex-wrap items-center gap-3">
            {SEED_PRESETS.map((p) => {
              const selected = ui.seedColor.toLowerCase() === p.hex;
              return (
                <button
                  key={p.hex}
                  type="button"
                  title={p.name}
                  onClick={() => updateUi({ seedColor: p.hex })}
                  className={cn(
                    "flex size-12 cursor-pointer items-center justify-center transition-[border-radius,transform] duration-300 ease-spring hover:scale-110",
                    selected ? "rounded-2xl ring-2 ring-on-surface ring-offset-2 ring-offset-surface-container" : "rounded-full",
                  )}
                  style={{ background: p.hex }}
                >
                  {selected && <Icon name="check" className="text-white drop-shadow" />}
                </button>
              );
            })}
            <label className="flex size-12 cursor-pointer items-center justify-center rounded-full border-2 border-dashed border-outline" title="Colore personalizzato">
              <Icon name="colorize" className="text-on-surface-variant" />
              <input type="color" value={ui.seedColor} onChange={(e) => updateUi({ seedColor: e.target.value })} className="sr-only" />
            </label>
          </div>
        </div>
        <div>
          <p className="mb-2 font-medium">Stile della palette</p>
          <Segmented
            value={ui.variant}
            onChange={(variant) => updateUi({ variant })}
            options={[
              { value: "vibrant", label: "Vibrant" },
              { value: "expressive", label: "Expressive" },
              { value: "tonalSpot", label: "Tonal" },
              { value: "fidelity", label: "Fidelity" },
            ]}
          />
        </div>
        <div>
          <p className="mb-2 font-medium">Tema</p>
          <Segmented
            value={ui.mode}
            onChange={(mode) => updateUi({ mode })}
            options={[
              { value: "dark", label: "Scuro", icon: "dark_mode" },
              { value: "light", label: "Chiaro", icon: "light_mode" },
              { value: "system", label: "Sistema", icon: "contrast" },
            ]}
          />
        </div>
      </Section>

      <Section icon="memory" title="Java & prestazioni">
        <div>
          <div className="mb-1 flex justify-between">
            <p className="font-medium">RAM predefinita per le nuove istanze</p>
            <span className="font-semibold text-primary">{gb(settings.defaultMaxRamMb)}</span>
          </div>
          <Slider
            value={settings.defaultMaxRamMb}
            min={1024}
            max={maxRam}
            step={512}
            format={gb}
            onChange={(v) => updateSettings({ defaultMaxRamMb: v })}
          />
        </div>
        <Row title="Scarica Java automaticamente" text="Usa il runtime Java ufficiale Mojang richiesto da ogni versione (8, 17, 21…).">
          <Switch checked={settings.autoJava} onChange={(v) => updateSettings({ autoJava: v })} />
        </Row>
        <Row title="Flag GC ottimizzati" text="G1GC con parametri a bassa latenza per ridurre gli scatti.">
          <Switch checked={settings.optimizedGc} onChange={(v) => updateSettings({ optimizedGc: v })} />
        </Row>
        <TextField
          label="Path Java globale (opzionale)"
          icon="coffee"
          value={settings.javaPath ?? ""}
          onChange={(e) => updateSettings({ javaPath: e.target.value || null })}
        />
        <TextField
          label="Argomenti JVM globali"
          icon="code"
          value={settings.jvmArgs}
          onChange={(e) => updateSettings({ jvmArgs: e.target.value })}
        />
        <div>
          <Button
            variant="tonal"
            icon="search"
            loading={detecting}
            onClick={async () => {
              setDetecting(true);
              setJavas(await api.detectJava().catch(() => []));
              setDetecting(false);
            }}
          >
            Rileva installazioni Java
          </Button>
          {javas && (
            <div className="mt-3 flex flex-col gap-1 overflow-hidden rounded-2xl">
              {javas.length === 0 && <p className="text-sm text-on-surface-variant">Nessuna installazione trovata.</p>}
              {javas.map((j) => (
                <button
                  key={j.path}
                  type="button"
                  onClick={() => updateSettings({ javaPath: j.path })}
                  className="state-layer flex cursor-pointer items-center gap-3 bg-surface-container-high px-4 py-2.5 text-left text-sm"
                >
                  <Badge tone={j.managed ? "primary" : "secondary"}>Java {j.major}</Badge>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{j.path}</span>
                  <span className="text-xs text-on-surface-variant">{j.version}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div>
          <div className="mb-1 flex justify-between">
            <p className="font-medium">Download paralleli</p>
            <span className="font-semibold text-primary">{settings.downloadConcurrency}</span>
          </div>
          <Slider value={settings.downloadConcurrency} min={4} max={64} step={4} onChange={(v) => updateSettings({ downloadConcurrency: v })} />
        </div>
      </Section>

      <Section icon="key" title="Account Microsoft">
        <p className="text-sm text-on-surface-variant">
          Il login usa l'OAuth2 Device Code Flow con un'app Azure. Registra un'app "Personal Microsoft accounts only", abilita "Allow public client flows" e
          richiedi l'accesso alle API Minecraft a Mojang.
        </p>
        <div className="flex gap-3">
          <TextField className="flex-1" label="Client ID Azure" icon="fingerprint" value={clientId} onChange={(e) => setClientId(e.target.value.trim())} />
          <Button className="self-center" disabled={clientId === settings.msClientId} onClick={() => updateSettings({ msClientId: clientId })}>
            Salva
          </Button>
        </div>
        <Button variant="text" icon="open_in_new" className="self-start" onClick={() => openUrl("https://aka.ms/mce-reviewappid")}>
          Modulo di approvazione Mojang
        </Button>
      </Section>

      <Section icon="auto_awesome" title="Modding Copilot (AI)">
        <Segmented
          value={ui.ai.provider}
          onChange={(provider) => updateUi({ ai: { ...ui.ai, provider } })}
          options={[
            { value: "local", label: "Automatica (locale)", icon: "auto_awesome" },
            { value: "custom", label: "La tua API", icon: "key" },
            { value: "ollama", label: "Ollama tuo", icon: "computer" },
          ]}
        />

        {ui.ai.provider === "local" ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3 rounded-2xl bg-secondary-container/50 p-3 text-sm text-on-surface-variant">
              <Icon name="bolt" size={20} className="text-primary" />
              <p>
                Nessuna configurazione: al primo messaggio Nexus scarica un piccolo motore AI e il modello scelto,
                poi funziona <b className="text-on-surface">100% offline</b> sul tuo PC. Il primo avvio richiede qualche minuto di download.
              </p>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold tracking-wide text-on-surface-variant uppercase">Modello locale</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {LOCAL_MODEL_PRESETS.map((m) => {
                  const active = ui.ai.localModel === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => updateUi({ ai: { ...ui.ai, localModel: m.id } })}
                      className={cn(
                        "flex items-center justify-between rounded-2xl border p-3 text-left transition-colors cursor-pointer",
                        active
                          ? "border-primary bg-primary-container text-on-primary-container"
                          : "border-outline-variant bg-surface-container-high hover:border-primary/50 text-on-surface",
                      )}
                    >
                      <div>
                        <p className="text-sm font-medium">{m.label}</p>
                        <p className="text-[11px] opacity-75">{m.size}</p>
                      </div>
                      {active && <Icon name="check_circle" filled size={20} />}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-on-surface-variant">
                Consigliato Qwen 2.5 0.5B per PC modesti. I modelli più grandi rispondono meglio ma occupano più RAM e disco.
              </p>
            </div>
          </div>
        ) : ui.ai.provider === "custom" ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-on-surface-variant">
              Inserisci la tua chiave API per qualsiasi fornitore compatibile con OpenAI (Groq, OpenAI, OpenRouter, NVIDIA, ecc.).
              La tua chiave è salvata esclusivamente sul tuo dispositivo.
            </p>

            <div>
              <p className="mb-2 text-xs font-semibold tracking-wide text-on-surface-variant uppercase">Preset veloci</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {API_PRESETS.map((p) => {
                  const active = ui.ai.customEndpoint === p.endpoint && ui.ai.customModel === p.model;
                  return (
                    <button
                      key={p.name}
                      type="button"
                      onClick={() =>
                        updateUi({
                          ai: {
                            ...ui.ai,
                            customEndpoint: p.endpoint,
                            customModel: p.model,
                          },
                        })
                      }
                      className={cn(
                        "flex flex-col text-left rounded-2xl border p-3 transition-colors cursor-pointer",
                        active
                          ? "border-primary bg-primary-container text-on-primary-container"
                          : "border-outline-variant bg-surface-container-high hover:border-primary/50 text-on-surface"
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-sm">{p.name}</span>
                        <span className={cn("text-[11px] rounded-full px-2 py-0.5 font-medium", active ? "bg-primary text-on-primary" : "bg-surface-container text-on-surface-variant")}>
                          {p.tag}
                        </span>
                      </div>
                      <p className="mt-1 text-xs opacity-80">{p.desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <TextField
              label="Endpoint URL"
              icon="lan"
              placeholder="es. https://api.groq.com/openai/v1"
              value={ui.ai.customEndpoint}
              onChange={(e) => updateUi({ ai: { ...ui.ai, customEndpoint: e.target.value.trim() } })}
            />

            <TextField
              label="Modello"
              icon="neurology"
              placeholder="es. llama-3.3-70b-versatile o gpt-4o-mini"
              value={ui.ai.customModel}
              onChange={(e) => updateUi({ ai: { ...ui.ai, customModel: e.target.value.trim() } })}
            />

            <TextField
              label="API Key"
              icon="key"
              type="password"
              placeholder="Incolla la tua chiave API segreta"
              value={ui.ai.customApiKey}
              onChange={(e) => updateUi({ ai: { ...ui.ai, customApiKey: e.target.value.trim() } })}
              supporting="Conservata in sicurezza sul tuo PC: non condivisa con nessun server esterno a parte l'endpoint scelto."
            />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-on-surface-variant">
              Esegui modelli leggeri e ultraveloci al 100% in locale sul tuo computer con Ollama. Nessun costo, nessuna API key, e funziona anche offline.
            </p>

            <div className="flex gap-3">
              <TextField
                className="flex-1"
                label="URL Ollama"
                icon="lan"
                value={ui.ai.ollamaUrl}
                onChange={(e) => updateUi({ ai: { ...ui.ai, ollamaUrl: e.target.value.trim() } })}
              />
              <Button
                variant="tonal"
                icon="sync"
                className="self-center"
                onClick={async () => {
                  try {
                    const models = await api.ollamaModels(ui.ai.ollamaUrl);
                    setOllamaModels(models);
                    snack(
                      models.length
                        ? `Connesso a Ollama! Trovati ${models.length} modelli.`
                        : "Ollama è attivo, ma non hai ancora modelli scaricati. Scarica uno dei modelli consigliati sotto con 1 clic!",
                      "success"
                    );
                  } catch (e) {
                    snack(errorMessage(e), "error");
                  }
                }}
              >
                Verifica
              </Button>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold tracking-wide text-on-surface-variant uppercase">Modelli leggeri consigliati (Download a 1 clic)</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {OLLAMA_LIGHT_MODELS.map((m) => {
                  const isInstalled = ollamaModels.some((name) => name.startsWith(m.id));
                  const isSelected = ui.ai.ollamaModel === m.id;
                  const isDownloading = pullingModel === m.id;

                  return (
                    <div
                      key={m.id}
                      className={cn(
                        "flex flex-col justify-between rounded-2xl border p-3.5 transition-all",
                        isSelected
                          ? "border-primary bg-primary-container/40"
                          : "border-outline-variant bg-surface-container-high"
                      )}
                    >
                      <div>
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-sm">{m.name}</span>
                          <span className="rounded-full bg-secondary-container px-2 py-0.5 text-[11px] font-medium text-on-secondary-container">
                            {m.size}
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] font-medium text-primary">{m.badge}</p>
                        <p className="mt-1 text-xs text-on-surface-variant">{m.desc}</p>
                      </div>

                      <div className="mt-3 pt-2 border-t border-outline-variant/30 flex items-center justify-between">
                        {isDownloading ? (
                          <div className="w-full flex flex-col gap-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="flex items-center gap-1.5 font-medium text-primary">
                                <span className="size-2 animate-ping rounded-full bg-primary" />
                                {pullProgress?.stage || "Download..."}
                              </span>
                              {pullProgress?.total && pullProgress.done > 0 && (
                                <span className="font-mono text-[11px] opacity-75">
                                  {Math.round((pullProgress.done / pullProgress.total) * 100)}%
                                </span>
                              )}
                            </div>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container-highest">
                              <div
                                className="h-full bg-primary transition-all duration-300"
                                style={{
                                  width: pullProgress?.total
                                    ? `${Math.min(100, Math.round((pullProgress.done / pullProgress.total) * 100))}%`
                                    : "50%",
                                }}
                              />
                            </div>
                          </div>
                        ) : isInstalled ? (
                          <Button
                            size="sm"
                            variant={isSelected ? "filled" : "tonal"}
                            icon={isSelected ? "check" : "radio_button_unchecked"}
                            className="w-full justify-center"
                            onClick={() => updateUi({ ai: { ...ui.ai, ollamaModel: m.id } })}
                          >
                            {isSelected ? "Attivo" : "Seleziona"}
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outlined"
                            icon="download"
                            className="w-full justify-center"
                            disabled={!!pullingModel}
                            onClick={async () => {
                              setPullingModel(m.id);
                              try {
                                snack(`Download di ${m.id} avviato...`, "info");
                                await api.ollamaPull(ui.ai.ollamaUrl || "http://localhost:11434", m.id);
                                snack(`Modello ${m.name} installato!`, "success");
                                updateUi({ ai: { ...ui.ai, ollamaModel: m.id } });
                                const models = await api.ollamaModels(ui.ai.ollamaUrl || "http://localhost:11434");
                                setOllamaModels(models);
                              } catch (e) {
                                snack(errorMessage(e), "error");
                              } finally {
                                setPullingModel(null);
                                setPullProgress(null);
                              }
                            }}
                          >
                            Installa ({m.size})
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-3 items-end">
              <TextField
                className="flex-1"
                label="Modello Ollama selezionato"
                icon="neurology"
                list="ollama-models-list"
                value={ui.ai.ollamaModel}
                onChange={(e) => updateUi({ ai: { ...ui.ai, ollamaModel: e.target.value.trim() } })}
                supporting="Scegli uno dei modelli scaricati oppure scrivi qualsiasi modello Ollama (es. mistral, deepseek-r1:1.5b)."
              />
              <datalist id="ollama-models-list">
                {ollamaModels.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </div>
          </div>
        )}
      </Section>

      <Section icon="group" title="Amici & presenza">
        <p className="text-sm text-on-surface-variant">
          Il tab Amici (ricerca per nome, richieste da accettare, presenza reale) usa un piccolo server gratuito che ospiti tu.
          Segui <code>server/README.md</code> per pubblicarlo su Cloudflare (gratis, senza carta), poi incolla qui l'URL.
        </p>
        <TextField
          label="URL del server amici (Nexus Social)"
          icon="dns"
          placeholder="https://nexus-social.matthias-peterlini.workers.dev"
          value={settings.socialUrl ?? ""}
          onChange={(e) => updateSettings({ socialUrl: e.target.value.trim() || null })}
        />
        <p className="text-xs text-on-surface-variant">
          Lascia vuoto per disattivare la parte social (l'hosting con tunnel funziona comunque).
        </p>
      </Section>

      <Section icon="info" title="Informazioni">
        <Row title="Nexus Launcher 0.1.0" text="Open-source · Tauri v2 + React · Material 3 Expressive">
          <Badge tone="primary">GPL-3.0</Badge>
        </Row>
        {system && (
          <Row title="Cartella dati" text={system.dataDir}>
            <span className="text-sm text-on-surface-variant">
              {system.os} {system.arch} · {system.cpuCount} thread · {gb(system.totalMemoryMb)}
            </span>
          </Row>
        )}
        <p className="text-xs text-on-surface-variant">
          Non affiliato a Mojang Studios o Microsoft. Minecraft è un marchio di Mojang Synergies AB.
        </p>
      </Section>
    </div>
  );
}
