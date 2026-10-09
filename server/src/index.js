// Nexus Social — backend amici & presenza per Nexus Launcher.
// Cloudflare Worker + D1 (SQLite). Piano gratuito, nessuna carta richiesta.
//
// Identità: il launcher invia il proprio token Minecraft; il server lo verifica chiamando
// l'API ufficiale Mojang (api.minecraftservices.com) e ricava UUID+nome reali. In cambio
// rilascia un token di sessione firmato (HMAC) che il launcher usa per le chiamate successive.

const ONLINE_WINDOW = 70; // secondi senza heartbeat oltre i quali un amico è considerato offline
// Il launcher si ri-autentica automaticamente a ogni avvio (e quando il token manca/scade),
// quindi finché il giocatore apre il launcher la sessione resta valida. 30 giorni = si disattiva
// solo dopo 30 giorni che non apre più il launcher.
const SESSION_TTL = 60 * 60 * 24 * 30; // 30 giorni (sliding: rinnovato a ogni uso)

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });

const now = () => Math.floor(Date.now() / 1000);

// ---------------------------------------------------------------------------
// Token di sessione firmati (HMAC-SHA256, formato compatto payload.signature)
// ---------------------------------------------------------------------------

const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const b64urlToBytes = (s) => {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

async function signSession(secret, payload) {
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return `${body}.${b64url(sig)}`;
}

async function verifySession(secret, token) {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const key = await hmacKey(secret);
  const ok = await crypto.subtle.verify("HMAC", key, b64urlToBytes(sig), new TextEncoder().encode(body));
  if (!ok) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(body)));
    if (!payload.exp || payload.exp < now()) return null;
    return payload; // { uuid, name, exp }
  } catch {
    return null;
  }
}

function bearer(req) {
  const h = req.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}

// Nessuna chiave di riserva: senza SESSION_SECRET (wrangler secret put) chiunque potrebbe
// firmare sessioni valide, quindi il server si rifiuta di funzionare.
function sessionSecret(env) {
  if (!env.SESSION_SECRET) throw new Error("SESSION_SECRET non configurato sul server");
  return env.SESSION_SECRET;
}

async function requireUser(req, env) {
  return verifySession(sessionSecret(env), bearer(req));
}

// ---------------------------------------------------------------------------
// Rotte
// ---------------------------------------------------------------------------

// POST /auth { uuid, name, serverId } — verifica l'identità col protocollo dei server Minecraft
// (hasJoined) e rilascia un token di sessione. Il client ha già fatto il "join" col suo token.
async function handleAuth(req, env) {
  const { uuid: claimedUuid, name: claimedName, serverId } = await req.json().catch(() => ({}));
  if (!claimedUuid || !claimedName || !serverId) {
    return json({ error: "Dati di verifica mancanti" }, 400);
  }

  let resp;
  try {
    // Mojang risponde 403 alle richieste dirette da Cloudflare Workers: passiamo da un proxy
    // (funzione Netlify site/netlify/functions/has-joined.mjs) che restituisce la risposta originale.
    const base = env.HASJOINED_URL || "https://sessionserver.mojang.com/session/minecraft/hasJoined";
    resp = await fetch(`${base}?username=${encodeURIComponent(claimedName)}&serverId=${encodeURIComponent(serverId)}`);
  } catch (e) {
    return json({ error: `Il server non è riuscito a contattare Minecraft: ${e.message}` }, 502);
  }
  // hasJoined risponde 200 con {id,name} se il join è valido, altrimenti 204/senza corpo.
  if (resp.status !== 200) {
    return json({ error: `Verifica identità fallita (HTTP ${resp.status}). Riprova ad accedere.` }, 401);
  }
  const verified = await resp.json().catch(() => ({}));
  const uuid = (verified.id || "").toLowerCase();
  const name = verified.name || claimedName;
  if (!uuid || uuid !== String(claimedUuid).toLowerCase()) {
    return json({ error: "Identità non corrispondente" }, 401);
  }

  await env.DB.prepare(
    `INSERT INTO users (uuid, name, name_lower, last_seen) VALUES (?, ?, ?, ?)
     ON CONFLICT(uuid) DO UPDATE SET name = excluded.name, name_lower = excluded.name_lower, last_seen = excluded.last_seen`,
  )
    .bind(uuid, name, name.toLowerCase(), now())
    .run();

  const token = await signSession(sessionSecret(env), { uuid, name, exp: now() + SESSION_TTL });
  return json({ token, uuid, name });
}

