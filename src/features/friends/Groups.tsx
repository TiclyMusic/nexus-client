import { useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { useApp } from "../../lib/store";
import type { FriendPresence, Group } from "../../lib/types";
import { Avatar } from "../../components/shell";
import { Button, cn, Dialog, Icon, IconButton, TextField } from "../../components/ui";

const head = (uuid: string, name: string) => ({ uuid, kind: "microsoft" as const, username: name, expiresAt: 0, active: false });

/** Lista di amici selezionabili (per creare un gruppo o aggiungere membri). */
function FriendPicker({ friends, selected, onToggle }: { friends: FriendPresence[]; selected: Set<string>; onToggle: (uuid: string) => void }) {
  if (!friends.length) {
    return <p className="rounded-2xl bg-surface-container-highest p-4 text-center text-sm">Nessun amico da aggiungere.</p>;
  }
  return (
    <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
      {friends.map((f) => {
        const on = selected.has(f.uuid);
        return (
          <button
            key={f.uuid}
            type="button"
            onClick={() => onToggle(f.uuid)}
            className={cn(
              "state-layer flex cursor-pointer items-center gap-3 rounded-2xl px-3 py-2 text-left text-on-surface transition-colors",
              on && "bg-secondary-container text-on-secondary-container",
            )}
          >
            <Avatar account={head(f.uuid, f.name)} size={36} />
            <span className="min-w-0 flex-1 truncate font-medium">{f.name}</span>
            <Icon name={on ? "check_circle" : "radio_button_unchecked"} filled={on} size={22} className={on ? "text-primary" : "text-outline"} />
          </button>
        );
      })}
    </div>
  );
}

export function CreateGroupDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { friends, refreshGroups, openChat, snack } = useApp();
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setSelected(new Set());
    }
  }, [open]);

  const toggle = (uuid: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(uuid)) next.delete(uuid);
      else next.add(uuid);
      return next;
    });

  async function create() {
    setBusy(true);
    try {
      const groupName = name.trim();
      const id = await api.createGroup(groupName, [...selected]);
      await refreshGroups();
      onClose();
      openChat({ kind: "group", id, name: groupName });
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
      title="Nuovo gruppo"
      icon="group_add"
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            Annulla
          </Button>
          <Button icon="check" loading={busy} disabled={!name.trim() || selected.size === 0} onClick={create}>
            Crea gruppo
          </Button>
        </>
      }
    >
      <TextField label="Nome del gruppo" icon="badge" value={name} maxLength={40} autoFocus onChange={(e) => setName(e.target.value)} />
      <p className="mt-5 mb-2 text-xs font-semibold tracking-wide text-on-surface-variant uppercase">
        Amici {selected.size > 0 && `· ${selected.size} selezionati`}
      </p>
      <FriendPicker friends={friends.friends} selected={selected} onToggle={toggle} />
    </Dialog>
  );
}

