import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { formatBytes, formatDuration, formatRelative, gb, LOADER_LABEL } from "../../lib/format";
import { useApp } from "../../lib/store";
import type { ContentDir, Instance, LocalContent, ProjectType } from "../../lib/types";
import { InstanceIcon } from "../../components/shell";
import {
  Badge,
  Button,
  cn,
  Dialog,
  EmptyState,
  Fab,
  Icon,
  IconButton,
  Segmented,
  Select,
  Slider,
  Spinner,
  Switch,
  TextField,
  WavyProgress,
} from "../../components/ui";
import { LOADER_OPTIONS, useGameVersions, useLoaderVersions } from "./NewInstanceDialog";

type Tab = "mods" | "resourcepacks" | "shaderpacks" | "settings";

const TABS: { id: Tab; label: string; icon: string; type?: ProjectType }[] = [
  { id: "mods", label: "Mod", icon: "extension", type: "mod" },
  { id: "resourcepacks", label: "Resource pack", icon: "palette", type: "resourcepack" },
  { id: "shaderpacks", label: "Shader", icon: "wb_sunny", type: "shader" },
  { id: "settings", label: "Impostazioni", icon: "tune" },
];

function Material3ThemeBanner({ instance }: { instance: Instance }) {
  const { snack } = useApp();
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.isMaterial3ThemeEnabled(instance.id).then(setEnabled).catch(() => {});
  }, [instance.id]);

  async function handleToggle(next: boolean) {
    setLoading(true);
    try {
      await api.applyMaterial3Theme(instance.id, next);
      setEnabled(next);
      snack(
        next
          ? "Tema Material 3 applicato al menu di Minecraft!"
          : "Tema Material 3 disattivato."
      );
    } catch (e) {
      snack(errorMessage(e), "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mb-2 overflow-hidden rounded-3xl bg-surface-container p-5 border border-primary/20">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-on-primary">
            <Icon name="palette" size={24} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold">UI Material 3 Expressive nel Menu di Minecraft</span>
              {enabled ? (
                <Badge tone="primary">ATTIVO NEL GIOCO</Badge>
              ) : (
                <Badge tone="secondary">DISATTIVATO</Badge>
              )}
            </div>
            <p className="mt-1 text-xs text-on-surface-variant max-w-lg">
              Trasforma il menu principale, i pulsanti pillola e i dialoghi di Minecraft nello stile Material 3 Expressive di Nexus Launcher.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {loading ? (
            <Spinner size={24} />
          ) : (
            <Switch checked={enabled} onChange={handleToggle} />
          )}
        </div>
      </div>
    </div>
  );
}

function ContentTab({ instance, dir, type }: { instance: Instance; dir: ContentDir; type: ProjectType }) {
  const { openBrowse, snack, askAi, progress } = useApp();
  const [items, setItems] = useState<LocalContent[] | null>(null);
  const [filter, setFilter] = useState("");

  const load = useCallback(() => {
    api
      .listContent(instance.id, dir)
      .then(setItems)
      .catch((e) => snack(errorMessage(e), "error"));
  }, [instance.id, dir, snack]);

  // ricarica anche al termine di un download sull'istanza
  const busy = instance.id in progress;
  useEffect(() => {
    if (!busy) load();
  }, [load, busy]);

  const shown = useMemo(
    () => items?.filter((i) => i.title.toLowerCase().includes(filter.toLowerCase()) || i.fileName.includes(filter)) ?? [],
    [items, filter],
  );

  async function toggle(item: LocalContent, enabled: boolean) {
    try {
      const fileName = await api.toggleContent(instance.id, dir, item.fileName, enabled);
      setItems((prev) => prev?.map((x) => (x.fileName === item.fileName ? { ...x, enabled, fileName } : x)) ?? null);
    } catch (e) {
      snack(errorMessage(e), "error");
    }
  }

  async function remove(item: LocalContent) {
    try {
      await api.deleteContent(instance.id, dir, item.fileName);
      setItems((prev) => prev?.filter((x) => x.fileName !== item.fileName) ?? null);
      snack(`${item.title} rimosso`);
    } catch (e) {
      snack(errorMessage(e), "error");
    }
  }

  if (dir === "mods" && instance.loader === "vanilla") {
    return (
      <EmptyState
        icon="extension_off"
        title="Istanza vanilla"
        text="Per usare le mod cambia il loader in Fabric, Quilt, Forge o NeoForge dalle impostazioni dell'istanza."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {dir === "resourcepacks" && <Material3ThemeBanner instance={instance} />}
      <div className="flex items-center gap-3">
        <div className="flex h-12 flex-1 items-center gap-2 rounded-full bg-surface-container-high px-4">
          <Icon name="search" className="text-on-surface-variant" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtra contenuti installati"
            className="flex-1 bg-transparent text-sm outline-none"
          />
        </div>
        <Button icon="add" onClick={() => openBrowse({ instanceId: instance.id, type })}>
          Aggiungi
        </Button>
      </div>

      {items === null ? (
        <div className="flex justify-center py-10 text-primary">
          <Spinner size={40} />
        </div>
      ) : shown.length === 0 ? (
        <EmptyState
          icon={TABS.find((t) => t.id === dir)?.icon ?? "inventory_2"}
          title="Niente qui"
          text="Cerca contenuti su Modrinth: le dipendenze vengono risolte automaticamente."
          action={
            <Button variant="tonal" icon="explore" onClick={() => openBrowse({ instanceId: instance.id, type })}>
              Esplora Modrinth
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-1 overflow-hidden rounded-3xl">
          {shown.map((item) => (
            <div
              key={item.fileName}
              className={cn(
                "flex items-center gap-4 bg-surface-container px-4 py-3 transition-opacity",
                !item.enabled && "opacity-55",
              )}
            >
              <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-surface-container-highest">
                {item.iconUrl ? (
                  <img src={item.iconUrl} alt="" className="size-full object-cover" />
                ) : (
                  <Icon name="deployed_code" className="text-on-surface-variant" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate font-medium">
                  {item.title}
                  {item.dependency && <Badge tone="tertiary">dipendenza</Badge>}
                </p>
                <p className="truncate text-xs text-on-surface-variant">
                  {item.versionNumber ?? item.fileName} · {formatBytes(item.size)}
                </p>
              </div>
              <Switch checked={item.enabled} onChange={(v) => toggle(item, v)} label="Abilita" />
              <IconButton icon="delete" label="Elimina" onClick={() => remove(item)} />
            </div>
          ))}
        </div>
      )}
      {dir === "mods" && items && items.length > 0 && (
        <button
          type="button"
          onClick={() =>
            askAi(
              `Analizza la lista di mod della mia istanza "${instance.name}" (${LOADER_LABEL[instance.loader]} ${instance.mcVersion}) e dimmi se ci sono incompatibilità o mod ridondanti:\n${items.map((i) => `- ${i.title} ${i.versionNumber ?? ""} ${i.enabled ? "" : "(disattivata)"}`).join("\n")}`,
            )
          }
          className="flex cursor-pointer items-center gap-2 self-start rounded-full px-3 py-2 text-sm text-primary hover:bg-primary/8"
        >
          <Icon name="auto_awesome" size={18} /> Controlla compatibilità con l'AI
        </button>
      )}
    </div>
  );
}

function SettingsTab({ instance, onSaved }: { instance: Instance; onSaved: (i: Instance) => void }) {
  const { system, snack } = useApp();
  const versions = useGameVersions();
  const [draft, setDraft] = useState(instance);
  const [saving, setSaving] = useState(false);
  const loaderVersions = useLoaderVersions(draft.loader, draft.mcVersion);
  useEffect(() => setDraft(instance), [instance]);

  const set = <K extends keyof Instance>(key: K, value: Instance[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const maxRam = Math.max(4096, Math.floor(((system?.totalMemoryMb ?? 16384) * 0.85) / 512) * 512);
  const dirty = JSON.stringify(draft) !== JSON.stringify(instance);

  async function save() {
    setSaving(true);
    try {
      const saved = await api.updateInstance(draft);
      onSaved(saved);
      snack("Impostazioni salvate", "success");
    } catch (e) {
      snack(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <section className="flex flex-col gap-4 rounded-3xl bg-surface-container p-6">
        <h3 className="type-title">Generale</h3>
        <TextField label="Nome" value={draft.name} onChange={(e) => set("name", e.target.value)} />
        <Segmented
          value={draft.loader}
          options={LOADER_OPTIONS}
          onChange={(v) => setDraft((d) => ({ ...d, loader: v, loaderVersion: null }))}
        />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Versione Minecraft" value={draft.mcVersion} onChange={(e) => setDraft((d) => ({ ...d, mcVersion: e.target.value, loaderVersion: null }))}>
            {(versions?.versions ?? [{ id: draft.mcVersion, kind: "release", releaseTime: "" }])
              .filter((v) => v.kind === "release" || v.id === draft.mcVersion)
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {v.id}
                </option>
              ))}
          </Select>
          <Select
            label="Versione loader"
            value={draft.loaderVersion ?? ""}
            disabled={draft.loader === "vanilla"}
            onChange={(e) => set("loaderVersion", e.target.value || null)}
          >
            <option value="">{draft.loader === "vanilla" ? "—" : "Consigliata"}</option>
            {draft.loaderVersion && !loaderVersions.list.some((l) => l.id === draft.loaderVersion) && (
              <option value={draft.loaderVersion}>{draft.loaderVersion}</option>
            )}
            {loaderVersions.list.slice(0, 80).map((v) => (
              <option key={v.id} value={v.id}>
                {v.id}
              </option>
            ))}
          </Select>
        </div>
      </section>

      <section className="flex flex-col gap-4 rounded-3xl bg-surface-container p-6">
        <h3 className="type-title">Memoria</h3>
        <div>
          <div className="flex justify-between text-sm">
            <span>Massima</span>
            <span className="font-semibold text-primary">{gb(draft.maxRamMb)}</span>
          </div>
          <Slider
            value={draft.maxRamMb}
            min={1024}
            max={maxRam}
            step={512}
            format={gb}
            onChange={(v) => setDraft((d) => ({ ...d, maxRamMb: v, minRamMb: Math.min(d.minRamMb, v) }))}
          />
        </div>
        <div>
          <div className="flex justify-between text-sm">
            <span>Minima</span>
            <span className="font-semibold text-primary">{gb(draft.minRamMb)}</span>
          </div>
          <Slider value={draft.minRamMb} min={512} max={draft.maxRamMb} step={512} format={gb} onChange={(v) => set("minRamMb", v)} />
        </div>
        {system && (
          <p className="text-xs text-on-surface-variant">RAM di sistema: {gb(system.totalMemoryMb)}. Lascia almeno 3-4 GB al sistema operativo.</p>
        )}
      </section>

      <section className="flex flex-col gap-4 rounded-3xl bg-surface-container p-6">
        <h3 className="type-title">Java & avanzate</h3>
        <TextField
          label="Path Java (vuoto = automatico)"
          icon="coffee"
          value={draft.javaPath ?? ""}
          onChange={(e) => set("javaPath", e.target.value || null)}
          supporting="Lascia vuoto per usare il runtime Java ufficiale richiesto dalla versione."
        />
        <TextField
          label="Argomenti JVM aggiuntivi"
          icon="code"
          value={draft.jvmArgs}
          onChange={(e) => set("jvmArgs", e.target.value)}
          placeholder="-Dfile.encoding=UTF-8"
        />
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Larghezza finestra"
            type="number"
            value={draft.windowWidth ?? ""}
            onChange={(e) => set("windowWidth", e.target.value ? Number(e.target.value) : null)}
          />
          <TextField
            label="Altezza finestra"
            type="number"
            value={draft.windowHeight ?? ""}
            onChange={(e) => set("windowHeight", e.target.value ? Number(e.target.value) : null)}
          />
        </div>
      </section>

      <div className="sticky bottom-4 flex justify-end">
        <Button icon="save" size="lg" disabled={!dirty} loading={saving} onClick={save} className="elev-3">
          Salva modifiche
        </Button>
      </div>
    </div>
  );
}

export function InstancePage() {
  const { selectedInstanceId, instances, navigate, running, progress, launch, snack, notify, refreshInstances } = useApp();
  const [tab, setTab] = useState<Tab>("mods");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [cloneName, setCloneName] = useState<string | null>(null);
  const instance = instances.find((i) => i.id === selectedInstanceId);

  if (!instance) {
    return <EmptyState icon="search_off" title="Istanza non trovata" action={<Button onClick={() => navigate("home")}>Torna alla home</Button>} />;
  }
  const isRunning = instance.id in running;
  const p = progress[instance.id];

  const act = (fn: () => Promise<unknown>, ok?: string) => () =>
    fn()
      .then(() => ok && snack(ok, "success"))
      .catch((e) => snack(errorMessage(e), "error"));

  return (
    <div className="px-10 pt-6 pb-10">
      <button type="button" onClick={() => navigate("home")} className="mb-4 flex cursor-pointer items-center gap-1 text-sm text-on-surface-variant hover:text-on-surface">
        <Icon name="arrow_back" size={20} /> Home
      </button>

      <header className="flex animate-enter items-center gap-6 rounded-[36px] bg-surface-container-high p-6">
        <InstanceIcon instance={instance} size={96} />
        <div className="min-w-0 flex-1">
          <h1 className="type-headline truncate">{instance.name}</h1>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge tone="primary">{instance.mcVersion}</Badge>
            <Badge tone="secondary">
              {LOADER_LABEL[instance.loader]} {instance.loaderVersion ?? ""}
            </Badge>
            <Badge tone="tertiary">{gb(instance.maxRamMb)}</Badge>
          </div>
          <p className="mt-2 text-xs text-on-surface-variant">
            {formatRelative(instance.lastPlayed)} · {formatDuration(instance.playTimeSecs)} di gioco
          </p>
          {p && (
            <div className="mt-3 flex max-w-md items-center gap-3 text-xs text-on-surface-variant">
              <span className="shrink-0">{p.stage}</span>
              <WavyProgress value={p.total ? p.done / p.total : null} />
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <IconButton icon="folder_open" label="Apri cartella" onClick={act(() => api.openInstanceFolder(instance.id))} />
          <IconButton icon="content_copy" label="Clona" onClick={() => setCloneName(`${instance.name} (copia)`)} />
          <IconButton
            icon="build"
            label="Ripara (verifica hash di tutti i file)"
            disabled={!!p}
            onClick={() =>
              api
                .installInstance(instance.id, true)
                .then(() => notify({ title: "Verifica completata", body: `${instance.name} è stata riparata`, icon: "build_circle", tone: "success" }))
                .catch((e) => snack(errorMessage(e), "error"))
            }
          />
          <IconButton icon="delete" label="Elimina" onClick={() => setConfirmDelete(true)} />
        </div>
        {isRunning ? (
          <Fab icon="stop" label="Chiudi" variant="tertiary" onClick={act(() => api.killInstance(instance.id))} />
        ) : (
          <Fab icon="play_arrow" label="Gioca" loading={!!p} onClick={() => launch(instance.id)} />
        )}
      </header>

      <div className="mt-6 mb-5 flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "state-layer flex h-11 cursor-pointer items-center gap-2 px-5 text-sm font-medium transition-[border-radius,background-color] duration-300 ease-spring",
              tab === t.id ? "rounded-2xl bg-primary text-on-primary" : "rounded-full bg-surface-container-high text-on-surface-variant",
            )}
          >
            <Icon name={t.icon} filled={tab === t.id} size={20} />
            {t.label}
          </button>
        ))}
      </div>

      <div key={tab} className="animate-enter">
        {tab === "settings" ? (
          <SettingsTab instance={instance} onSaved={() => refreshInstances()} />
        ) : (
          <ContentTab instance={instance} dir={tab} type={TABS.find((t) => t.id === tab)!.type!} />
        )}
      </div>

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        icon="delete_forever"
        title="Eliminare l'istanza?"
        actions={
          <>
            <Button variant="text" onClick={() => setConfirmDelete(false)}>
              Annulla
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                try {
                  await api.deleteInstance(instance.id);
                  setConfirmDelete(false);
                  navigate("home");
                  await refreshInstances();
                  snack("Istanza eliminata");
                } catch (e) {
                  snack(errorMessage(e), "error");
                }
              }}
            >
              Elimina
            </Button>
          </>
        }
      >
        Verranno eliminati definitivamente mondi, mod e configurazioni di <b>{instance.name}</b>. L'operazione non è reversibile.
      </Dialog>

      <Dialog
        open={cloneName !== null}
        onClose={() => setCloneName(null)}
        icon="content_copy"
        title="Clona istanza"
        actions={
          <>
            <Button variant="text" onClick={() => setCloneName(null)}>
              Annulla
            </Button>
            <Button
              icon="content_copy"
              onClick={async () => {
                try {
                  const copy = await api.cloneInstance(instance.id, cloneName!.trim());
                  setCloneName(null);
                  await refreshInstances();
                  useApp.getState().openInstance(copy.id);
                  snack("Istanza clonata", "success");
                } catch (e) {
                  snack(errorMessage(e), "error");
                }
              }}
            >
              Clona
            </Button>
          </>
        }
      >
        <TextField label="Nome della copia" value={cloneName ?? ""} onChange={(e) => setCloneName(e.target.value)} autoFocus />
      </Dialog>
    </div>
  );
}