async function relationOf(env, me, other) {
  if (me === other) return "self";
  const f = await env.DB.prepare(`SELECT 1 FROM friends WHERE uuid = ? AND friend_uuid = ?`).bind(me, other).first();
  if (f) return "friend";
  const out = await env.DB.prepare(`SELECT 1 FROM requests WHERE from_uuid = ? AND to_uuid = ?`).bind(me, other).first();
  if (out) return "outgoing";
  const inc = await env.DB.prepare(`SELECT 1 FROM requests WHERE from_uuid = ? AND to_uuid = ?`).bind(other, me).first();
  if (inc) return "incoming";
  return "none";
}

// Un utente è "registrato" se ha fatto login su Nexus almeno una volta. I segnaposto creati
// da una richiesta di amicizia verso chi non ha ancora Nexus hanno last_seen = 0.
const isRegistered = (r) => (r.last_seen || 0) > 0;

// GET /search?q=
async function handleSearch(req, env, me) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  if (q.length < 2) return json({ results: [] });
  const rows = await env.DB.prepare(`SELECT uuid, name, last_seen FROM users WHERE name_lower LIKE ? ORDER BY name_lower LIMIT 20`)
    .bind(`${q}%`)
    .all();
  const results = [];
  for (const r of rows.results || []) {
    results.push({ uuid: r.uuid, name: r.name, registered: isRegistered(r), relation: await relationOf(env, me, r.uuid) });
  }
  return json({ results });
}

// POST /request { uuid, name }
async function handleRequest(req, env, me) {
  const { uuid, name } = await req.json();
  if (!uuid || uuid === me) return json({ error: "Destinatario non valido" }, 400);
  // Se il destinatario non ha ancora usato Nexus, creiamo un segnaposto con il nome fornito:
  // la richiesta resta in attesa e comparirà quando entrerà per la prima volta.
  const target = await env.DB.prepare(`SELECT uuid FROM users WHERE uuid = ?`).bind(uuid).first();
  if (!target) {
    const safe = String(name || "Giocatore").slice(0, 32);
    await env.DB.prepare(`INSERT OR IGNORE INTO users (uuid, name, name_lower, last_seen) VALUES (?, ?, ?, 0)`)
      .bind(uuid, safe, safe.toLowerCase())
      .run();
  }

  // già amici?
  const already = await env.DB.prepare(`SELECT 1 FROM friends WHERE uuid = ? AND friend_uuid = ?`).bind(me, uuid).first();
  if (already) return json({ status: "friend" });

  // esiste una richiesta inversa? allora si diventa amici subito
  const reverse = await env.DB.prepare(`SELECT 1 FROM requests WHERE from_uuid = ? AND to_uuid = ?`).bind(uuid, me).first();
  if (reverse) {
    await befriend(env, me, uuid);
    return json({ status: "accepted" });
  }

  await env.DB.prepare(`INSERT OR IGNORE INTO requests (from_uuid, to_uuid, created) VALUES (?, ?, ?)`)
    .bind(me, uuid, now())
    .run();
  return json({ status: "sent" });
}

async function befriend(env, a, b) {
  const t = now();
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO friends (uuid, friend_uuid, favorite, since) VALUES (?, ?, 0, ?)`).bind(a, b, t),
    env.DB.prepare(`INSERT OR IGNORE INTO friends (uuid, friend_uuid, favorite, since) VALUES (?, ?, 0, ?)`).bind(b, a, t),
    env.DB.prepare(`DELETE FROM requests WHERE (from_uuid = ? AND to_uuid = ?) OR (from_uuid = ? AND to_uuid = ?)`).bind(a, b, b, a),
  ]);
}

// POST /respond { uuid, accept }  (uuid = chi ha inviato la richiesta)
async function handleRespond(req, env, me) {
  const { uuid, accept } = await req.json();
  const pending = await env.DB.prepare(`SELECT 1 FROM requests WHERE from_uuid = ? AND to_uuid = ?`).bind(uuid, me).first();
  if (!pending) return json({ error: "Richiesta non trovata" }, 404);
  if (accept) {
    await befriend(env, me, uuid);
    return json({ status: "accepted" });
  }
  await env.DB.prepare(`DELETE FROM requests WHERE from_uuid = ? AND to_uuid = ?`).bind(uuid, me).run();
  return json({ status: "declined" });
}

// POST /remove { uuid }
async function handleRemove(req, env, me) {
  const { uuid } = await req.json();
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM friends WHERE (uuid = ? AND friend_uuid = ?) OR (uuid = ? AND friend_uuid = ?)`).bind(me, uuid, uuid, me),
    env.DB.prepare(`DELETE FROM requests WHERE (from_uuid = ? AND to_uuid = ?) OR (from_uuid = ? AND to_uuid = ?)`).bind(me, uuid, uuid, me),
    env.DB.prepare(`DELETE FROM messages WHERE (from_uuid = ? AND to_uuid = ?) OR (from_uuid = ? AND to_uuid = ?)`).bind(me, uuid, uuid, me),
  ]);
  return json({ status: "removed" });
}

