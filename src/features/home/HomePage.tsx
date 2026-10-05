import { api, errorMessage } from "../../lib/api";
import { formatDuration, formatRelative, gb, LOADER_LABEL } from "../../lib/format";
import { useApp } from "../../lib/store";
import type { Instance } from "../../lib/types";
import { InstanceIcon } from "../../components/shell";
import { Badge, Button, Card, EmptyState, Fab, Icon, IconButton, WavyProgress } from "../../components/ui";

const SUGGESTIONS = [
  { icon: "speed", text: "Voglio un'istanza survival ottimizzata per un PC di fascia media con shader leggeri" },
  { icon: "photo_camera", text: "Crea un'istanza con gli shader più belli per fare screenshot" },
  { icon: "groups", text: "Quali mod servono per giocare in multiplayer con amici su Fabric?" },
];

function PlayButton({ instance, big }: { instance: Instance; big?: boolean }) {
  const { running, progress, launch, snack } = useApp();
  const isRunning = instance.id in running;
  const busy = instance.id in progress;
  if (isRunning) {
    const stop = () => api.killInstance(instance.id).catch((e) => snack(errorMessage(e), "error"));
    return big ? (
      <Fab icon="stop" label="Chiudi gioco" variant="tertiary" size="lg" onClick={stop} />
    ) : (
      <IconButton icon="stop" label="Chiudi" variant="tonal" selected onClick={(e) => {
          e.stopPropagation();
          stop();
        }} />
    );
  }
  return big ? (
    <Fab icon="play_arrow" label="Gioca" variant="primary" size="lg" loading={busy} onClick={() => launch(instance.id)} />
  ) : (
    <IconButton
      icon="play_arrow"
      label="Gioca"
      variant="filled"
      disabled={busy}
      onClick={(e) => {
        e.stopPropagation();
        launch(instance.id);
      }}
    />
  );
}

