import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { formatCount, LOADER_LABEL } from "../../lib/format";
import { useApp } from "../../lib/store";
import type { ProjectType, SearchHit } from "../../lib/types";
import { Badge, Button, Chip, cn, EmptyState, Icon, Select, Spinner } from "../../components/ui";

const TYPES: { value: ProjectType; label: string; icon: string }[] = [
  { value: "mod", label: "Mod", icon: "extension" },
  { value: "modpack", label: "Modpack", icon: "inventory_2" },
  { value: "shader", label: "Shader", icon: "wb_sunny" },
  { value: "resourcepack", label: "Resource pack", icon: "palette" },
];

const SORTS = [
  { value: "relevance", label: "Rilevanza" },
  { value: "downloads", label: "Download" },
  { value: "follows", label: "Popolarità" },
  { value: "updated", label: "Aggiornati" },
  { value: "newest", label: "Nuovi" },
];

function ResultCard({ hit, onInstall, installing, index }: { hit: SearchHit; onInstall: () => void; installing: boolean; index: number }) {
  return (
    <div
      className="group flex animate-enter gap-4 rounded-3xl bg-surface-container p-4 transition-[border-radius,background-color] duration-300 ease-spring hover:rounded-[36px] hover:bg-surface-container-high"
      style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}
    >
      <div className="size-20 shrink-0 overflow-hidden rounded-2xl bg-surface-container-highest transition-[border-radius] duration-500 ease-spring group-hover:rounded-[40%]">
        {hit.icon_url ? (
          <img src={hit.icon_url} alt="" className="size-full object-cover" loading="lazy" />
        ) : (
          <Icon name="deployed_code" size={36} className="flex size-full items-center justify-center text-on-surface-variant" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <h3 className="truncate text-[17px] font-semibold">{hit.title}</h3>
          <span className="truncate text-xs text-on-surface-variant">di {hit.author}</span>
        </div>
        <p className="mt-0.5 line-clamp-2 text-sm text-on-surface-variant">{hit.description}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="mr-2 flex items-center gap-1 text-xs text-on-surface-variant">
            <Icon name="download" size={16} /> {formatCount(hit.downloads)}
          </span>
          <span className="mr-2 flex items-center gap-1 text-xs text-on-surface-variant">
            <Icon name="favorite" size={16} /> {formatCount(hit.follows)}
          </span>
          {hit.display_categories.slice(0, 4).map((c) => (
            <Badge key={c}>{c}</Badge>
          ))}
        </div>
      </div>
      <div className="flex flex-col items-end justify-between gap-2">
        <Button icon={hit.project_type === "modpack" ? "add_box" : "download"} size="sm" onClick={onInstall} loading={installing}>
          {hit.project_type === "modpack" ? "Crea istanza" : "Installa"}
        </Button>
        <button
          type="button"
          onClick={() => openUrl(`https://modrinth.com/${hit.project_type}/${hit.slug}`)}
          className="flex cursor-pointer items-center gap-1 text-xs text-on-surface-variant hover:text-primary"
        >
          Modrinth <Icon name="open_in_new" size={14} />
        </button>
      </div>
    </div>
  );
}

export function BrowsePage() {
  const { instances, browseTarget, snack, notify, openInstance, refreshInstances } = useApp();
  const [type, setType] = useState<ProjectType>(browseTarget.type ?? "mod");
  const [targetId, setTargetId] = useState<string>(browseTarget.instanceId ?? instances[0]?.id ?? "");
  const [compatibleOnly, setCompatibleOnly] = useState(true);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("relevance");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState<Set<string>>(new Set());
  const reqId = useRef(0);

  useEffect(() => {
    if (browseTarget.type) setType(browseTarget.type);
    if (browseTarget.instanceId) setTargetId(browseTarget.instanceId);
  }, [browseTarget]);

  const target = instances.find((i) => i.id === targetId);
  const filterByTarget = compatibleOnly && target && type !== "modpack";

  async function search(offset = 0) {
    const id = ++reqId.current;
    setLoading(true);
    try {
      const res = await api.search({
        query,
        projectType: type,
        gameVersion: filterByTarget ? target!.mcVersion : null,
        loader: filterByTarget && type === "mod" ? target!.loader : null,
        offset,
        sort,
      });
      if (id !== reqId.current) return;
      setHits((prev) => (offset === 0 ? res.hits : [...prev, ...res.hits]));
      setTotal(res.total_hits);
    } catch (e) {
      if (id === reqId.current) snack(errorMessage(e), "error");
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }

  // ricerca con debounce
  useEffect(() => {
    const t = setTimeout(() => search(0), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, type, targetId, compatibleOnly, sort]);

  async function install(hit: SearchHit) {
    setInstalling((s) => new Set(s).add(hit.project_id));
    try {
      if (hit.project_type === "modpack") {
        const inst = await api.installModpack(hit.project_id);
        await refreshInstances();
        notify({
          title: "Installazione completata",
          body: `Il modpack ${inst.name} è pronto`,
          icon: "download_done",
          tone: "success",
          action: { label: "Apri", run: () => openInstance(inst.id) },
        });
      } else {
        if (!target) {
          snack("Seleziona prima un'istanza di destinazione", "error");
          return;
        }
        const added = await api.installProject(target.id, hit.project_id);
        const deps = added.filter((a) => a.dependency).map((a) => a.title);
        notify({
          title: `${hit.title} installato`,
          body: `In ${target.name}${deps.length ? ` · dipendenze: ${deps.join(", ")}` : ""}`,
          icon: "download_done",
          tone: "success",
        });
      }
    } catch (e) {
      snack(errorMessage(e), "error");
    } finally {
      setInstalling((s) => {
        const n = new Set(s);
        n.delete(hit.project_id);
        return n;
      });
    }
  }

  return (
    <div className="px-10 pt-8 pb-10">
      <h1 className="type-headline mb-5 animate-enter">Esplora</h1>

      <div className="flex h-14 animate-enter items-center gap-3 rounded-full bg-surface-container-high px-5 transition-shadow focus-within:elev-2">
        <Icon name="search" className="text-on-surface-variant" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Cerca ${TYPES.find((t) => t.value === type)?.label.toLowerCase()} su Modrinth`}
          className="flex-1 bg-transparent text-[15px] outline-none"
          autoFocus
        />
        {loading && <Spinner size={22} className="text-primary" />}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {TYPES.map((t) => (
          <Chip key={t.value} label={t.label} icon={t.icon} selected={type === t.value} onClick={() => setType(t.value)} />
        ))}
        <div className="flex-1" />
        {type !== "modpack" && (
          <>
            <Chip
              label={target ? `Compatibili con ${target.name}` : "Compatibili"}
              icon="filter_alt"
              selected={compatibleOnly}
              onClick={() => setCompatibleOnly((v) => !v)}
            />
          </>
        )}
      </div>

      <div className="mt-4 grid grid-cols-[1fr_220px] gap-3">
        {type !== "modpack" ? (
          <Select label="Installa in" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
            {instances.length === 0 && <option value="">Nessuna istanza</option>}
            {instances.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} — {LOADER_LABEL[i.loader]} {i.mcVersion}
              </option>
            ))}
          </Select>
        ) : (
          <div className="flex items-center gap-2 rounded-2xl bg-tertiary-container px-4 text-sm text-on-tertiary-container">
            <Icon name="info" size={20} /> Un modpack viene installato come nuova istanza con loader e mod già configurati.
          </div>
        )}
        <Select label="Ordina per" value={sort} onChange={(e) => setSort(e.target.value)}>
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
      </div>

      <div className="mt-6 flex flex-col gap-2">
        {!loading && hits.length === 0 && <EmptyState icon="travel_explore" title="Nessun risultato" text="Prova con altri termini o disattiva il filtro di compatibilità." />}
        {hits.map((hit, i) => (
          <ResultCard key={hit.project_id} hit={hit} index={i} installing={installing.has(hit.project_id)} onInstall={() => install(hit)} />
        ))}
      </div>

      {hits.length > 0 && hits.length < total && (
        <div className={cn("mt-6 flex justify-center")}>
          <Button variant="tonal" icon="expand_more" loading={loading} onClick={() => search(hits.length)}>
            Carica altri ({total - hits.length})
          </Button>
        </div>
      )}
    </div>
  );
}