// POST /favorite { uuid, favorite }
async function handleFavorite(req, env, me) {
  const { uuid, favorite } = await req.json();
  await env.DB.prepare(`UPDATE friends SET favorite = ? WHERE uuid = ? AND friend_uuid = ?`)
    .bind(favorite ? 1 : 0, me, uuid)
    .run();
  return json({ status: "ok" });
}

// POST /presence { status, detail, joinAddress, joinDirect, mcVersion }
async function handlePresence(req, env, me) {
  const body = await req.json().catch(() => ({}));
  await env.DB.prepare(`UPDATE users SET last_seen = ?, presence = ?, detail = ?, join_address = ?, join_direct = ?, mc_version = ? WHERE uuid = ?`)
    .bind(
      now(),
      String(body.status || "online").slice(0, 20),
      String(body.detail || "").slice(0, 120),
      String(body.joinAddress || "").slice(0, 120),
      String(body.joinDirect || "").slice(0, 200),
      String(body.mcVersion || "").slice(0, 32),
      me,
    )
    .run();
  // Totale dei messaggi non letti: il launcher lo mostra come badge senza richieste in più.
  return json({ status: "ok", unread: await unreadTotal(env, me) });
}

// ---------------------------------------------------------------------------
// Chat tra amici
// ---------------------------------------------------------------------------

const MESSAGE_MAX = 1000; // caratteri
const MESSAGES_PER_MINUTE = 30; // limite anti-spam per utente
const MESSAGE_RETENTION = 60 * 60 * 24 * 90; // i messaggi più vecchi di 90 giorni vengono cancellati

async function areFriends(env, a, b) {
  return !!(await env.DB.prepare(`SELECT 1 FROM friends WHERE uuid = ? AND friend_uuid = ?`).bind(a, b).first());
}

const toMessage = (r) => ({ id: r.id, from: r.from_uuid, to: r.to_uuid, text: r.body, created: r.created });

// GET /messages?with=<uuid>&after=<id> — ultimi 50 messaggi (o i nuovi dopo `after`); segna come letti quelli ricevuti.
async function handleGetMessages(req, env, me) {
  const url = new URL(req.url);
  const other = (url.searchParams.get("with") || "").toLowerCase();
  const after = Math.max(0, parseInt(url.searchParams.get("after") || "0", 10) || 0);
  if (!other || !(await areFriends(env, me, other))) return json({ error: "Puoi scrivere solo ai tuoi amici" }, 403);

  const pair = `((from_uuid = ?1 AND to_uuid = ?2) OR (from_uuid = ?2 AND to_uuid = ?1))`;
  const rows = after
    ? await env.DB.prepare(`SELECT * FROM messages WHERE ${pair} AND id > ?3 ORDER BY id ASC LIMIT 100`).bind(me, other, after).all()
    : await env.DB.prepare(`SELECT * FROM (SELECT * FROM messages WHERE ${pair} ORDER BY id DESC LIMIT 50) ORDER BY id ASC`).bind(me, other).all();
  await env.DB.prepare(`UPDATE messages SET read_at = ? WHERE to_uuid = ? AND from_uuid = ? AND read_at = 0`).bind(now(), me, other).run();
  return json({ messages: (rows.results || []).map(toMessage) });
}

