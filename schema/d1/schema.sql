-- NCD D1 schema
-- This file defines the primary tables used across the NCD platform.
-- It can be executed with `wrangler d1 execute <DB> --file schema/d1/schema.sql`.

PRAGMA foreign_keys = ON;

----------------------------------------------------------------------------
-- Facilities
----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS facilities (
  id                TEXT PRIMARY KEY,                 -- UUID
  external_id       TEXT UNIQUE,                      -- 厚労省IDなど他システムID
  name              TEXT NOT NULL,
  short_name        TEXT,
  official_name     TEXT,
  kana_name         TEXT,
  kana_short_name   TEXT,
  prefecture_code   TEXT,
  prefecture        TEXT,
  city_code         TEXT,
  city              TEXT,
  address           TEXT,
  postal_code       TEXT,
  latitude          REAL,
  longitude         REAL,
  facility_type     TEXT,                              -- clinic / hospital / etc.
  source            TEXT DEFAULT 'manual',             -- manual / mhlw / import
  mhlw_sync_status  TEXT DEFAULT 'pending',            -- pending / synced / manual
  created_at        INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at        INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS facilities_name_idx
  ON facilities (name);

CREATE INDEX IF NOT EXISTS facilities_short_name_idx
  ON facilities (short_name);

CREATE INDEX IF NOT EXISTS facilities_prefecture_idx
  ON facilities (prefecture_code, city_code);

CREATE TRIGGER IF NOT EXISTS facilities_updated_at
AFTER UPDATE ON facilities
FOR EACH ROW
BEGIN
  UPDATE facilities
    SET updated_at = strftime('%s','now')
    WHERE id = OLD.id;
END;

----------------------------------------------------------------------------
-- Facilities: MHLW snapshots
----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS facility_mhlw_snapshot (
  facility_id TEXT PRIMARY KEY REFERENCES facilities(id) ON DELETE CASCADE,
  synced_at   INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  payload     TEXT NOT NULL                             -- JSON string
);

----------------------------------------------------------------------------
-- Facilities: schedules
----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS facility_schedule (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  facility_id     TEXT NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  department_code TEXT,
  department_name TEXT,
  slot_type       TEXT,
  day_of_week     INTEGER NOT NULL CHECK(day_of_week BETWEEN 0 AND 6),
  start_time      TEXT,
  end_time        TEXT,
  reception_start TEXT,
  reception_end   TEXT
);

CREATE INDEX IF NOT EXISTS facility_schedule_facility_idx
  ON facility_schedule (facility_id, day_of_week);

----------------------------------------------------------------------------
-- Accounts
----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS accounts (
  id              TEXT PRIMARY KEY,                      -- UUID
  email           TEXT UNIQUE,
  hashed_password TEXT,
  role            TEXT NOT NULL DEFAULT 'clinicStaff',   -- systemRoot / systemAdmin / clinicAdmin / clinicStaff / etc.
  status          TEXT NOT NULL DEFAULT 'active',        -- active / suspended / invited
  created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at      INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TRIGGER IF NOT EXISTS accounts_updated_at
AFTER UPDATE ON accounts
FOR EACH ROW
BEGIN
  UPDATE accounts
    SET updated_at = strftime('%s','now')
    WHERE id = OLD.id;
END;

----------------------------------------------------------------------------
-- Practitioners (医療者)
----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS practitioners (
  id               TEXT PRIMARY KEY,                    -- UUID
  account_id       TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  name             TEXT NOT NULL,
  kana             TEXT,
  gender           TEXT,
  birthdate        TEXT,
  contact_email    TEXT,
  contact_phone    TEXT,
  license_numbers  TEXT,                                -- JSON array (stringified)
  profile_status   TEXT DEFAULT 'draft',                -- draft / published / archived
  created_at       INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at       INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TRIGGER IF NOT EXISTS practitioners_updated_at
AFTER UPDATE ON practitioners
FOR EACH ROW
BEGIN
  UPDATE practitioners
    SET updated_at = strftime('%s','now')
    WHERE id = OLD.id;
END;

----------------------------------------------------------------------------
-- Memberships (施設所属)
----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS memberships (
  id               TEXT PRIMARY KEY,                   -- UUID
  facility_id      TEXT NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  practitioner_id  TEXT NOT NULL REFERENCES practitioners(id) ON DELETE CASCADE,
  role             TEXT NOT NULL,                      -- clinicAdmin / clinicStaff / etc.
  status           TEXT NOT NULL DEFAULT 'active',     -- active / pending / archived
  started_at       TEXT,
  ended_at         TEXT,
  created_at       INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at       INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  UNIQUE(facility_id, practitioner_id, role, status)
);

CREATE INDEX IF NOT EXISTS memberships_facility_idx
  ON memberships (facility_id, status);

CREATE INDEX IF NOT EXISTS memberships_practitioner_idx
  ON memberships (practitioner_id, status);

CREATE TRIGGER IF NOT EXISTS memberships_updated_at
AFTER UPDATE ON memberships
FOR EACH ROW
BEGIN
  UPDATE memberships
    SET updated_at = strftime('%s','now')
    WHERE id = OLD.id;
END;

----------------------------------------------------------------------------
-- MHLW import logs
----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mhlw_imports (
  id               TEXT PRIMARY KEY,               -- UUID
  source           TEXT NOT NULL,                  -- csv-upload / cli
  facility_count   INTEGER NOT NULL DEFAULT 0,
  schedule_count   INTEGER NOT NULL DEFAULT 0,
  started_at       INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  finished_at      INTEGER,
  status           TEXT NOT NULL DEFAULT 'running', -- running / success / failed
  r2_object_key    TEXT,                             -- JSON backup path
  notes            TEXT
);

CREATE INDEX IF NOT EXISTS mhlw_imports_started_idx
  ON mhlw_imports (started_at DESC);

----------------------------------------------------------------------------
-- Audit log
----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_log (
  id            TEXT PRIMARY KEY,               -- UUID
  actor_id      TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  action        TEXT NOT NULL,
  target_type   TEXT,
  target_id     TEXT,
  diff_before   TEXT,                           -- JSON string
  diff_after    TEXT,                           -- JSON string
  created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS audit_log_target_idx
  ON audit_log (target_type, target_id);

CREATE INDEX IF NOT EXISTS audit_log_actor_idx
  ON audit_log (actor_id, created_at DESC);

