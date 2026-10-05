import { useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { gb } from "../../lib/format";
import { useApp } from "../../lib/store";
import type { GameVersions, Loader, LoaderVersion } from "../../lib/types";
import { Button, cn, Dialog, Icon, Segmented, Select, Slider, Switch, TextField } from "../../components/ui";

export const LOADER_OPTIONS: { value: Loader; label: string }[] = [
  { value: "vanilla", label: "Vanilla" },
  { value: "fabric", label: "Fabric" },
  { value: "quilt", label: "Quilt" },
  { value: "forge", label: "Forge" },
  { value: "neoforge", label: "NeoForge" },
];

const ICONS = ["grass", "swords", "castle", "diamond", "rocket_launch", "forest", "sailing", "agriculture", "science", "pets", "bolt", "local_fire_department"];

let versionsCache: GameVersions | null = null;

export function useGameVersions() {
  const [versions, setVersions] = useState<GameVersions | null>(versionsCache);
  useEffect(() => {
    if (versionsCache) return;
    api
      .minecraftVersions()
      .then((v) => {
        versionsCache = v;
        setVersions(v);
      })
      .catch(() => setVersions(null));
  }, []);
  return versions;
}

export function useLoaderVersions(loader: Loader, mcVersion: string) {
  const [list, setList] = useState<LoaderVersion[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (loader === "vanilla" || !mcVersion) {
      setList([]);
      return;
    }
    let alive = true;
    setLoading(true);
    api
      .loaderVersions(loader, mcVersion)
      .then((l) => alive && setList(l))
      .catch(() => alive && setList([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [loader, mcVersion]);
  return { list, loading };
}

export function NewInstanceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { system, settings, refreshInstances, openInstance, snack } = useApp();
  const versions = useGameVersions();
  const [name, setName] = useState("");
  const [snapshots, setSnapshots] = useState(false);
  const [mcVersion, setMcVersion] = useState("");
  const [loader, setLoader] = useState<Loader>("fabric");
  const [loaderVersion, setLoaderVersion] = useState("");
  const [ram, setRam] = useState(settings?.defaultMaxRamMb ?? 4096);
  const [icon, setIcon] = useState("grass");
  const [busy, setBusy] = useState(false);
  const loaderVersions = useLoaderVersions(loader, mcVersion);

  const list = useMemo(
    () => versions?.versions.filter((v) => v.kind === "release" || (snapshots && v.kind === "snapshot")) ?? [],
    [versions, snapshots],
  );

  useEffect(() => {
    if (versions && !mcVersion) setMcVersion(versions.latestRelease);
  }, [versions, mcVersion]);
  useEffect(() => setLoaderVersion(""), [loader, mcVersion]);

  const maxRam = Math.max(4096, Math.floor(((system?.totalMemoryMb ?? 16384) * 0.75) / 512) * 512);
  const noLoader = loader !== "vanilla" && !loaderVersions.loading && loaderVersions.list.length === 0;

  async function create() {
    setBusy(true);
    try {
      const inst = await api.createInstance({
        name: name.trim() || `${mcVersion} ${loader === "vanilla" ? "" : loader}`.trim(),
        mcVersion,
        loader,
        loaderVersion: loaderVersion || null,
        maxRamMb: ram,
        icon,
      });
      await refreshInstances();
      onClose();
      setName("");
      openInstance(inst.id);
      snack(`Istanza "${inst.name}" creata — download in corso`, "success");
      api.installInstance(inst.id).catch((e) => snack(errorMessage(e), "error"));
    } catch (e) {
      snack(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Nuova istanza"
      icon="add_box"
      width={600}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            Annulla
          </Button>
          <Button icon="add" onClick={create} loading={busy} disabled={!mcVersion || noLoader}>
            Crea istanza
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5 pb-2">
        <div className="flex gap-3">
          <TextField
            className="flex-1"
            label="Nome"
            icon="badge"
            placeholder="La mia survival"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>

        <div>
          <p className="type-label mb-2 text-on-surface">Icona</p>
          <div className="flex flex-wrap gap-2">
            {ICONS.map((i) => (
              <button
                key={i}
                type="button"
                onClick={() => setIcon(i)}
                className={cn(
                  "state-layer flex size-11 cursor-pointer items-center justify-center transition-[border-radius,background-color] duration-300 ease-spring",
                  icon === i ? "rounded-[14px] bg-primary text-on-primary" : "rounded-full bg-surface-container-highest text-on-surface-variant",
                )}
              >
                <Icon name={i} filled={icon === i} />
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="type-label mb-2 text-on-surface">Modloader</p>
          <Segmented value={loader} options={LOADER_OPTIONS} onChange={setLoader} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Select label="Versione Minecraft" value={mcVersion} onChange={(e) => setMcVersion(e.target.value)}>
            {!versions && <option>Caricamento…</option>}
            {list.map((v) => (
              <option key={v.id} value={v.id}>
                {v.id}
                {v.kind === "snapshot" ? " (snapshot)" : ""}
              </option>
            ))}
          </Select>
          <Select
            label={loader === "vanilla" ? "Loader" : `Versione ${LOADER_OPTIONS.find((l) => l.value === loader)?.label}`}
            value={loaderVersion}
            disabled={loader === "vanilla"}
            onChange={(e) => setLoaderVersion(e.target.value)}
          >
            {loader === "vanilla" && <option value="">—</option>}
            {loader !== "vanilla" && (
              <option value="">{loaderVersions.loading ? "Caricamento…" : noLoader ? "Non disponibile" : "Consigliata (ultima stabile)"}</option>
            )}
            {loaderVersions.list.slice(0, 80).map((v) => (
              <option key={v.id} value={v.id}>
                {v.id}
                {v.stable ? "" : " (beta)"}
              </option>
            ))}
          </Select>
        </div>
        <label className="flex items-center gap-3 text-sm">
          <Switch checked={snapshots} onChange={setSnapshots} label="Mostra snapshot" />
          Mostra snapshot
        </label>
        {noLoader && (
          <p className="flex items-center gap-2 rounded-xl bg-error-container px-3 py-2 text-on-error-container">
            <Icon name="warning" size={18} /> Questo loader non supporta Minecraft {mcVersion}.
          </p>
        )}

        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <p className="type-label text-on-surface">Memoria massima</p>
            <span className="text-sm font-semibold text-primary">{gb(ram)}</span>
          </div>
          <Slider value={ram} min={1024} max={maxRam} step={512} onChange={setRam} format={gb} />
          <p className="text-xs">Consigliati 4 GB per vanilla/leggero, 6-8 GB per modpack grandi.</p>
        </div>
      </div>
    </Dialog>
  );
}