// POST /messages { to, text }
async function handleSendMessage(req, env, me) {
  const { to, text } = await req.json().catch(() => ({}));
  const other = String(to || "").toLowerCase();
  const body = String(text || "").replace(/\r\n?/g, "\n").trim();
  if (!body) return json({ error: "Messaggio vuoto" }, 400);
  if (body.length > MESSAGE_MAX) return json({ error: `Messaggio troppo lungo (massimo ${MESSAGE_MAX} caratteri)` }, 400);
  if (!other || !(await areFriends(env, me, other))) return json({ error: "Puoi scrivere solo ai tuoi amici" }, 403);

  const recent = await env.DB.prepare(`SELECT COUNT(*) AS n FROM messages WHERE from_uuid = ? AND created > ?`)
    .bind(me, Date.now() - 60_000)
    .first();
  if ((recent?.n || 0) >= MESSAGES_PER_MINUTE) return json({ error: "Stai scrivendo troppo in fretta, aspetta un attimo" }, 429);

  const created = Date.now();
  const res = await env.DB.prepare(`INSERT INTO messages (from_uuid, to_uuid, body, created) VALUES (?, ?, ?, ?)`)
    .bind(me, other, body, created)
    .run();
  // pulizia occasionale dei messaggi vecchi (circa una volta ogni 50 invii)
  if (Math.random() < 0.02) {
    await env.DB.prepare(`DELETE FROM messages WHERE created < ?`).bind((now() - MESSAGE_RETENTION) * 1000).run();
  }
  return json({ message: { id: res.meta.last_row_id, from: me, to: other, text: body, created } });
}

// ---------------------------------------------------------------------------
// Gruppi (chat di gruppo tra amici)
// ---------------------------------------------------------------------------

const GROUP_NAME_MAX = 40;
const GROUP_MAX_MEMBERS = 25;

const groupName = (v) => String(v || "").replace(/\s+/g, " ").trim().slice(0, GROUP_NAME_MAX);
const uuidList = (v) => [...new Set((Array.isArray(v) ? v : []).map((u) => String(u || "").toLowerCase()).filter(Boolean))];

async function isMember(env, groupId, uuid) {
  return !!(await env.DB.prepare(`SELECT 1 FROM group_members WHERE group_id = ? AND uuid = ?`).bind(groupId, uuid).first());
}

/** Tiene solo gli uuid che sono amici di `me` (si possono aggiungere solo i propri amici). */
async function onlyFriends(env, me, uuids) {
  if (!uuids.length) return [];
  const rows = await env.DB.prepare(
    `SELECT friend_uuid FROM friends WHERE uuid = ? AND friend_uuid IN (${uuids.map(() => "?").join(",")})`,
  )
    .bind(me, ...uuids)
    .all();
  return (rows.results || []).map((r) => r.friend_uuid);
}

// Messaggi non letti di `me` in tutti i suoi gruppi, per gruppo.
async function groupUnread(env, me) {
  const rows = await env.DB.prepare(
    `SELECT gm.group_id, COUNT(*) AS n FROM group_messages gm
     JOIN group_members m ON m.group_id = gm.group_id AND m.uuid = ?1
     WHERE gm.id > m.last_read AND gm.from_uuid != ?1 GROUP BY gm.group_id`,
  )
    .bind(me)
    .all();
  return Object.fromEntries((rows.results || []).map((r) => [r.group_id, r.n]));
}

async function unreadTotal(env, me) {
  const d = await env.DB.prepare(`SELECT COUNT(*) AS n FROM messages WHERE to_uuid = ? AND read_at = 0`).bind(me).first();
  const g = Object.values(await groupUnread(env, me)).reduce((a, b) => a + b, 0);
  return (d?.n || 0) + g;
}

// GET /groups — i miei gruppi con membri (e se sono online) e non letti.
async function handleGroups(env, me) {
  const t = now();
  const groups = await env.DB.prepare(
    `SELECT g.id, g.name, g.owner FROM groups g JOIN group_members m ON m.group_id = g.id
     WHERE m.uuid = ? ORDER BY g.name COLLATE NOCASE`,
  )
    .bind(me)
    .all();
  const list = groups.results || [];
  if (!list.length) return json({ groups: [] });
  const ids = list.map((g) => g.id);
  const members = await env.DB.prepare(
    `SELECT m.group_id, u.uuid, u.name, u.last_seen FROM group_members m JOIN users u ON u.uuid = m.uuid
     WHERE m.group_id IN (${ids.map(() => "?").join(",")}) ORDER BY m.joined`,
  )
    .bind(...ids)
    .all();
  const unread = await groupUnread(env, me);
  const byGroup = {};
  for (const r of members.results || []) {
    (byGroup[r.group_id] ||= []).push({ uuid: r.uuid, name: r.name, online: t - (r.last_seen || 0) < ONLINE_WINDOW });
  }
  return json({
    groups: list.map((g) => ({ id: g.id, name: g.name, owner: g.owner, members: byGroup[g.id] || [], unread: unread[g.id] || 0 })),
  });
}

