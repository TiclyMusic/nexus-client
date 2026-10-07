-- Schema del database Nexus Social (Cloudflare D1 / SQLite)

CREATE TABLE IF NOT EXISTS users (
  uuid         TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  name_lower   TEXT NOT NULL,
  last_seen    INTEGER DEFAULT 0,
  presence     TEXT DEFAULT '',   -- online | playing | hosting
  detail       TEXT DEFAULT '',   -- es. "Survival Performance · 1.21 Fabric"
  join_address TEXT DEFAULT '',   -- indirizzo per unirsi se sta hostando o è su un server
  mc_version   TEXT DEFAULT ''    -- versione di Minecraft in uso
);
CREATE INDEX IF NOT EXISTS idx_users_name ON users(name_lower);

CREATE TABLE IF NOT EXISTS requests (
  from_uuid TEXT NOT NULL,
  to_uuid   TEXT NOT NULL,
  created   INTEGER NOT NULL,
  PRIMARY KEY (from_uuid, to_uuid)
);
CREATE INDEX IF NOT EXISTS idx_requests_to ON requests(to_uuid);

CREATE TABLE IF NOT EXISTS friends (
  uuid        TEXT NOT NULL,
  friend_uuid TEXT NOT NULL,
  favorite    INTEGER DEFAULT 0,
  since       INTEGER NOT NULL,
  PRIMARY KEY (uuid, friend_uuid)
);

-- Chat tra amici. created in millisecondi; read_at = 0 finché il destinatario non apre la chat.
CREATE TABLE IF NOT EXISTS messages (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  from_uuid TEXT NOT NULL,
  to_uuid   TEXT NOT NULL,
  body      TEXT NOT NULL,
  created   INTEGER NOT NULL,
  read_at   INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages(from_uuid, to_uuid, id);
CREATE INDEX IF NOT EXISTS idx_messages_unread ON messages(to_uuid, read_at);

-- Gruppi di amici con chat di gruppo. Chi crea il gruppo ne è il proprietario.
CREATE TABLE IF NOT EXISTS groups (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  name    TEXT NOT NULL,
  owner   TEXT NOT NULL,
  created INTEGER NOT NULL
);

-- last_read = id dell'ultimo messaggio del gruppo letto dal membro.
CREATE TABLE IF NOT EXISTS group_members (
  group_id  INTEGER NOT NULL,
  uuid      TEXT NOT NULL,
  joined    INTEGER NOT NULL,
  last_read INTEGER DEFAULT 0,
  PRIMARY KEY (group_id, uuid)
);
CREATE INDEX IF NOT EXISTS idx_group_members_uuid ON group_members(uuid);

CREATE TABLE IF NOT EXISTS group_messages (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id  INTEGER NOT NULL,
  from_uuid TEXT NOT NULL,
  body      TEXT NOT NULL,
  created   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_group_messages_group ON group_messages(group_id, id);

-- Richieste "fammi entrare nel tuo mondo" (consegnate dall'/inbox, valide pochi minuti).
CREATE TABLE IF NOT EXISTS join_requests (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  from_uuid TEXT NOT NULL,
  to_uuid   TEXT NOT NULL,
  created   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_join_requests_to ON join_requests(to_uuid, id);
