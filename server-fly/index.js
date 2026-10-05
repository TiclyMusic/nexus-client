// Nexus Social — server amici & presenza (versione Node per Fly.io).
// Stessa logica del Worker Cloudflare, ma su un host che Mojang non blocca.
// Storage: SQLite locale (better-sqlite3) su volume persistente.

import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";

const __dir = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8080;
const DB_PATH = process.env.DB_PATH || "/data/nexus.db";
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) throw new Error("SESSION_SECRET non configurato: impostalo con `fly secrets set SESSION_SECRET=...`");
const ONLINE_WINDOW = 70;
const SESSION_TTL = 60 * 60 * 24 * 30; // 30 giorni

// --- DB ---
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.exec(readFileSync(join(__dir, "schema.sql"), "utf8"));

const now = () => Math.floor(Date.now() / 1000);

// --- Token di sessione firmati (HMAC-SHA256), identici al Worker ---
const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlToBytes = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

async function hmacKey() {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}
async function signSession(payload) {
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(), new TextEncoder().encode(body));
  return `${body}.${b64url(sig)}`;
}
async function verifySession(token) {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(), b64urlToBytes(sig), new TextEncoder().encode(body));
  if (!ok) return null;
  try {
    const payload = JSON.parse(Buffer.from(b64urlToBytes(body)).toString("utf8"));
    return payload.exp && payload.exp >= now() ? payload : null;
  } catch {
    return null;
  }
}

// --- Helpers HTTP ---
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "authorization, content-type" };
const send = (res, status, data) => {
  res.writeHead(status, { "content-type": "application/json", ...CORS });
  res.end(JSON.stringify(data));
};
const readJson = (req) =>
  new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
const bearer = (req) => {
  const h = req.headers["authorization"] || "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
};

// --- Query DB ---
function relationOf(me, other) {
  if (me === other) return "self";
  if (db.prepare(`SELECT 1 FROM friends WHERE uuid=? AND friend_uuid=?`).get(me, other)) return "friend";
  if (db.prepare(`SELECT 1 FROM requests WHERE from_uuid=? AND to_uuid=?`).get(me, other)) return "outgoing";
  if (db.prepare(`SELECT 1 FROM requests WHERE from_uuid=? AND to_uuid=?`).get(other, me)) return "incoming";
  return "none";
}
function befriend(a, b) {
  const t = now();
  const tx = db.transaction(() => {
    db.prepare(`INSERT OR IGNORE INTO friends (uuid, friend_uuid, favorite, since) VALUES (?, ?, 0, ?)`).run(a, b, t);
    db.prepare(`INSERT OR IGNORE INTO friends (uuid, friend_uuid, favorite, since) VALUES (?, ?, 0, ?)`).run(b, a, t);
    db.prepare(`DELETE FROM requests WHERE (from_uuid=? AND to_uuid=?) OR (from_uuid=? AND to_uuid=?)`).run(a, b, b, a);
  });
  tx();
}

// --- Rotte ---
async function handleAuth(req, res) {
  const { uuid: claimedUuid, name: claimedName, serverId } = await readJson(req);
  if (!claimedUuid || !claimedName || !serverId) return send(res, 400, { error: "Dati di verifica mancanti" });
  let mj;
  try {
    mj = await fetch(
      `https://sessionserver.mojang.com/session/minecraft/hasJoined?username=${encodeURIComponent(claimedName)}&serverId=${encodeURIComponent(serverId)}`,
    );
  } catch (e) {
    return send(res, 502, { error: `Impossibile contattare Minecraft: ${e.message}` });
  }
  if (mj.status !== 200) return send(res, 401, { error: `Verifica identità fallita (HTTP ${mj.status}). Riprova ad accedere.` });
  const verified = await mj.json().catch(() => ({}));
  const uuid = (verified.id || "").toLowerCase();
  const name = verified.name || claimedName;
  if (!uuid || uuid !== String(claimedUuid).toLowerCase()) return send(res, 401, { error: "Identità non corrispondente" });

  db.prepare(
    `INSERT INTO users (uuid, name, name_lower, last_seen) VALUES (?, ?, ?, ?)
     ON CONFLICT(uuid) DO UPDATE SET name=excluded.name, name_lower=excluded.name_lower`,
  ).run(uuid, name, name.toLowerCase(), now());

  const token = await signSession({ uuid, name, exp: now() + SESSION_TTL });
  return send(res, 200, { token, uuid, name });
}

async function handleSearch(req, res, me, url) {
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  if (q.length < 2) return send(res, 200, { results: [] });
  const rows = db.prepare(`SELECT uuid, name FROM users WHERE name_lower LIKE ? ORDER BY name_lower LIMIT 20`).all(`${q}%`);
  return send(res, 200, { results: rows.map((r) => ({ uuid: r.uuid, name: r.name, relation: relationOf(me, r.uuid) })) });
}