// POST /groups/create { name, members: [uuid] }
async function handleGroupCreate(req, env, me) {
  const body = await req.json().catch(() => ({}));
  const name = groupName(body.name);
  if (!name) return json({ error: "Dai un nome al gruppo" }, 400);
  const members = (await onlyFriends(env, me, uuidList(body.members))).slice(0, GROUP_MAX_MEMBERS - 1);
  if (!members.length) return json({ error: "Scegli almeno un amico" }, 400);
  const mine = await env.DB.prepare(`SELECT COUNT(*) AS n FROM groups WHERE owner = ?`).bind(me).first();
  if ((mine?.n || 0) >= 30) return json({ error: "Hai raggiunto il numero massimo di gruppi" }, 400);

  const t = now();
  const res = await env.DB.prepare(`INSERT INTO groups (name, owner, created) VALUES (?, ?, ?)`).bind(name, me, t).run();
  const id = res.meta.last_row_id;
  await env.DB.batch(
    [me, ...members].map((u) => env.DB.prepare(`INSERT OR IGNORE INTO group_members (group_id, uuid, joined) VALUES (?, ?, ?)`).bind(id, u, t)),
  );
  return json({ id });
}

// POST /groups/add { id, members: [uuid] } — ogni membro può aggiungere i propri amici.
async function handleGroupAdd(req, env, me) {
  const body = await req.json().catch(() => ({}));
  const id = Number(body.id);
  if (!(await isMember(env, id, me))) return json({ error: "Gruppo non trovato" }, 404);
  const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM group_members WHERE group_id = ?`).bind(id).first();
  const room = GROUP_MAX_MEMBERS - (count?.n || 0);
  const add = (await onlyFriends(env, me, uuidList(body.members))).slice(0, Math.max(0, room));
  if (!add.length) {
    return json({ error: room <= 0 ? `Un gruppo può avere al massimo ${GROUP_MAX_MEMBERS} membri` : "Nessun amico da aggiungere" }, 400);
  }
  const t = now();
  // i nuovi membri partono dall'ultimo messaggio: la cronologia non risulta tutta "non letta"
  const last = await env.DB.prepare(`SELECT MAX(id) AS id FROM group_messages WHERE group_id = ?`).bind(id).first();
  await env.DB.batch(
    add.map((u) =>
      env.DB.prepare(`INSERT OR IGNORE INTO group_members (group_id, uuid, joined, last_read) VALUES (?, ?, ?, ?)`).bind(id, u, t, last?.id || 0),
    ),
  );
  return json({ status: "ok" });
}

// POST /groups/rename { id, name }
async function handleGroupRename(req, env, me) {
  const body = await req.json().catch(() => ({}));
  const id = Number(body.id);
  const name = groupName(body.name);
  if (!name) return json({ error: "Nome non valido" }, 400);
  if (!(await isMember(env, id, me))) return json({ error: "Gruppo non trovato" }, 404);
  await env.DB.prepare(`UPDATE groups SET name = ? WHERE id = ?`).bind(name, id).run();
  return json({ status: "ok" });
}

// POST /groups/kick { id, uuid } — solo il proprietario.
async function handleGroupKick(req, env, me) {
  const body = await req.json().catch(() => ({}));
  const id = Number(body.id);
  const target = String(body.uuid || "").toLowerCase();
  const g = await env.DB.prepare(`SELECT owner FROM groups WHERE id = ?`).bind(id).first();
  if (!g || g.owner !== me) return json({ error: "Solo chi ha creato il gruppo può rimuovere i membri" }, 403);
  if (target === me) return json({ error: "Per uscire usa «Esci dal gruppo»" }, 400);
  await env.DB.prepare(`DELETE FROM group_members WHERE group_id = ? AND uuid = ?`).bind(id, target).run();
  return json({ status: "ok" });
}

// POST /groups/leave { id } — se esce il proprietario il gruppo passa al membro più anziano;
// l'ultimo che esce cancella il gruppo e i suoi messaggi.
async function handleGroupLeave(req, env, me) {
  const body = await req.json().catch(() => ({}));
  const id = Number(body.id);
  if (!(await isMember(env, id, me))) return json({ status: "ok" });
  await env.DB.prepare(`DELETE FROM group_members WHERE group_id = ? AND uuid = ?`).bind(id, me).run();
  const next = await env.DB.prepare(`SELECT uuid FROM group_members WHERE group_id = ? ORDER BY joined LIMIT 1`).bind(id).first();
  if (!next) {
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM group_messages WHERE group_id = ?`).bind(id),
      env.DB.prepare(`DELETE FROM groups WHERE id = ?`).bind(id),
    ]);
  } else {
    await env.DB.prepare(`UPDATE groups SET owner = ? WHERE id = ? AND owner = ?`).bind(next.uuid, id, me).run();
  }
  return json({ status: "ok" });
}

