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
    resp = await fetch(
      `https://sessionserver.mojang.com/session/minecraft/hasJoined?username=${encodeURIComponent(claimedName)}&serverId=${encodeURIComponent(serverId)}`,
    );
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

// POST /presence { status, detail, joinAddress }
async function handlePresence(req, env, me) {
  const body = await req.json().catch(() => ({}));
  await env.DB.prepare(`UPDATE users SET last_seen = ?, presence = ?, detail = ?, join_address = ? WHERE uuid = ?`)
    .bind(now(), String(body.status || "online").slice(0, 20), String(body.detail || "").slice(0, 120), String(body.joinAddress || "").slice(0, 120), me)
    .run();
  return json({ status: "ok" });
}

// GET /friends
async function handleFriends(env, me) {
  const t = now();
  const friendRows = await env.DB.prepare(
    `SELECT u.uuid, u.name, f.favorite, u.last_seen, u.presence, u.detail, u.join_address
     FROM friends f JOIN users u ON u.uuid = f.friend_uuid
     WHERE f.uuid = ? ORDER BY f.favorite DESC, u.name_lower`,
  )
    .bind(me)
    .all();
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
  async fetch(req, env) {
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

      return json({ error: "Not found" }, 404);
    } catch (e) {
      return json({ error: `Server error: ${e.message}` }, 500);
    }
  },
};