/** Impostazioni del gruppo: nome, membri (aggiungi / rimuovi) e uscita. */
export function GroupSettingsDialog({ group, onClose }: { group: Group | null; onClose: () => void }) {
  const { friends, accounts, refreshGroups, snack } = useApp();
  const myUuid = accounts.find((a) => a.active && a.kind === "microsoft")?.uuid;
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    setName(group?.name ?? "");
    setAdding(false);
    setSelected(new Set());
  }, [group]);

  if (!group) return null;
  const isOwner = group.owner === myUuid;
  const memberIds = new Set(group.members.map((m) => m.uuid));
  const addable = friends.friends.filter((f) => !memberIds.has(f.uuid));

  const run = async (key: string, fn: () => Promise<unknown>, ok?: string, close = false) => {
    setBusy(key);
    try {
      await fn();
      await refreshGroups();
      if (ok) snack(ok, "success");
      if (close) onClose();
    } catch (e) {
      snack(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={group.name}
      icon="groups"
      actions={
        <>
          <Button
            variant="text"
            icon="logout"
            className="mr-auto text-error!"
            loading={busy === "leave"}
            onClick={() => run("leave", () => api.leaveGroup(group.id), `Sei uscito da ${group.name}`, true)}
          >
            Esci dal gruppo
          </Button>
          <Button variant="text" onClick={onClose}>
            Chiudi
          </Button>
        </>
      }
    >
      <div className="flex items-end gap-2">
        <TextField label="Nome del gruppo" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} className="flex-1" />
        <Button
          variant="tonal"
          disabled={!name.trim() || name.trim() === group.name}
          loading={busy === "rename"}
          onClick={() => run("rename", () => api.renameGroup(group.id, name.trim()), "Nome aggiornato")}
        >
          Salva
        </Button>
      </div>

      <div className="mt-6 mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold tracking-wide text-on-surface-variant uppercase">Membri · {group.members.length}</p>
        {!adding && (
          <Button size="sm" variant="text" icon="person_add" onClick={() => setAdding(true)}>
            Aggiungi
          </Button>
        )}
      </div>

      {adding ? (
        <div className="rounded-3xl bg-surface-container p-3">
          <FriendPicker
            friends={addable}
            selected={selected}
            onToggle={(uuid) =>
              setSelected((s) => {
                const next = new Set(s);
                if (next.has(uuid)) next.delete(uuid);
                else next.add(uuid);
                return next;
              })
            }
          />
          <div className="mt-3 flex justify-end gap-2">
            <Button size="sm" variant="text" onClick={() => setAdding(false)}>
              Annulla
            </Button>
            <Button
              size="sm"
              icon="check"
              disabled={!selected.size}
              loading={busy === "add"}
              onClick={() =>
                run("add", () => api.addGroupMembers(group.id, [...selected]), selected.size === 1 ? "Amico aggiunto" : "Amici aggiunti").then(() => {
                  setAdding(false);
                  setSelected(new Set());
                })
              }
            >
              Aggiungi
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {group.members.map((m) => (
            <div key={m.uuid} className="flex items-center gap-3 rounded-2xl px-3 py-2 text-on-surface">
              <div className="relative">
                <Avatar account={head(m.uuid, m.name)} size={36} />
                <span className={cn("absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-surface-container-high", m.online ? "bg-tertiary" : "bg-outline")} />
              </div>
              <span className="min-w-0 flex-1 truncate font-medium">
                {m.name}
                {m.uuid === myUuid && <span className="font-normal text-on-surface-variant"> (tu)</span>}
              </span>
              {m.uuid === group.owner && <span className="text-xs text-on-surface-variant">Creatore</span>}
              {isOwner && m.uuid !== myUuid && (
                <IconButton
                  icon="person_remove"
                  label={`Rimuovi ${m.name}`}
                  size={32}
                  className="hover:text-error"
                  disabled={busy === m.uuid}
                  onClick={() => run(m.uuid, () => api.kickGroupMember(group.id, m.uuid), `${m.name} rimosso dal gruppo`)}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </Dialog>
  );
}

/** Teste dei membri sovrapposte. */
function Faces({ group }: { group: Group }) {
  const shown = group.members.slice(0, 4);
  return (
    <div className="flex shrink-0 -space-x-3">
      {shown.map((m) => (
        <Avatar key={m.uuid} account={head(m.uuid, m.name)} size={40} className="ring-4 ring-surface-container" />
      ))}
      {group.members.length > shown.length && (
        <div className="flex size-10 items-center justify-center rounded-xl bg-surface-container-highest text-xs font-bold ring-4 ring-surface-container">
          +{group.members.length - shown.length}
        </div>
      )}
    </div>
  );
}

export function GroupsSection({ enabled }: { enabled: boolean }) {
  const { groups, refreshGroups, openChat } = useApp();
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsId, setSettingsId] = useState<number | null>(null);

  useEffect(() => {
    if (enabled) refreshGroups();
  }, [enabled, refreshGroups]);

  const settings = groups.find((g) => g.id === settingsId) ?? null;

  return (
    <div className="mt-8">
      <div className="mb-4 flex items-center gap-2">
        <h2 className="text-lg font-semibold">Gruppi</h2>
        <span className="rounded-full bg-secondary-container px-2 py-0.5 text-xs font-bold text-on-secondary-container">{groups.length}</span>
        <Button size="sm" variant="text" icon="group_add" className="ml-auto" disabled={!enabled} onClick={() => setCreateOpen(true)}>
          Nuovo gruppo
        </Button>
      </div>

      {groups.length === 0 ? (
        <button
          type="button"
          disabled={!enabled}
          onClick={() => setCreateOpen(true)}
          className="state-layer flex w-full cursor-pointer items-center gap-4 rounded-3xl border border-dashed border-outline-variant p-5 text-left text-on-surface-variant disabled:cursor-default disabled:opacity-50"
        >
          <span className="flex size-12 items-center justify-center rounded-2xl bg-secondary-container text-on-secondary-container">
            <Icon name="group_add" size={26} />
          </span>
          <span className="text-sm">
            <span className="block font-semibold text-on-surface">Crea un gruppo</span>
            Una chat con più amici insieme, per organizzare le partite.
          </span>
        </button>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {groups.map((g) => {
            const online = g.members.filter((m) => m.online).length;
            return (
              <div
                key={g.id}
                role="button"
                tabIndex={0}
                onClick={() => openChat({ kind: "group", id: g.id, name: g.name })}
                onKeyDown={(e) => e.key === "Enter" && openChat({ kind: "group", id: g.id, name: g.name })}
                className="flex cursor-pointer items-center gap-4 rounded-3xl border border-outline-variant/20 bg-surface-container p-5 transition-colors hover:bg-surface-container-high"
              >
                <Faces group={g} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-semibold">{g.name}</p>
                  <p className="mt-0.5 text-xs text-on-surface-variant">
                    {g.members.length} membri{online > 1 ? ` · ${online} online` : ""}
                  </p>
                </div>
                {g.unread > 0 && (
                  <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-error px-1.5 text-xs font-bold text-on-error">
                    {g.unread > 9 ? "9+" : g.unread}
                  </span>
                )}
                <IconButton
                  icon="more_vert"
                  label="Impostazioni del gruppo"
                  size={36}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSettingsId(g.id);
                  }}
                />
              </div>
            );
          })}
        </div>
      )}

      <CreateGroupDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      <GroupSettingsDialog group={settings} onClose={() => setSettingsId(null)} />
    </div>
  );
}