const toGroupMessage = (r) => ({ id: r.id, groupId: r.group_id, from: r.from_uuid, name: r.name || "", text: r.body, created: r.created });

// GET /groups/messages?id=&after= — ultimi 50 (o i nuovi dopo `after`); aggiorna last_read.
async function handleGroupGetMessages(req, env, me) {
  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id"));
  const after = Math.max(0, parseInt(url.searchParams.get("after") || "0", 10) || 0);
  if (!(await isMember(env, id, me))) return json({ error: "Gruppo non trovato" }, 404);
  const select = `SELECT gm.*, u.name FROM group_messages gm LEFT JOIN users u ON u.uuid = gm.from_uuid WHERE gm.group_id = ?1`;
  const rows = after
    ? await env.DB.prepare(`${select} AND gm.id > ?2 ORDER BY gm.id ASC LIMIT 100`).bind(id, after).all()
    : await env.DB.prepare(`SELECT * FROM (${select} ORDER BY gm.id DESC LIMIT 50) ORDER BY id ASC`).bind(id).all();
  const messages = (rows.results || []).map(toGroupMessage);
  const last = messages.length ? messages[messages.length - 1].id : 0;
  if (last) {
    await env.DB.prepare(`UPDATE group_members SET last_read = MAX(last_read, ?) WHERE group_id = ? AND uuid = ?`).bind(last, id, me).run();
  }
  return json({ messages });
}

