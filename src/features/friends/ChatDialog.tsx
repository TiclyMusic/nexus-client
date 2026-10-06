import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { useApp, type ChatTarget } from "../../lib/store";
import { Avatar } from "../../components/shell";
import { cn, Dialog, Icon, IconButton, Spinner } from "../../components/ui";

const MAX = 1000;
const POLL_MS = 4000;

/** Messaggio mostrato nella chat, privata o di gruppo. */
interface Bubble {
  id: number;
  from: string;
  name: string;
  text: string;
  created: number;
}

const time = (ms: number) => new Date(ms).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
const day = (ms: number) => {
  const d = new Date(ms).toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });
  return d.charAt(0).toUpperCase() + d.slice(1);
};
const head = (uuid: string, name: string) => ({ uuid, kind: "microsoft" as const, username: name, expiresAt: 0, active: false });

function load(target: ChatTarget, after?: number): Promise<Bubble[]> {
  return target.kind === "group"
    ? api.getGroupMessages(target.id, after)
    : api.getChatMessages(target.uuid, after).then((list) => list.map((m) => ({ ...m, name: "" })));
}

function send(target: ChatTarget, text: string): Promise<Bubble> {
  return target.kind === "group"
    ? api.sendGroupMessage(target.id, text)
    : api.sendChatMessage(target.uuid, text).then((m) => ({ ...m, name: "" }));
}

/** Chat aperta (dallo store): carica gli ultimi messaggi e controlla i nuovi ogni pochi secondi. */
export function ChatDialog() {
  const { chat, closeChat, snack, friends, groups, accounts } = useApp();
  const [messages, setMessages] = useState<Bubble[]>([]);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const lastId = useRef(0);
  const key = chat ? (chat.kind === "group" ? `g${chat.id}` : `d${chat.uuid}`) : null;
  const myUuid = accounts.find((a) => a.active && a.kind === "microsoft")?.uuid;

  const friend = chat?.kind === "direct" ? friends.friends.find((f) => f.uuid === chat.uuid) : undefined;
  const group = chat?.kind === "group" ? groups.find((g) => g.id === chat.id) : undefined;

  // apertura: carica la conversazione e avvia l'aggiornamento periodico
  useEffect(() => {
    if (!chat) return;
    let alive = true;
    setMessages([]);
    setText("");
    lastId.current = 0;
    setLoading(true);

    const merge = (incoming: Bubble[]) => {
      if (!incoming.length) return;
      lastId.current = Math.max(lastId.current, ...incoming.map((m) => m.id));
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        return [...prev, ...incoming.filter((m) => !seen.has(m.id))];
      });
    };

    load(chat)
      .then((m) => alive && merge(m))
      .catch((e) => alive && snack(errorMessage(e), "error"))
      .finally(() => alive && setLoading(false));

    const timer = setInterval(() => {
      if (document.hidden) return;
      load(chat, lastId.current).then((m) => alive && merge(m)).catch(() => {});
    }, POLL_MS);

    return () => {
      alive = false;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // scorri in fondo quando arrivano messaggi
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  async function submit() {
    const body = text.trim();
    if (!chat || !body || sending) return;
    setSending(true);
    try {
      const msg = await send(chat, body);
      setText("");
      lastId.current = Math.max(lastId.current, msg.id);
      setMessages((prev) => [...prev, msg]);
    } catch (e) {
      snack(errorMessage(e), "error");
    } finally {
      setSending(false);
    }
  }

  const title = group?.name ?? chat?.name ?? "";
  const subtitle =
    chat?.kind === "group"
      ? group
        ? group.members.map((m) => (m.uuid === myUuid ? "Tu" : m.name)).join(", ")
        : "Gruppo"
      : friend?.online
        ? friend.detail || "Online"
        : "Offline";
  const mine = (m: Bubble) => (chat?.kind === "direct" ? m.from !== chat.uuid : m.from === myUuid);

  return (
    <Dialog open={!!chat} onClose={closeChat} width={560}>
      {chat && (
        <div className="flex h-[min(620px,80vh)] flex-col">
          {/* intestazione */}
          <div className="flex items-center gap-3 border-b border-outline-variant/30 px-5 py-4">
            {chat.kind === "group" ? (
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary-container text-on-secondary-container">
                <Icon name="groups" size={24} />
              </div>
            ) : (
              <Avatar account={head(chat.uuid, chat.name)} size={40} />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-on-surface">{title}</p>
              <p className="truncate text-xs text-on-surface-variant">{subtitle}</p>
            </div>
            <IconButton icon="close" label="Chiudi la chat" onClick={closeChat} />
          </div>

          {/* messaggi */}
          <div ref={listRef} className="selectable flex flex-1 flex-col gap-1.5 overflow-y-auto px-5 py-4">
            {loading && messages.length === 0 && (
              <div className="flex flex-1 items-center justify-center">
                <Spinner size={28} className="text-primary" />
              </div>
            )}
            {!loading && messages.length === 0 && (
              <p className="m-auto max-w-xs text-center text-sm text-on-surface-variant">
                {chat.kind === "group" ? "Nessun messaggio nel gruppo. Rompi il ghiaccio!" : `Nessun messaggio. Scrivi a ${chat.name} per organizzare la prossima partita.`}
              </p>
            )}
            {messages.map((m, i) => {
              const own = mine(m);
              const prev = messages[i - 1];
              const newDay = !prev || new Date(prev.created).toDateString() !== new Date(m.created).toDateString();
              // nei gruppi nome e testa del mittente quando cambia chi scrive
              const showSender = chat.kind === "group" && !own && (newDay || prev?.from !== m.from);
              return (
                <div key={m.id} className="flex flex-col">
                  {newDay && <p className="my-2 text-center text-xs font-medium text-on-surface-variant">{day(m.created)}</p>}
                  {showSender && (
                    <div className="mt-1.5 mb-0.5 flex items-center gap-1.5 pl-1">
                      <Avatar account={head(m.from, m.name)} size={18} className="rounded-md" />
                      <span className="text-xs font-semibold text-on-surface-variant">{m.name}</span>
                    </div>
                  )}
                  <div
                    className={cn(
                      "max-w-[78%] animate-enter rounded-3xl px-4 py-2 text-sm whitespace-pre-wrap break-words",
                      own
                        ? "self-end rounded-br-lg bg-primary-container text-on-primary-container"
                        : "self-start rounded-bl-lg bg-surface-container-highest text-on-surface",
                    )}
                  >
                    {m.text}
                    <span className="ml-2 align-bottom text-[10px] opacity-60">{time(m.created)}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* invio */}
          <div className="border-t border-outline-variant/30 p-3">
            <div className="flex items-end gap-2 rounded-[24px] bg-surface-container-highest py-1.5 pr-1.5 pl-4">
              <textarea
                autoFocus
                rows={1}
                value={text}
                maxLength={MAX}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder={chat.kind === "group" ? `Scrivi in ${title}…` : `Scrivi a ${chat.name}…`}
                className="max-h-32 flex-1 resize-none bg-transparent py-2 text-sm text-on-surface outline-none field-sizing-content"
              />
              <IconButton icon="send" label="Invia" variant="filled" selected={!!text.trim()} disabled={!text.trim() || sending} onClick={submit} />
            </div>
            {text.length > MAX - 100 && (
              <p className="mt-1 px-4 text-right text-[11px] text-on-surface-variant">
                {text.length}/{MAX}
              </p>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
