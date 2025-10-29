-- 003_facility_service_tables.sql
-- Normalize facility-related collections into dedicated tables.
-- Apply after 002_facilities_extras.sql.

CREATE TABLE IF NOT EXISTS facility_services (
  id           TEXT PRIMARY KEY,
  facility_id  TEXT NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  master_id    TEXT,
  name         TEXT NOT NULL,
  category     TEXT,
  source       TEXT,
  notes        TEXT,
  created_at   INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at   INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  UNIQUE (facility_id, master_id, name)
);

CREATE INDEX IF NOT EXISTS facility_services_facility_idx
  ON facility_services (facility_id);

CREATE INDEX IF NOT EXISTS facility_services_master_idx
  ON facility_services (master_id)
  WHERE master_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS facility_services_updated_at
AFTER UPDATE ON facility_services
FOR EACH ROW
BEGIN
  UPDATE facility_services
    SET updated_at = strftime('%s','now')
    WHERE id = OLD.id;
END;

CREATE TABLE IF NOT EXISTS facility_tests (
  id           TEXT PRIMARY KEY,
  facility_id  TEXT NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  master_id    TEXT,
  name         TEXT NOT NULL,
  category     TEXT,
  source       TEXT,
  notes        TEXT,
  created_at   INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at   INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  UNIQUE (facility_id, master_id, name)
);

CREATE INDEX IF NOT EXISTS facility_tests_facility_idx
  ON facility_tests (facility_id);

CREATE INDEX IF NOT EXISTS facility_tests_master_idx
  ON facility_tests (master_id)
  WHERE master_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS facility_tests_updated_at
AFTER UPDATE ON facility_tests
FOR EACH ROW
BEGIN
  UPDATE facility_tests
    SET updated_at = strftime('%s','now')
    WHERE id = OLD.id;
END;

CREATE TABLE IF NOT EXISTS facility_qualifications (
  id             TEXT PRIMARY KEY,
  facility_id    TEXT NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  master_id      TEXT,
  name           TEXT NOT NULL,
  issuer         TEXT,
  obtained_at    TEXT,
  notes          TEXT,
  created_at     INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at     INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  UNIQUE (facility_id, master_id, name)
);

CREATE INDEX IF NOT EXISTS facility_qualifications_facility_idx
  ON facility_qualifications (facility_id);

CREATE INDEX IF NOT EXISTS facility_qualifications_master_idx
  ON facility_qualifications (master_id)
  WHERE master_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS facility_qualifications_updated_at
AFTER UPDATE ON facility_qualifications
FOR EACH ROW
BEGIN
  UPDATE facility_qualifications
    SET updated_at = strftime('%s','now')
    WHERE id = OLD.id;
END;

CREATE TABLE IF NOT EXISTS facility_staff_lookup (
  id             TEXT PRIMARY KEY,
  facility_id    TEXT NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  account_id     TEXT,
  membership_id  TEXT,
  roles          TEXT,
  status         TEXT,
  created_at     INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at     INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS facility_staff_lookup_facility_idx
  ON facility_staff_lookup (facility_id, status);

CREATE INDEX IF NOT EXISTS facility_staff_lookup_membership_idx
  ON facility_staff_lookup (membership_id)
  WHERE membership_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS facility_staff_lookup_updated_at
AFTER UPDATE ON facility_staff_lookup
FOR EACH ROW
BEGIN
  UPDATE facility_staff_lookup
    SET updated_at = strftime('%s','now')
    WHERE id = OLD.id;
END;