// POST /groups/messages { id, text }
async function handleGroupSendMessage(req, env, me, myName) {
  const body = await req.json().catch(() => ({}));
  const id = Number(body.id);
  const text = String(body.text || "").replace(/\r\n?/g, "\n").trim();
  if (!text) return json({ error: "Messaggio vuoto" }, 400);
  if (text.length > MESSAGE_MAX) return json({ error: `Messaggio troppo lungo (massimo ${MESSAGE_MAX} caratteri)` }, 400);
  if (!(await isMember(env, id, me))) return json({ error: "Gruppo non trovato" }, 404);
  const recent = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM messages WHERE from_uuid = ?1 AND created > ?2)
          + (SELECT COUNT(*) FROM group_messages WHERE from_uuid = ?1 AND created > ?2) AS n`,
  )
    .bind(me, Date.now() - 60_000)
    .first();
  if ((recent?.n || 0) >= MESSAGES_PER_MINUTE) return json({ error: "Stai scrivendo troppo in fretta, aspetta un attimo" }, 429);

  const created = Date.now();
  const res = await env.DB.prepare(`INSERT INTO group_messages (group_id, from_uuid, body, created) VALUES (?, ?, ?, ?)`)
    .bind(id, me, text, created)
    .run();
  const msgId = res.meta.last_row_id;
  await env.DB.prepare(`UPDATE group_members SET last_read = ? WHERE group_id = ? AND uuid = ?`).bind(msgId, id, me).run();
  if (Math.random() < 0.02) {
    await env.DB.prepare(`DELETE FROM group_messages WHERE created < ?`).bind((now() - MESSAGE_RETENTION) * 1000).run();
  }
  return json({ message: { id: msgId, groupId: id, from: me, name: myName, text, created } });
}

// ---------------------------------------------------------------------------
// Posta in arrivo: nuovi messaggi (privati e di gruppo) per le notifiche del launcher
// ---------------------------------------------------------------------------

// GET /inbox?dm=<id>&gm=<id> — messaggi ricevuti con id maggiore dei cursori. Senza cursori
// restituisce solo i cursori attuali, così all'avvio non si notificano messaggi vecchi.
async function handleInbox(req, env, me) {
  const url = new URL(req.url);
  const dm = parseInt(url.searchParams.get("dm") ?? "-1", 10);
  const gm = parseInt(url.searchParams.get("gm") ?? "-1", 10);
  const jr = parseInt(url.searchParams.get("jr") ?? "0", 10) || 0;
  const max = await env.DB.prepare(
    `SELECT (SELECT COALESCE(MAX(id), 0) FROM messages) AS dm, (SELECT COALESCE(MAX(id), 0) FROM group_messages) AS gm,
            (SELECT COALESCE(MAX(id), 0) FROM join_requests) AS jr`,
  ).first();
  const cursor = { dm: max?.dm || 0, gm: max?.gm || 0, jr: max?.jr || 0 };
  if (!(dm >= 0) || !(gm >= 0)) return json({ cursor, messages: [], unread: await unreadTotal(env, me) });

  const direct = await env.DB.prepare(
    `SELECT m.id, m.from_uuid, m.body, m.created, u.name FROM messages m LEFT JOIN users u ON u.uuid = m.from_uuid
     WHERE m.to_uuid = ? AND m.read_at = 0 AND m.id > ? ORDER BY m.id ASC LIMIT 20`,
  )
    .bind(me, dm)
    .all();
  const group = await env.DB.prepare(
    `SELECT gm.id, gm.group_id, gm.from_uuid, gm.body, gm.created, u.name, g.name AS group_name
     FROM group_messages gm JOIN group_members m ON m.group_id = gm.group_id AND m.uuid = ?1
     JOIN groups g ON g.id = gm.group_id LEFT JOIN users u ON u.uuid = gm.from_uuid
     WHERE gm.id > ?2 AND gm.id > m.last_read AND gm.from_uuid != ?1 ORDER BY gm.id ASC LIMIT 20`,
  )
    .bind(me, gm)
    .all();
  const joins = await env.DB.prepare(
    `SELECT j.id, j.from_uuid, j.created, j.kind, u.name FROM join_requests j LEFT JOIN users u ON u.uuid = j.from_uuid
     WHERE j.to_uuid = ? AND j.id > ? AND j.created > ? ORDER BY j.id ASC LIMIT 10`,
  )
    .bind(me, jr, Date.now() - JOIN_REQUEST_TTL)
    .all();
  const messages = [
    ...(joins.results || []).map((r) => ({ kind: r.kind === "invite" ? "invite" : "join", id: r.id, from: r.from_uuid, name: r.name || "", text: "", created: r.created })),
    ...(direct.results || []).map((r) => ({ kind: "direct", id: r.id, from: r.from_uuid, name: r.name || "", text: r.body, created: r.created })),
    ...(group.results || []).map((r) => ({
      kind: "group",
      id: r.id,
      groupId: r.group_id,
      groupName: r.group_name,
      from: r.from_uuid,
      name: r.name || "",
      text: r.body,
      created: r.created,
    })),
  ].sort((a, b) => a.created - b.created);
  return json({ cursor, messages, unread: await unreadTotal(env, me) });
}

// ---------------------------------------------------------------------------
// Richieste di entrare nel mondo di un amico
// ---------------------------------------------------------------------------

const JOIN_REQUEST_TTL = 5 * 60_000; // ms

// POST /join { to } (kind "join") e POST /invite { to } (kind "invite"): al massimo una
// richiesta dello stesso tipo ogni 30 secondi verso lo stesso amico.
async function handleJoinRequest(req, env, me, kind = "join") {
  const { to } = await req.json().catch(() => ({}));
  const other = String(to || "").toLowerCase();
  if (!other || !(await areFriends(env, me, other))) return json({ error: "Puoi chiedere di entrare solo ai tuoi amici" }, 403);
  const t = Date.now();
  const recent = await env.DB.prepare(`SELECT 1 FROM join_requests WHERE from_uuid = ? AND to_uuid = ? AND kind = ? AND created > ?`)
    .bind(me, other, kind, t - 30_000)
    .first();
  if (!recent) {
    await env.DB.prepare(`INSERT INTO join_requests (from_uuid, to_uuid, created, kind) VALUES (?, ?, ?, ?)`).bind(me, other, t, kind).run();
    if (Math.random() < 0.05) await env.DB.prepare(`DELETE FROM join_requests WHERE created < ?`).bind(t - JOIN_REQUEST_TTL).run();
  }
  return json({ status: "sent" });
}

// ---------------------------------------------------------------------------
// Statistiche pubbliche (solo totali, nessun dato personale) per nexusmc.online
// ---------------------------------------------------------------------------

async function handleStats(req, env, ctx) {
  const cache = caches.default;
  const key = new Request(new URL("/stats", req.url).toString());
  const hit = await cache.match(key);
  if (hit) return hit;

  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS registered, SUM(CASE WHEN last_seen >= ? THEN 1 ELSE 0 END) AS online FROM users WHERE last_seen > 0`,
  )
    .bind(now() - ONLINE_WINDOW)
    .first();
  const res = new Response(JSON.stringify({ registered: row?.registered || 0, online: row?.online || 0, updated: now() }), {
    headers: { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "public, max-age=30" },
  });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

