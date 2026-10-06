import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage, isTauri } from "../../lib/api";
import { useApp } from "../../lib/store";
import type { FriendPresence, SearchUser } from "../../lib/types";
import { Avatar, bodyUrl } from "../../components/shell";
import { ChatDialog } from "./ChatDialog";
import { Badge, Button, cn, Dialog, EmptyState, Icon, IconButton, Spinner } from "../../components/ui";

const STATUS_DOT: Record<string, string> = {
  hosting: "bg-primary animate-pulse",
  playing: "bg-secondary",
  online: "bg-tertiary",
  offline: "bg-outline",
};

const SITE_URL = "https://nexusmc.online";

/** Apre WhatsApp (app o web) con un messaggio di invito pronto: l'utente sceglie a chi mandarlo. */
function inviteOnWhatsApp(name: string, me?: string) {
  const text =
    `Ciao ${name}! Ti ho aggiunto agli amici su Nexus Launcher, il launcher per Minecraft 🎮
` +
    `Scaricalo gratis da ${SITE_URL}, accedi con Microsoft e troverai la mia richiesta` +
    (me ? ` (sono ${me})` : "") +
    `. Così vediamo quando siamo online e giochiamo insieme!`;
  const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
  if (isTauri()) openUrl(url);
  else window.open(url, "_blank", "noopener");
}

function InviteButton({ name, me }: { name: string; me?: string }) {
  return (
    <Button size="sm" variant="tonal" icon="chat" className="bg-[#25D366]! text-[#052e16]!" onClick={() => inviteOnWhatsApp(name, me)}>
      Invita
    </Button>
  );
}

function AddFriendDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { refreshFriends, snack, accounts } = useApp();
  const me = accounts.find((a) => a.active && a.kind === "microsoft")?.username;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const reqId = useRef(0);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
    }
  }, [open]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const id = ++reqId.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        // In parallelo: utenti Nexus (con relazione) + profilo Minecraft esatto (per faccia + invito diretto).
        const [nexus, mojang] = await Promise.all([
          api.searchFriends(query.trim()),
          api.resolveMcName(query.trim()).catch(() => null),
        ]);
        let merged = nexus;
        // Se il nome esatto esiste su Minecraft ma non è tra i risultati Nexus, lo aggiungiamo:
        // così puoi invitarlo anche se non ha ancora aperto Nexus.
        if (mojang && !merged.some((u) => u.uuid === mojang.uuid)) {
          merged = [{ uuid: mojang.uuid, name: mojang.name, relation: "none" as const, registered: false }, ...merged];
        }
        if (id === reqId.current) setResults(merged);
      } catch (e) {
        if (id === reqId.current) snack(errorMessage(e), "error");
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [query, snack]);

  async function sendRequest(u: SearchUser) {
    setPending((s) => new Set(s).add(u.uuid));
    try {
      const status = await api.sendFriendRequest(u.uuid, u.name);
      setResults((prev) => prev.map((x) => (x.uuid === u.uuid ? { ...x, relation: status === "accepted" ? "friend" : "outgoing" } : x)));
      snack(status === "accepted" ? `Ora sei amico di ${u.name}!` : `Richiesta inviata a ${u.name}`, "success");
      refreshFriends();
    } catch (e) {
      snack(errorMessage(e), "error");
    } finally {
      setPending((s) => {
        const n = new Set(s);
        n.delete(u.uuid);
        return n;
      });
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Trova amici"
      icon="person_search"
      width={520}
      actions={
        <Button variant="text" onClick={onClose}>
          Chiudi
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-on-surface-variant">
          Scrivi il nome Minecraft: vedi la sua skin e invii la richiesta. Se non ha ancora Nexus, la richiesta
          resta in attesa e puoi invitarlo su WhatsApp: la troverà al primo accesso.
        </p>
        <div className="flex h-14 items-center gap-2 rounded-full bg-surface-container-high px-4">
          <Icon name="search" className="text-on-surface-variant" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nome utente…"
            className="flex-1 bg-transparent text-sm outline-none"
          />
          {loading && <Spinner size={20} className="text-primary" />}
        </div>

        <div className="flex flex-col gap-1.5">
          {!loading && query.trim().length >= 2 && results.length === 0 && (
            <p className="py-6 text-center text-sm text-on-surface-variant">Nessun giocatore Minecraft con questo nome.</p>
          )}
          {results.map((u) => (
            <div key={u.uuid} className="flex items-center gap-3 rounded-2xl bg-surface-container p-2.5">
              <Avatar account={{ uuid: u.uuid, kind: "microsoft", username: u.name, expiresAt: 0, active: false }} size={40} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{u.name}</p>
                {u.registered === false && <p className="text-xs text-on-surface-variant">Non ha ancora Nexus</p>}
              </div>
              {u.registered === false && (u.relation === "none" || u.relation === "outgoing") && <InviteButton name={u.name} me={me} />}
              {u.relation === "friend" ? (
                <Badge tone="tertiary">
                  <Icon name="check" size={14} /> Amico
                </Badge>
              ) : u.relation === "outgoing" ? (
                <Badge tone="secondary">In attesa</Badge>
              ) : u.relation === "incoming" ? (
                <Badge tone="primary">Ti ha aggiunto</Badge>
              ) : u.relation === "self" ? (
                <Badge>Tu</Badge>
              ) : (
                <Button size="sm" icon="person_add" loading={pending.has(u.uuid)} onClick={() => sendRequest(u)}>
                  Aggiungi
                </Button>
              )}
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  );
}

export function FriendsPage() {
  const { friends, refreshFriends, tunnel, setTunnel, snack, navigate, accounts } = useApp();
  const hasMsAccount = accounts.some((a) => a.kind === "microsoft");
  const me = accounts.find((a) => a.active && a.kind === "microsoft")?.username;
  const [addOpen, setAddOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [tunnelPort, setTunnelPort] = useState<number>(25565);
  const [tunnelLoading, setTunnelLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [chatWith, setChatWith] = useState<FriendPresence | null>(null);

  useEffect(() => {
    refreshFriends();
    api.getTunnelStatus().then(setTunnel).catch(() => {});
    api.detectLanPort().then((p) => p && setTunnelPort(p)).catch(() => {});
    // Aggiorna la presenza degli amici a intervalli regolari finché la pagina è aperta.
    const interval = setInterval(() => refreshFriends(), 25000);
    return () => clearInterval(interval);
  }, [refreshFriends, setTunnel]);

  function copyText(text: string, label: string) {
    navigator.clipboard.writeText(text);
    setCopied(text);
    snack(`${label} copiato! Incollalo in Minecraft → Multigiocatore → Accesso Diretto`, "success");
    setTimeout(() => setCopied(null), 2000);
  }

  const act = async (id: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusyId(id);
    try {
      await fn();
      await refreshFriends();
      if (ok) snack(ok, "success");
    } catch (e) {
      snack(errorMessage(e), "error");
    } finally {
      setBusyId(null);
    }
  };

  async function startTunnel() {
    setTunnelLoading(true);
    try {
      const info = await api.startTunnel(tunnelPort);
      setTunnel(info);
      snack(`Tunnel avviato: ${info.publicAddress}`, "success");
    } catch (e) {
      snack(errorMessage(e), "error");
    } finally {
      setTunnelLoading(false);
    }
  }
  async function stopTunnel() {
    setTunnelLoading(true);
    try {
      await api.stopTunnel();
      setTunnel(null);
    } catch (e) {
      snack(errorMessage(e), "error");
    } finally {
      setTunnelLoading(false);
    }
  }

  const sortedFriends: FriendPresence[] = [...friends.friends].sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="px-10 pt-8 pb-10">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="type-headline animate-enter">Amici & Multiplayer</h1>
          <p className="mt-1 text-sm text-on-surface-variant">
            Trova amici per nome, guarda cosa stanno giocando ed entra nei loro mondi.
          </p>
        </div>
        <Button icon="person_search" size="lg" onClick={() => setAddOpen(true)} disabled={!friends.configured || !hasMsAccount}>
          Trova amici
        </Button>
      </div>

      {friends.configured && !hasMsAccount && (
        <div className="mb-8 flex animate-enter items-start gap-4 rounded-3xl bg-secondary-container p-5 text-on-secondary-container">
          <Icon name="account_circle" size={28} />
          <div className="flex-1 text-sm">
            <p className="font-semibold">Accedi con Microsoft per usare gli amici</p>
            <p className="mt-1">La lista amici e la presenza usano il tuo profilo Minecraft verificato. Con un account offline non è disponibile.</p>
          </div>
          <Button variant="filled" onClick={() => navigate("accounts")}>
            Accedi
          </Button>
        </div>
      )}

      {friends.configured && hasMsAccount && friends.error && (
        <div className="mb-8 flex animate-enter items-start gap-4 rounded-3xl bg-error-container p-5 text-on-error-container">
          <Icon name="cloud_off" size={28} />
          <div className="flex-1 text-sm">
            <p className="font-semibold">Server amici non raggiungibile</p>
            <p className="mt-1">{friends.error}</p>
          </div>
          <Button variant="filled" onClick={() => refreshFriends()}>
            Riprova
          </Button>
        </div>
      )}

      {!friends.configured && (
        <div className="mb-8 flex animate-enter items-start gap-4 rounded-3xl bg-tertiary-container p-5 text-on-tertiary-container">
          <Icon name="cloud_off" size={28} />
          <div className="flex-1 text-sm">
            <p className="font-semibold">Server amici non configurato</p>
            <p className="mt-1">
              La lista amici con ricerca e presenza reale ha bisogno del piccolo server gratuito Nexus Social.
              Imposta l'URL del server nelle Impostazioni (lascia vuoto per usare quello predefinito di Nexus).
            </p>
          </div>
          <Button variant="filled" onClick={() => navigate("settings")}>
            Impostazioni
          </Button>
        </div>
      )}

      {/* Host Mondo con Tunnel */}
      <div className="mb-8 overflow-hidden rounded-3xl bg-surface-container p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-4">
            <div className={cn("flex size-12 shrink-0 items-center justify-center rounded-2xl", tunnel?.active ? "bg-primary text-on-primary animate-pulse" : "bg-primary-container text-on-primary-container")}>
              <Icon name="cell_tower" size={28} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold">Host Mondo LAN (Tunnel Nexus)</h2>
                <Badge tone={tunnel?.active ? "primary" : "secondary"}>{tunnel?.active ? "ONLINE" : "INATTIVO"}</Badge>
              </div>
              <p className="mt-1 max-w-xl text-xs text-on-surface-variant">
                Apri un mondo singleplayer con "Apri in LAN", poi avvia il tunnel: gli amici entrano da qualsiasi rete senza aprire porte.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {!tunnel?.active ? (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-on-surface-variant">Porta LAN:</span>
                  <input
                    type="number"
                    value={tunnelPort}
                    onChange={(e) => setTunnelPort(Number(e.target.value))}
                    className="w-24 rounded-xl bg-surface-container-high px-3 py-1.5 text-center font-mono text-sm outline-none"
                  />
                </div>
                <Button icon="sensors" loading={tunnelLoading} onClick={startTunnel}>
                  Avvia Tunnel
                </Button>
              </>
            ) : (
              <Button icon="stop_circle" variant="tonal" className="bg-error-container text-on-error-container" loading={tunnelLoading} onClick={stopTunnel}>
                Ferma Tunnel
              </Button>
            )}
          </div>
        </div>
        {tunnel?.active && (
          <div className="mt-5 flex animate-enter flex-col items-center justify-between gap-4 rounded-2xl border border-outline-variant/30 bg-surface-container-high p-4 sm:flex-row">
            <div className="flex items-center gap-3">
              <Icon name="link" className="text-primary" size={24} />
              <div>
                <p className="text-xs text-on-surface-variant">Indirizzo pubblico per gli amici:</p>
                <p className="select-all font-mono text-lg font-bold text-primary">{tunnel.publicAddress}</p>
              </div>
            </div>
            <Button icon={copied === tunnel.publicAddress ? "check" : "content_copy"} onClick={() => copyText(tunnel.publicAddress, "Indirizzo tunnel")}>
              {copied === tunnel.publicAddress ? "Copiato!" : "Copia indirizzo"}
            </Button>
          </div>
        )}
      </div>

      {/* Richieste in entrata */}
      {friends.incoming.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-3 text-lg font-semibold">Richieste di amicizia</h2>
          <div className="flex flex-col gap-2">
            {friends.incoming.map((u) => (
              <div key={u.uuid} className="flex items-center gap-3 rounded-2xl bg-primary-container/40 p-3">
                <Avatar account={{ uuid: u.uuid, kind: "microsoft", username: u.name, expiresAt: 0, active: false }} size={44} />
                <span className="min-w-0 flex-1 truncate font-medium">
                  {u.name} <span className="text-sm font-normal text-on-surface-variant">vuole aggiungerti</span>
                </span>
                <Button size="sm" icon="check" loading={busyId === u.uuid} onClick={() => act(u.uuid, () => api.respondFriendRequest(u.uuid, true), `Ora sei amico di ${u.name}`)}>
                  Accetta
                </Button>
                <IconButton icon="close" label="Rifiuta" onClick={() => act(u.uuid, () => api.respondFriendRequest(u.uuid, false))} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Lista amici */}
      <div className="mb-4 flex items-center gap-2">
        <h2 className="text-lg font-semibold">Amici</h2>
        <span className="rounded-full bg-secondary-container px-2 py-0.5 text-xs font-bold text-on-secondary-container">{friends.friends.length}</span>
      </div>

      {friends.configured && sortedFriends.length === 0 ? (
        <EmptyState
          icon="group"
          title="Ancora nessun amico"
          text="Usa 'Trova amici' per cercare qualcuno per nome e inviare una richiesta."
          action={<Button icon="person_search" onClick={() => setAddOpen(true)}>Trova amici</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {sortedFriends.map((f) => (
            <div key={f.uuid} className={cn("flex items-start justify-between gap-4 rounded-3xl border border-outline-variant/20 bg-surface-container p-5 transition-colors hover:bg-surface-container-high", !f.online && "opacity-70")}>
              <div className="flex min-w-0 items-start gap-3.5">
                <div className="relative">
                  <Avatar account={{ uuid: f.uuid, kind: "microsoft", username: f.name, expiresAt: 0, active: false }} size={48} />
                  <span className={cn("absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full border-2 border-surface", STATUS_DOT[f.status] ?? "bg-outline")} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1">
                    <span className="truncate text-base font-semibold">{f.name}</span>
                    <IconButton
                      icon="star"
                      selected={f.favorite}
                      label={f.favorite ? "Rimuovi dai preferiti" : "Aggiungi ai preferiti"}
                      size={28}
                      className={f.favorite ? "text-amber-400!" : "opacity-60 hover:opacity-100"}
                      disabled={busyId === f.uuid}
                      onClick={() => act(f.uuid, () => api.setFriendFavorite(f.uuid, !f.favorite), f.favorite ? `${f.name} rimosso dai preferiti` : `${f.name} aggiunto ai preferiti`)}
                    />
                  </div>
                  {f.status === "hosting" ? (
                    <div className="mt-1">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                        <Icon name="cell_tower" size={16} /> {f.detail || "Sta hostando un mondo"}
                      </div>
                      {f.joinAddress && <p className="mt-0.5 truncate font-mono text-[11px] text-on-surface-variant">{f.joinAddress}</p>}
                    </div>
                  ) : f.status === "playing" ? (
                    <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-secondary">
                      <Icon name="sports_esports" size={16} /> {f.detail || "In gioco"}
                    </p>
                  ) : f.online ? (
                    <p className="mt-1 flex items-center gap-1 text-xs text-on-surface-variant">
                      <Icon name="check_circle" size={14} className="text-tertiary" /> Online
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-outline">Offline</p>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {f.status === "hosting" && f.joinAddress && (
                  <Button size="sm" icon="login" onClick={() => copyText(f.joinAddress, "Indirizzo del mondo")}>
                    Entra
                  </Button>
                )}
                <div className="relative">
                  <IconButton icon="chat" label={`Chat con ${f.name}`} size={36} variant="tonal" onClick={() => setChatWith(f)} />
                  {(f.unread ?? 0) > 0 && (
                    <span className="pointer-events-none absolute -top-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-error px-1 text-[10px] font-bold text-on-error">
                      {(f.unread ?? 0) > 9 ? "9+" : f.unread}
                    </span>
                  )}
                </div>
                <IconButton icon="person_remove" label="Rimuovi amico" size={32} className="text-on-surface-variant hover:text-error" onClick={() => act(f.uuid, () => api.removeFriend(f.uuid), `${f.name} rimosso`)} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Richieste inviate: anche a chi non ha ancora Nexus (skin dalle API Minecraft + invito WhatsApp) */}
      {friends.outgoing.length > 0 && (
        <div className="mt-8">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-lg font-semibold">Richieste inviate</h2>
            <span className="rounded-full bg-surface-container-highest px-2 py-0.5 text-xs font-bold text-on-surface-variant">{friends.outgoing.length}</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {friends.outgoing.map((u) => (
              <div key={u.uuid} className="flex items-center gap-4 rounded-3xl bg-surface-container p-4">
                <div className="flex h-24 w-14 shrink-0 items-end justify-center overflow-hidden rounded-2xl bg-surface-container-highest">
                  <img src={bodyUrl(u.uuid, 160)} alt="" className="h-[88px] w-auto [image-rendering:pixelated]" loading="lazy" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{u.name}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-on-surface-variant">
                    <Icon name={u.registered === false ? "person_off" : "schedule"} size={14} />
                    {u.registered === false ? "Non ha ancora Nexus" : "In attesa di risposta"}
                  </p>
                  <div className="mt-2.5 flex items-center gap-1">
                    {u.registered === false && <InviteButton name={u.name} me={me} />}
                    <IconButton
                      icon="close"
                      label="Annulla richiesta"
                      size={32}
                      className="text-on-surface-variant hover:text-error"
                      onClick={() => act(u.uuid, () => api.removeFriend(u.uuid), `Richiesta a ${u.name} annullata`)}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <AddFriendDialog open={addOpen} onClose={() => setAddOpen(false)} />
      <ChatDialog friend={chatWith} onClose={() => setChatWith(null)} />
    </div>
  );
}
