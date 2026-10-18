CREATE TABLE users (
 id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
 password_hash TEXT NOT NULL, totp_secret TEXT NOT NULL, totp_counter INTEGER NOT NULL DEFAULT -1,
 role TEXT NOT NULL CHECK(role IN ('admin','user')),
 status TEXT NOT NULL CHECK(status IN ('pending','active','disabled'))
) STRICT;
CREATE TABLE security_state (
 id INTEGER PRIMARY KEY CHECK(id=1), status TEXT NOT NULL CHECK(status IN ('new','pending','ready')),
 setup_hash TEXT, setup_expires INTEGER, enrollment_hash TEXT, enrollment_expires INTEGER, pending_user TEXT REFERENCES users(id)
) STRICT;
INSERT INTO security_state(id,status) VALUES(1,'new');
CREATE TABLE sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created INTEGER NOT NULL, last_seen INTEGER NOT NULL, expires INTEGER NOT NULL, step_up INTEGER NOT NULL,
 method TEXT NOT NULL
) STRICT;
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE recovery_codes (
 hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
) STRICT;
CREATE TABLE auth_rate (
 key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, attempts INTEGER NOT NULL
) STRICT;
CREATE TABLE audit_events (
 id INTEGER PRIMARY KEY, at INTEGER NOT NULL, action TEXT NOT NULL, actor TEXT, target TEXT, outcome TEXT NOT NULL
) STRICT;
CREATE TABLE applications (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, capabilities TEXT NOT NULL CHECK(json_valid(capabilities)),
 networks TEXT NOT NULL CHECK(json_valid(networks)), scopes TEXT NOT NULL CHECK(json_valid(scopes)),
 key_hash TEXT UNIQUE, expires INTEGER, enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1))
) STRICT;
CREATE TABLE passkeys (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 public_key BLOB NOT NULL, counter INTEGER NOT NULL, transports TEXT NOT NULL CHECK(json_valid(transports))
) STRICT;
CREATE TABLE auth_challenges (
 id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL,
 challenge TEXT NOT NULL, expires INTEGER NOT NULL, session_hash TEXT
) STRICT;
