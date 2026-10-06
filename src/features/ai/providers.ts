// Provider AI per Nexus Copilot:
// 1. Locale automatico (motore Ollama portable auto-gestito da Nexus, si installa al primo uso)
// 2. API Personalizzata (BYOK - OpenAI, Groq, OpenRouter, NVIDIA NIM, ecc.)
// 3. Ollama Locale (istanza Ollama installata dall'utente)
import { listen } from "@tauri-apps/api/event";
import { api, isTauri } from "../../lib/api";
import type { AiPrefs, ChatMessage } from "../../lib/types";

export const LOCAL_MODEL_PRESETS = [
  { id: "llama3.2:1b", label: "Llama 3.2 1B — leggero", size: "~1.3 GB" },
  { id: "llama3.2:3b", label: "Llama 3.2 3B — consigliato", size: "~2.0 GB" },
  { id: "qwen2.5:0.5b", label: "Qwen 2.5 0.5B — ultraleggero", size: "~0.4 GB" },
  { id: "gemma2:2b", label: "Gemma 2 2B — alternativa", size: "~1.6 GB" },
];

/** Streaming di una chat verso un server Ollama (locale o gestito) a un dato base URL. */
async function streamOllama(baseUrl: string, model: string, messages: ChatMessage[], onDelta: (d: string) => void): Promise<string> {
  const requestId = crypto.randomUUID();
  // Lo streaming arriva come evento Tauri; nel browser (dati di prova) arriva solo la risposta finale.
  const unlisten = isTauri()
    ? await listen<{ requestId: string; delta: string }>("ai-stream", (e) => {
        if (e.payload.requestId === requestId) onDelta(e.payload.delta);
      })
    : () => {};
  try {
    return await api.ollamaChat(requestId, baseUrl, model, messages);
  } finally {
    unlisten();
  }
}

// Motore locale auto-gestito: al primo uso scarica il motore e il modello, poi chatta.
async function chatLocal(messages: ChatMessage[], prefs: AiPrefs, onDelta: (d: string) => void): Promise<string> {
  const model = prefs.localModel || "llama3.2:1b";
  const baseUrl = await api.localAiPrepare(model);
  return streamOllama(baseUrl, model, messages, onDelta);
}

async function chatOllama(messages: ChatMessage[], prefs: AiPrefs, onDelta: (d: string) => void): Promise<string> {
  return streamOllama(prefs.ollamaUrl || "http://localhost:11434", prefs.ollamaModel || "llama3.2:1b", messages, onDelta);
}

async function chatCustom(messages: ChatMessage[], prefs: AiPrefs, onDelta: (d: string) => void): Promise<string> {
  const requestId = crypto.randomUUID();
  // Lo streaming arriva come evento Tauri; nel browser (dati di prova) arriva solo la risposta finale.
  const unlisten = isTauri()
    ? await listen<{ requestId: string; delta: string }>("ai-stream", (e) => {
        if (e.payload.requestId === requestId) onDelta(e.payload.delta);
      })
    : () => {};
  try {
    return await api.customApiChat(
      requestId,
      prefs.customEndpoint || "https://api.groq.com/openai/v1",
      prefs.customApiKey || "",
      prefs.customModel || "llama-3.3-70b-versatile",
      messages,
    );
  } finally {
    unlisten();
  }
}

export async function chat(prefs: AiPrefs, messages: ChatMessage[], onDelta: (d: string) => void): Promise<string> {
  if (prefs.provider === "custom") {
    return chatCustom(messages, prefs, onDelta);
  }
  if (prefs.provider === "ollama") {
    return chatOllama(messages, prefs, onDelta);
  }
  return chatLocal(messages, prefs, onDelta);
}

export function providerLabel(prefs: AiPrefs): string {
  if (prefs.provider === "custom") {
    const ep = (prefs.customEndpoint || "").toLowerCase();
    const service = ep.includes("groq")
      ? "Groq"
      : ep.includes("openrouter")
        ? "OpenRouter"
        : ep.includes("openai")
          ? "OpenAI"
          : ep.includes("nvidia")
            ? "NVIDIA"
            : "Custom API";
    return `${service} · ${prefs.customModel || "modello custom"}`;
  }
  if (prefs.provider === "ollama") {
    return `Ollama · ${prefs.ollamaModel || "llama3.2:1b"}`;
  }
  return `AI locale · ${prefs.localModel || "llama3.2:1b"}`;
}
