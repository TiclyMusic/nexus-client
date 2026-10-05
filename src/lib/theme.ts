// Palette dinamica Material You: da un colore seed genera tutti i ruoli M3 come variabili CSS.
import {
  argbFromHex,
  hexFromArgb,
  Hct,
  MaterialDynamicColors as C,
  SchemeExpressive,
  SchemeFidelity,
  SchemeTonalSpot,
  SchemeVibrant,
  type DynamicColor,
  type DynamicScheme,
} from "@material/material-color-utilities";
import type { SchemeVariant, UiPrefs } from "./types";

export const SEED_PRESETS = [
  { name: "Creeper", hex: "#4caf50" },
  { name: "Diamante", hex: "#26c6da" },
  { name: "Ametista", hex: "#9c6ade" },
  { name: "Redstone", hex: "#e53935" },
  { name: "Oro", hex: "#f9a825" },
  { name: "Nether", hex: "#ff7043" },
  { name: "End", hex: "#5c6bc0" },
  { name: "Ciliegio", hex: "#ec77a8" },
];

export const DEFAULT_UI: UiPrefs = {
  seedColor: "#4caf50",
  variant: "vibrant",
  mode: "dark",
  ai: {
    provider: "local",
    localModel: "llama3.2:1b",
    customEndpoint: "https://api.groq.com/openai/v1",
    customApiKey: "",
    customModel: "llama-3.3-70b-versatile",
    ollamaUrl: "http://localhost:11434",
    ollamaModel: "llama3.2:1b",
  },
};

const ROLES: Record<string, DynamicColor> = {
  primary: C.primary,
  "on-primary": C.onPrimary,
  "primary-container": C.primaryContainer,
  "on-primary-container": C.onPrimaryContainer,
  secondary: C.secondary,
  "on-secondary": C.onSecondary,
  "secondary-container": C.secondaryContainer,
  "on-secondary-container": C.onSecondaryContainer,
  tertiary: C.tertiary,
  "on-tertiary": C.onTertiary,
  "tertiary-container": C.tertiaryContainer,
  "on-tertiary-container": C.onTertiaryContainer,
  error: C.error,
  "on-error": C.onError,
  "error-container": C.errorContainer,
  "on-error-container": C.onErrorContainer,
  surface: C.surface,
  "surface-dim": C.surfaceDim,
  "surface-bright": C.surfaceBright,
  "surface-container-lowest": C.surfaceContainerLowest,
  "surface-container-low": C.surfaceContainerLow,
  "surface-container": C.surfaceContainer,
  "surface-container-high": C.surfaceContainerHigh,
  "surface-container-highest": C.surfaceContainerHighest,
  "on-surface": C.onSurface,
  "surface-variant": C.surfaceVariant,
  "on-surface-variant": C.onSurfaceVariant,
  outline: C.outline,
  "outline-variant": C.outlineVariant,
  "inverse-surface": C.inverseSurface,
  "inverse-on-surface": C.inverseOnSurface,
  "inverse-primary": C.inversePrimary,
  scrim: C.scrim,
};

function buildScheme(seed: string, variant: SchemeVariant, dark: boolean): DynamicScheme {
  const hct = Hct.fromInt(argbFromHex(seed));
  switch (variant) {
    case "expressive":
      return new SchemeExpressive(hct, dark, 0);
    case "vibrant":
      return new SchemeVibrant(hct, dark, 0);
    case "fidelity":
      return new SchemeFidelity(hct, dark, 0);
    default:
      return new SchemeTonalSpot(hct, dark, 0);
  }
}

export function resolveDark(mode: UiPrefs["mode"]): boolean {
  if (mode === "system") return window.matchMedia("(prefers-color-scheme: dark)").matches;
  return mode === "dark";
}

export function applyTheme(prefs: Pick<UiPrefs, "seedColor" | "variant" | "mode">) {
  const dark = resolveDark(prefs.mode);
  let scheme: DynamicScheme;
  try {
    scheme = buildScheme(prefs.seedColor, prefs.variant, dark);
  } catch {
    scheme = buildScheme(DEFAULT_UI.seedColor, "tonalSpot", dark);
  }
  const root = document.documentElement;
  for (const [role, color] of Object.entries(ROLES)) {
    root.style.setProperty(`--md-${role}`, hexFromArgb(color.getArgb(scheme)));
  }
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
}