function Hero({ instance }: { instance: Instance }) {
  const { progress, running, openInstance } = useApp();
  const p = progress[instance.id];
  return (
    <div
      className="relative animate-enter overflow-hidden rounded-[36px] p-8 text-on-primary-container"
      style={{
        background:
          "radial-gradient(120% 140% at 0% 0%, var(--md-primary-container) 0%, transparent 60%), radial-gradient(100% 120% at 100% 100%, var(--md-tertiary-container) 0%, transparent 65%), var(--md-surface-container-high)",
      }}
    >
      {/* forme decorative organiche */}
      <div className="pointer-events-none absolute -top-16 -right-10 size-64 rounded-[42%_58%_60%_40%/45%_45%_55%_55%] bg-primary/15 blur-[2px]" />
      <div className="pointer-events-none absolute right-40 -bottom-20 size-48 rounded-[60%_40%_38%_62%/55%_60%_40%_45%] bg-tertiary/15" />

      <div className="relative flex items-end gap-8">
        <div className="min-w-0 flex-1">
          <p className="type-label mb-3 text-on-surface-variant uppercase">
            {instance.lastPlayed ? "Continua a giocare" : "Pronta a partire"}
          </p>
          <div className="flex items-center gap-5">
            <InstanceIcon instance={instance} size={88} className="elev-2" />
            <div className="min-w-0">
              <h1 className="type-display truncate text-on-surface">{instance.name}</h1>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge tone="primary">
                  <Icon name="deployed_code" size={14} /> {instance.mcVersion}
                </Badge>
                <Badge tone="secondary">{LOADER_LABEL[instance.loader]}</Badge>
                <Badge tone="tertiary">
                  <Icon name="memory" size={14} /> {gb(instance.maxRamMb)}
                </Badge>
                {instance.id in running && <Badge tone="error">● In esecuzione</Badge>}
              </div>
            </div>
          </div>
          <p className="mt-5 text-sm text-on-surface-variant">
            {formatRelative(instance.lastPlayed)} · {formatDuration(instance.playTimeSecs)} di gioco
          </p>
          {p && (
            <div className="mt-4 flex max-w-md items-center gap-3 text-xs text-on-surface-variant">
              <span>{p.stage}</span>
              <WavyProgress value={p.total ? p.done / p.total : null} />
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-3">
          <PlayButton instance={instance} big />
          <Button variant="text" icon="tune" onClick={() => openInstance(instance.id)}>
            Gestisci
          </Button>
        </div>
      </div>
    </div>
  );
}

function InstanceCard({ instance, index }: { instance: Instance; index: number }) {
  const { openInstance, progress } = useApp();
  const p = progress[instance.id];
  return (
    <Card
      onClick={() => openInstance(instance.id)}
      className="group p-4 transition-[border-radius,background-color] duration-300 ease-spring hover:rounded-[36px] hover:bg-surface-container-high"
    >
      <div style={{ animationDelay: `${index * 40}ms` }} className="flex animate-enter items-center gap-4">
        <InstanceIcon instance={instance} size={56} className="transition-[border-radius] duration-500 ease-spring group-hover:rounded-full" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{instance.name}</p>
          <p className="truncate text-xs text-on-surface-variant">
            {LOADER_LABEL[instance.loader]} {instance.mcVersion} · {formatRelative(instance.lastPlayed)}
          </p>
        </div>
        <PlayButton instance={instance} />
      </div>
      {p && <WavyProgress className="mt-3" value={p.total ? p.done / p.total : null} />}
    </Card>
  );
}

export function HomePage({ onNewInstance }: { onNewInstance: () => void }) {
  const { instances, accounts, askAi } = useApp();
  const user = accounts.find((a) => a.active) ?? accounts[0];
  const [first, ...rest] = instances;

  return (
    <div className="relative min-h-full px-10 pt-8 pb-8">
      <div className="mb-8 animate-enter">
        <h1 className="type-headline">{user ? `Bentornato, ${user.username}` : "Benvenuto in Nexus"}</h1>
        <p className="text-sm text-on-surface-variant">
          {instances.length} {instances.length === 1 ? "istanza" : "istanze"} · Minecraft Java Edition
        </p>
      </div>

      {!first ? (
        <EmptyState
          icon="deployed_code"
          title="Nessuna istanza"
          text="Crea la tua prima istanza oppure chiedi al Copilot AI di configurarne una su misura per il tuo PC."
          action={
            <div className="flex gap-2">
              <Button icon="add" onClick={onNewInstance}>
                Nuova istanza
              </Button>
              <Button variant="tonal" icon="auto_awesome" onClick={() => askAi(SUGGESTIONS[0].text)}>
                Chiedi all'AI
              </Button>
            </div>
          }
        />
      ) : (
        <Hero instance={first} />
      )}

      <div className="mt-8 grid grid-cols-3 gap-3">
        {SUGGESTIONS.map((s, i) => (
          <Card
            key={s.text}
            variant="outlined"
            onClick={() => askAi(s.text)}
            className="flex animate-enter items-start gap-3 p-4 text-sm transition-[border-radius] duration-300 ease-spring hover:rounded-[32px]"
          >
            <div
              className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-tertiary-container text-on-tertiary-container"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <Icon name={s.icon} size={20} />
            </div>
            <p className="text-on-surface-variant">
              <span className="font-semibold text-on-surface">Copilot · </span>
              {s.text}
            </p>
          </Card>
        ))}
      </div>

      {rest.length > 0 && (
        <>
          <h2 className="type-title mt-10 mb-4">Le tue istanze</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
            {rest.map((inst, i) => (
              <InstanceCard key={inst.id} instance={inst} index={i} />
            ))}
          </div>
        </>
      )}

      <div className="pointer-events-none sticky bottom-8 z-10 mt-8 flex justify-end">
        <Fab className="pointer-events-auto" icon="add" label="Nuova istanza" variant="secondary" onClick={onNewInstance} />
      </div>
    </div>
  );
}
