import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { useApp } from "../../lib/store";
import type { DirectMessage, FriendPresence } from "../../lib/types";
import { Avatar } from "../../components/shell";
import { cn, Dialog, IconButton, Spinner } from "../../components/ui";

const MAX = 1000;
const POLL_MS = 4000;

const time = (ms: number) => new Date(ms).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
const day = (ms: number) => {
  const d = new Date(ms).toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });
  return d.charAt(0).toUpperCase() + d.slice(1);
};

/** Chat privata con un amico: carica gli ultimi messaggi e controlla i nuovi ogni pochi secondi. */
export function ChatDialog({ friend, onClose }: { friend: FriendPresence | null; onClose: () => void }) {
  const { snack, refreshFriends } = useApp();
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const lastId = useRef(0);
  const uuid = friend?.uuid;

  // apertura: carica la conversazione e avvia l'aggiornamento periodico
  useEffect(() => {
    if (!uuid) return;
    let alive = true;
    setMessages([]);
    setText("");
    lastId.current = 0;
    setLoading(true);

    const merge = (incoming: DirectMessage[]) => {
      if (!incoming.length) return;
      lastId.current = Math.max(lastId.current, ...incoming.map((m) => m.id));
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        return [...prev, ...incoming.filter((m) => !seen.has(m.id))];
      });
    };

    api
      .getChatMessages(uuid)
      .then((m) => alive && merge(m))
      .catch((e) => alive && snack(errorMessage(e), "error"))
      .finally(() => alive && setLoading(false));

    const timer = setInterval(() => {
      if (document.hidden) return;
      api.getChatMessages(uuid, lastId.current).then((m) => alive && merge(m)).catch(() => {});
    }, POLL_MS);

    return () => {
      alive = false;
      clearInterval(timer);
      refreshFriends(); // aggiorna i badge dei non letti
    };
  }, [uuid, snack, refreshFriends]);

  // scorri in fondo quando arrivano messaggi
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  async function send() {
    const body = text.trim();
    if (!uuid || !body || sending) return;
    setSending(true);
    try {
      const msg = await api.sendChatMessage(uuid, body);
      setText("");
      lastId.current = Math.max(lastId.current, msg.id);
      setMessages((prev) => [...prev, msg]);
    } catch (e) {
      snack(errorMessage(e), "error");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={!!friend} onClose={onClose} width={560}>
      {friend && (
        <div className="flex h-[min(620px,80vh)] flex-col">
          {/* intestazione */}
          <div className="flex items-center gap-3 border-b border-outline-variant/30 px-5 py-4">
            <Avatar account={{ uuid: friend.uuid, kind: "microsoft", username: friend.name, expiresAt: 0, active: false }} size={40} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{friend.name}</p>
              <p className="truncate text-xs text-on-surface-variant">{friend.online ? friend.detail || "Online" : "Offline"}</p>
            </div>
            <IconButton icon="close" label="Chiudi la chat" onClick={onClose} />
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
                Nessun messaggio. Scrivi a {friend.name} per organizzare la prossima partita.
              </p>
            )}
            {messages.map((m, i) => {
              const mine = m.to === friend.uuid;
              const prev = messages[i - 1];
              const newDay = !prev || new Date(prev.created).toDateString() !== new Date(m.created).toDateString();
              return (
                <div key={m.id} className="flex flex-col">
                  {newDay && <p className="my-2 text-center text-xs font-medium text-on-surface-variant">{day(m.created)}</p>}
                  <div
                    className={cn(
                      "max-w-[78%] animate-enter rounded-3xl px-4 py-2 text-sm whitespace-pre-wrap break-words",
                      mine
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
                    send();
                  }
                }}
                placeholder={`Scrivi a ${friend.name}…`}
                className="max-h-32 flex-1 resize-none bg-transparent py-2 text-sm outline-none field-sizing-content"
              />
              <IconButton icon="send" label="Invia" variant="filled" selected={!!text.trim()} disabled={!text.trim() || sending} onClick={send} />
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
