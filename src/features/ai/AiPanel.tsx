import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import { api, errorMessage } from "../../lib/api";
import { useApp } from "../../lib/store";
import type { ChatMessage, CrashAnalysis } from "../../lib/types";
import { Button, Chip, cn, Icon, IconButton, Spinner } from "../../components/ui";
import { buildSystemPrompt, describeAction, executeAction, FEW_SHOT, parseReply, wantsAction, type AiAction, type Step } from "./actions";
import { chat, providerLabel } from "./providers";
import { useGameVersions } from "../instances/NewInstanceDialog";

interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
  error?: string;
  analysis?: CrashAnalysis;
  /** Testo mostrato al posto di `content` per i messaggi utente generati (es. log lunghi). */
  display?: string;
}

const QUICK = [
  { label: "Survival ottimizzata", prompt: "Voglio un'istanza survival ottimizzata per un PC di fascia media con shader leggeri" },
  { label: "Più FPS", prompt: "Quali mod di performance mi consigli per aumentare gli FPS?" },
  { label: "Shader belli", prompt: "Crea un'istanza per screenshot con gli shader più belli e realistici" },
];

function ActionCard({ action }: { action: AiAction }) {
  const instances = useApp((s) => s.instances);
  const [steps, setSteps] = useState<Step[]>([]);
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const { icon, title } = describeAction(action, instances);
  const items =
    action.type === "create_instance"
      ? [...(action.mods ?? []), ...(action.shaders ?? []), ...(action.resourcepacks ?? [])]
      : action.type === "install_content"
        ? action.projects
        : [];

  async function run() {
    setState("running");
    try {
      await executeAction(action, setSteps);
      setState("done");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="mt-3 animate-pop overflow-hidden rounded-3xl bg-tertiary-container text-on-tertiary-container">
      <div className="flex items-start gap-3 p-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-tertiary text-on-tertiary">
          <Icon name={icon} filled size={22} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-tight font-semibold">{title}</p>
          {action.summary && <p className="mt-0.5 text-xs opacity-80">{action.summary}</p>}
          {action.type === "create_instance" && action.maxRamMb && (
            <p className="mt-1 text-xs opacity-80">RAM: {(action.maxRamMb / 1024).toFixed(1)} GB</p>
          )}
          {action.type === "update_instance" && (
            <p className="mt-1 text-xs opacity-80">
              {action.maxRamMb ? `RAM max ${action.maxRamMb} MB ` : ""}
              {action.jvmArgs ? `JVM: ${action.jvmArgs}` : ""}
            </p>
          )}
        </div>
      </div>
      {items.length > 0 && (
        <div className="flex flex-wrap gap-1 px-4 pb-3">
          {items.map((s) => (
            <span key={s} className="rounded-full bg-on-tertiary-container/10 px-2.5 py-0.5 font-mono text-[11px]">
              {s}
            </span>
          ))}
        </div>
      )}
      {steps.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-on-tertiary-container/10 px-4 py-3 text-xs">
          {steps.map((s, i) => (
            <div key={i} className="flex items-start gap-2">
              {s.status === "running" ? (
                <Spinner size={16} className="mt-px" />
              ) : (
                <Icon
                  name={s.status === "done" ? "check_circle" : s.status === "error" ? "error" : "radio_button_unchecked"}
                  filled
                  size={16}
                  className={s.status === "error" ? "text-error" : undefined}
                />
              )}
              <div className="min-w-0">
                <p>{s.label}</p>
                {s.detail && <p className="text-[11px] break-words opacity-75">{s.detail}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="flex justify-end px-3 pb-3">
        {state === "idle" && (
          <Button size="sm" variant="filled" icon="bolt" onClick={run} className="bg-tertiary text-on-tertiary">
            Esegui
          </Button>
        )}
        {state === "running" && <span className="px-2 py-1 text-xs font-semibold">In esecuzione…</span>}
        {state === "done" && (
          <span className="flex items-center gap-1 px-2 py-1 text-xs font-semibold">
            <Icon name="task_alt" size={16} /> Completato
          </span>
        )}
        {state === "error" && (
          <Button size="sm" variant="text" icon="replay" onClick={run} className="text-on-tertiary-container">
            Riprova
          </Button>
        )}
      </div>
    </div>
  );
}

function AnalysisCard({ analysis }: { analysis: CrashAnalysis }) {
  if (!analysis.findings.length) {
    return <p className="mt-2 text-xs text-on-surface-variant">L'analizzatore locale non ha riconosciuto pattern noti: chiedo all'AI.</p>;
  }
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {analysis.findings.map((f, i) => (
        <div
          key={i}
          className={cn(
            "rounded-2xl px-3 py-2 text-xs",
            f.severity === "error" ? "bg-error-container text-on-error-container" : "bg-secondary-container text-on-secondary-container",
          )}
        >
          <p className="flex items-center gap-1.5 font-semibold">
            <Icon name={f.severity === "error" ? "error" : "warning"} size={16} filled /> {f.title}
          </p>
          <p className="mt-0.5">{f.detail}</p>
          <p className="mt-0.5 opacity-80">→ {f.suggestion}</p>
        </div>
      ))}
    </div>
  );
}

function Bubble({ msg, prevUser }: { msg: UiMessage; prevUser?: string }) {
  const instances = useApp((s) => s.instances);
  if (msg.role === "user") {
    return (
      <div className="flex animate-enter justify-end">
        <div className="max-w-[85%] rounded-3xl rounded-br-lg bg-primary-container px-4 py-2.5 text-sm whitespace-pre-wrap text-on-primary-container">
          {msg.display ?? msg.content}
          {msg.analysis && <AnalysisCard analysis={msg.analysis} />}
        </div>
      </div>
    );
  }
  const { prose, actions, invalid } = parseReply(msg.content, {
    allowActions: wantsAction(prevUser),
    instanceIds: instances.map((i) => i.id),
  });
  return (
    <div className="flex animate-enter gap-2.5">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-secondary-container text-on-secondary-container">
        <Icon name="auto_awesome" filled size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="selectable prose-chat rounded-3xl rounded-tl-lg bg-surface-container-high px-4 py-2.5 text-sm">
          {prose ? (
            <Markdown>{prose}</Markdown>
          ) : msg.pending ? (
            <Spinner size={18} className="text-primary" />
          ) : !msg.error && actions.length === 0 ? (
            <p className="text-on-surface-variant">Non sono riuscito a preparare una risposta. Riprova o riformula la richiesta.</p>
          ) : null}
          {msg.error && (
            <p className="mt-1 flex items-start gap-1.5 text-error">
              <Icon name="error" size={18} /> {msg.error}
            </p>
          )}
        </div>
        {!msg.pending && actions.map((a, i) => <ActionCard key={i} action={a} />)}
        {!msg.pending && invalid > 0 && (
          <p className="mt-1 px-2 text-[11px] text-on-surface-variant">{invalid} azione/i non valide ignorate.</p>
        )}
      </div>
    </div>
  );
}

export function AiPanel() {
  const { ui, instances, system, toggleAi, aiDraft, consumeAiDraft, navigate } = useApp();
  const versions = useGameVersions();
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [crashTarget, setCrashTarget] = useState<string>("");
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // Prompt inviati da altre parti della UI (home, console, snackbar)
  useEffect(() => {
    if (!aiDraft || busy) return;
    const draft = consumeAiDraft();
    if (!draft) return;
    if (draft.startsWith("/crash ")) analyzeCrash(draft.slice(7).trim());
    else send(draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiDraft, busy]);

  async function ask(history: UiMessage[]) {
    const system_ = buildSystemPrompt({
      instances,
      system,
      releases: versions?.versions.filter((v) => v.kind === "release").map((v) => v.id) ?? [],
    });
    const payload: ChatMessage[] = [
      { role: "system", content: system_ },
      ...FEW_SHOT,
      ...history.slice(-14).map((m) => ({ role: m.role, content: m.content }) as ChatMessage),
    ];
    const id = crypto.randomUUID();
    setMessages([...history, { id, role: "assistant", content: "", pending: true }]);
    setBusy(true);
    try {
      let acc = "";
      const full = await chat(ui.ai, payload, (delta) => {
        acc += delta;
        const snapshot = acc;
        setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, content: snapshot } : m)));
      });
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, content: full || acc, pending: false } : m)));
    } catch (e) {
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, pending: false, error: errorMessage(e) } : m)));
    } finally {
      setBusy(false);
    }
  }

  function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    setInput("");
    const next: UiMessage[] = [...messages, { id: crypto.randomUUID(), role: "user", content }];
    ask(next);
  }

  async function analyzeCrash(instanceId: string) {
    const inst = instances.find((i) => i.id === instanceId);
    if (!inst) return;
    setBusy(true);
    try {
      const [analysis, mods] = await Promise.all([
        api.analyzeCrash(instanceId),
        api.listContent(instanceId, "mods").catch(() => []),
      ]);
      const content = `Risolvi questo crash dell'istanza "${inst.name}" (id \`${inst.id}\`, ${inst.loader} ${inst.loaderVersion ?? ""}, MC ${inst.mcVersion}, RAM ${inst.maxRamMb} MB).

Findings dell'analizzatore locale:
${analysis.findings.map((f) => `- [${f.severity}] ${f.title}: ${f.detail}`).join("\n") || "- nessuno"}

Mod installate:
${mods.map((m) => `- ${m.fileName}${m.enabled ? "" : " (disattivata)"}`).join("\n") || "- nessuna"}

Estratto del log:
\`\`\`
${analysis.excerpt}
\`\`\``;
      const next: UiMessage[] = [
        ...messages,
        {
          id: crypto.randomUUID(),
          role: "user",
          content,
          display: `🔍 Analizza il crash di "${inst.name}"${analysis.crashReportFile ? ` (${analysis.crashReportFile})` : ""}`,
          analysis,
        },
      ];
      setBusy(false);
      await ask(next);
    } catch (e) {
      setBusy(false);
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "assistant", content: "", error: errorMessage(e) }]);
    }
  }

  return (
    <aside className="flex w-[420px] shrink-0 animate-enter flex-col overflow-hidden rounded-l-[28px] bg-surface-container-low">
      <header className="flex items-center gap-3 px-5 pt-4 pb-3">
        <div className="flex size-10 items-center justify-center rounded-[14px] bg-gradient-to-br from-primary to-tertiary text-on-primary">
          <Icon name="auto_awesome" filled />
        </div>
        <div className="min-w-0 flex-1">
          <p className="leading-tight font-semibold">Modding Copilot</p>
          <button type="button" onClick={() => navigate("settings")} className="cursor-pointer text-xs text-on-surface-variant hover:text-primary">
            {providerLabel(ui.ai)}
          </button>
        </div>
        <IconButton icon="edit_square" label="Nuova chat" onClick={() => setMessages([])} disabled={busy} />
        <IconButton icon="close" label="Chiudi" onClick={() => toggleAi(false)} />
      </header>

      <div ref={scroller} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-2">
        {messages.length === 0 && (
          <div className="flex flex-col items-center px-4 pt-10 text-center">
            <div
              className="mb-4 flex size-20 items-center justify-center bg-primary-container text-on-primary-container"
              style={{ borderRadius: "42% 58% 60% 40% / 45% 45% 55% 55%" }}
            >
              <Icon name="auto_awesome" filled size={40} />
            </div>
            <p className="type-title">Come posso aiutarti?</p>
            <p className="mt-1 text-sm text-on-surface-variant">
              Creo istanze su misura, installo mod con le dipendenze giuste e analizzo i crash. Nessuna API key richiesta.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {QUICK.map((q) => (
                <Chip key={q.label} label={q.label} icon="bolt" onClick={() => send(q.prompt)} />
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <Bubble key={m.id} msg={m} prevUser={m.role === "assistant" ? messages[i - 1]?.content : undefined} />
        ))}
      </div>

      <div className="flex flex-col gap-2 p-3">
        {instances.length > 0 && (
          <div className="flex items-center gap-2 rounded-2xl bg-surface-container px-3 py-2">
            <Icon name="bug_report" size={20} className="text-error" />
            <select
              value={crashTarget}
              onChange={(e) => setCrashTarget(e.target.value)}
              className="min-w-0 flex-1 cursor-pointer bg-transparent text-xs outline-none [&>option]:bg-surface-container-high"
            >
              <option value="">Analizza crash di…</option>
              {instances.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
            <Button size="sm" variant="tonal" disabled={!crashTarget || busy} onClick={() => analyzeCrash(crashTarget)}>
              Analizza
            </Button>
          </div>
        )}
        <div className="flex items-end gap-2 rounded-[28px] bg-surface-container-highest p-1.5 pl-5 focus-within:elev-1">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={1}
            placeholder="Chiedi al Copilot…"
            className="max-h-32 min-h-10 flex-1 resize-none bg-transparent py-2.5 text-sm outline-none [field-sizing:content]"
          />
          <button
            type="button"
            onClick={() => send(input)}
            disabled={busy || !input.trim()}
            className="state-layer flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-primary text-on-primary transition-[border-radius] duration-300 ease-spring active:rounded-xl disabled:opacity-40"
          >
            {busy ? <Spinner size={20} /> : <Icon name="arrow_upward" />}
          </button>
        </div>
      </div>
    </aside>
  );
}