async function handleRequest(req, res, me) {
  const { uuid, name } = await readJson(req);
  if (!uuid || uuid === me) return send(res, 400, { error: "Destinatario non valido" });
  if (!db.prepare(`SELECT 1 FROM users WHERE uuid=?`).get(uuid)) {
    const safe = String(name || "Giocatore").slice(0, 32);
    db.prepare(`INSERT OR IGNORE INTO users (uuid, name, name_lower, last_seen) VALUES (?, ?, ?, 0)`).run(uuid, safe, safe.toLowerCase());
  }
  if (db.prepare(`SELECT 1 FROM friends WHERE uuid=? AND friend_uuid=?`).get(me, uuid)) return send(res, 200, { status: "friend" });
  if (db.prepare(`SELECT 1 FROM requests WHERE from_uuid=? AND to_uuid=?`).get(uuid, me)) {
    befriend(me, uuid);
    return send(res, 200, { status: "accepted" });
  }
  db.prepare(`INSERT OR IGNORE INTO requests (from_uuid, to_uuid, created) VALUES (?, ?, ?)`).run(me, uuid, now());
  return send(res, 200, { status: "sent" });
}

async function handleRespond(req, res, me) {
  const { uuid, accept } = await readJson(req);
  if (!db.prepare(`SELECT 1 FROM requests WHERE from_uuid=? AND to_uuid=?`).get(uuid, me)) return send(res, 404, { error: "Richiesta non trovata" });
  if (accept) {
    befriend(me, uuid);
    return send(res, 200, { status: "accepted" });
  }
  db.prepare(`DELETE FROM requests WHERE from_uuid=? AND to_uuid=?`).run(uuid, me);
  return send(res, 200, { status: "declined" });
}

async function handleRemove(req, res, me) {
  const { uuid } = await readJson(req);
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM friends WHERE (uuid=? AND friend_uuid=?) OR (uuid=? AND friend_uuid=?)`).run(me, uuid, uuid, me);
    db.prepare(`DELETE FROM requests WHERE (from_uuid=? AND to_uuid=?) OR (from_uuid=? AND to_uuid=?)`).run(me, uuid, uuid, me);
  });
  tx();
  return send(res, 200, { status: "removed" });
}

async function handleFavorite(req, res, me) {
  const { uuid, favorite } = await readJson(req);
  db.prepare(`UPDATE friends SET favorite=? WHERE uuid=? AND friend_uuid=?`).run(favorite ? 1 : 0, me, uuid);
  return send(res, 200, { status: "ok" });
}

async function handlePresence(req, res, me) {
  const b = await readJson(req);
  db.prepare(`UPDATE users SET last_seen=?, presence=?, detail=?, join_address=? WHERE uuid=?`).run(
    now(),
    String(b.status || "online").slice(0, 20),
    String(b.detail || "").slice(0, 120),
    String(b.joinAddress || "").slice(0, 120),
    me,
  );
  return send(res, 200, { status: "ok" });
}

function handleFriends(res, me) {
  const t = now();
  const friends = db
    .prepare(
      `SELECT u.uuid, u.name, f.favorite, u.last_seen, u.presence, u.detail, u.join_address
       FROM friends f JOIN users u ON u.uuid=f.friend_uuid WHERE f.uuid=? ORDER BY f.favorite DESC, u.name_lower`,
    )
    .all(me)
    .map((r) => {
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
  const incoming = db.prepare(`SELECT u.uuid, u.name FROM requests r JOIN users u ON u.uuid=r.from_uuid WHERE r.to_uuid=? ORDER BY r.created DESC`).all(me);
  const outgoing = db.prepare(`SELECT u.uuid, u.name FROM requests r JOIN users u ON u.uuid=r.to_uuid WHERE r.from_uuid=? ORDER BY r.created DESC`).all(me);
  return send(res, 200, { friends, incoming, outgoing });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS);
      return res.end();
    }
    const url = new URL(req.url, "http://x");
    const path = url.pathname;
    if (path === "/" || path === "/health") return send(res, 200, { ok: true, service: "nexus-social" });
    if (path === "/auth" && req.method === "POST") return handleAuth(req, res);

    const user = await verifySession(bearer(req));
    if (!user) return send(res, 401, { error: "Sessione non valida, riautenticati" });
    const me = user.uuid;

    if (path === "/friends" && req.method === "GET") return handleFriends(res, me);
    if (path === "/search" && req.method === "GET") return handleSearch(req, res, me, url);
    if (path === "/request" && req.method === "POST") return handleRequest(req, res, me);
    if (path === "/respond" && req.method === "POST") return handleRespond(req, res, me);
    if (path === "/remove" && req.method === "POST") return handleRemove(req, res, me);
    if (path === "/favorite" && req.method === "POST") return handleFavorite(req, res, me);
    if (path === "/presence" && req.method === "POST") return handlePresence(req, res, me);
    return send(res, 404, { error: "Not found" });
  } catch (e) {
    return send(res, 500, { error: `Server error: ${e.message}` });
  }
});

server.listen(PORT, () => console.log(`nexus-social in ascolto su :${PORT}`));