// GET /friends
async function handleFriends(env, me) {
  const t = now();
  const friendRows = await env.DB.prepare(
    `SELECT u.uuid, u.name, f.favorite, u.last_seen, u.presence, u.detail, u.join_address, u.join_direct, u.mc_version
     FROM friends f JOIN users u ON u.uuid = f.friend_uuid
     WHERE f.uuid = ? ORDER BY f.favorite DESC, u.name_lower`,
  )
    .bind(me)
    .all();
  const unreadRows = await env.DB.prepare(
    `SELECT from_uuid, COUNT(*) AS n FROM messages WHERE to_uuid = ? AND read_at = 0 GROUP BY from_uuid`,
  )
    .bind(me)
    .all();
  const unread = Object.fromEntries((unreadRows.results || []).map((r) => [r.from_uuid, r.n]));
  const friends = (friendRows.results || []).map((r) => {
    const online = t - (r.last_seen || 0) < ONLINE_WINDOW;
    return {
      uuid: r.uuid,
      name: r.name,
      favorite: !!r.favorite,
      online,
      status: online ? r.presence || "online" : "offline",
      detail: online ? r.detail || "" : "",
      joinAddress: online ? r.join_address || "" : "",
      joinDirect: online ? r.join_direct || "" : "",
      mcVersion: online ? r.mc_version || "" : "",
      unread: unread[r.uuid] || 0,
    };
  });

  const incRows = await env.DB.prepare(
    `SELECT u.uuid, u.name FROM requests r JOIN users u ON u.uuid = r.from_uuid WHERE r.to_uuid = ? ORDER BY r.created DESC`,
  )
    .bind(me)
    .all();
  const outRows = await env.DB.prepare(
    `SELECT u.uuid, u.name, u.last_seen FROM requests r JOIN users u ON u.uuid = r.to_uuid WHERE r.from_uuid = ? ORDER BY r.created DESC`,
  )
    .bind(me)
    .all();

  return json({
    friends,
    incoming: incRows.results || [],
    outgoing: (outRows.results || []).map((r) => ({ uuid: r.uuid, name: r.name, registered: isRegistered(r) })),
  });
}

export default {
  async fetch(req, env, ctx) {
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "authorization, content-type",
        },
      });
    }
    const url = new URL(req.url);
    const path = url.pathname;
    try {
      if (path === "/" ) return json({ ok: true, service: "nexus-social" });
      if (path === "/auth" && req.method === "POST") return await handleAuth(req, env);
      if (path === "/stats" && req.method === "GET") return await handleStats(req, env, ctx);

      const user = await requireUser(req, env);
      if (!user) return json({ error: "Sessione non valida, riautenticati" }, 401);
      const me = user.uuid;

      if (path === "/friends" && req.method === "GET") return await handleFriends(env, me);
      if (path === "/search" && req.method === "GET") return await handleSearch(req, env, me);
      if (path === "/request" && req.method === "POST") return await handleRequest(req, env, me);
      if (path === "/respond" && req.method === "POST") return await handleRespond(req, env, me);
      if (path === "/remove" && req.method === "POST") return await handleRemove(req, env, me);
      if (path === "/favorite" && req.method === "POST") return await handleFavorite(req, env, me);
      if (path === "/presence" && req.method === "POST") return await handlePresence(req, env, me);
      if (path === "/messages" && req.method === "GET") return await handleGetMessages(req, env, me);
      if (path === "/messages" && req.method === "POST") return await handleSendMessage(req, env, me);
      if (path === "/join" && req.method === "POST") return await handleJoinRequest(req, env, me);
      if (path === "/invite" && req.method === "POST") return await handleJoinRequest(req, env, me, "invite");
      if (path === "/inbox" && req.method === "GET") return await handleInbox(req, env, me);
      if (path === "/groups" && req.method === "GET") return await handleGroups(env, me);
      if (path === "/groups/create" && req.method === "POST") return await handleGroupCreate(req, env, me);
      if (path === "/groups/add" && req.method === "POST") return await handleGroupAdd(req, env, me);
      if (path === "/groups/rename" && req.method === "POST") return await handleGroupRename(req, env, me);
      if (path === "/groups/kick" && req.method === "POST") return await handleGroupKick(req, env, me);
      if (path === "/groups/leave" && req.method === "POST") return await handleGroupLeave(req, env, me);
      if (path === "/groups/messages" && req.method === "GET") return await handleGroupGetMessages(req, env, me);
      if (path === "/groups/messages" && req.method === "POST") return await handleGroupSendMessage(req, env, me, user.name);

      return json({ error: "Not found" }, 404);
    } catch (e) {
      return json({ error: `Server error: ${e.message}` }, 500);
    }
  },
};
