-- 005_facility_extended_tables.sql
-- Store extended clinic data (departments, access, schedule, etc.).
-- Apply after 004_organization_support.sql.

-- 標榜診療科
CREATE TABLE IF NOT EXISTS facility_departments (
  id             TEXT PRIMARY KEY,
  facility_id    TEXT NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  organization_id TEXT REFERENCES organizations(id),
  department_code TEXT,
  name           TEXT NOT NULL,
  category       TEXT,
  is_primary     INTEGER NOT NULL DEFAULT 0,
  source         TEXT DEFAULT 'manual',
  notes          TEXT,
  created_at     INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at     INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  UNIQUE (facility_id, department_code, name)
);

CREATE INDEX IF NOT EXISTS facility_departments_facility_idx
  ON facility_departments (facility_id, is_primary);
CREATE INDEX IF NOT EXISTS facility_departments_org_idx
  ON facility_departments (organization_id, facility_id);

CREATE TRIGGER IF NOT EXISTS facility_departments_updated_at
AFTER UPDATE ON facility_departments
FOR EACH ROW
BEGIN
  UPDATE facility_departments
    SET updated_at = strftime('%s','now')
    WHERE id = OLD.id;
END;

-- 病床情報
CREATE TABLE IF NOT EXISTS facility_beds (
  id             TEXT PRIMARY KEY,
  facility_id    TEXT NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  organization_id TEXT REFERENCES organizations(id),
  bed_type       TEXT NOT NULL,
  count          INTEGER NOT NULL DEFAULT 0,
  source         TEXT DEFAULT 'manual',
  notes          TEXT,
  created_at     INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at     INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  UNIQUE (facility_id, bed_type)
);

CREATE INDEX IF NOT EXISTS facility_beds_facility_idx
  ON facility_beds (facility_id);
CREATE INDEX IF NOT EXISTS facility_beds_org_idx
  ON facility_beds (organization_id, facility_id);

CREATE TRIGGER IF NOT EXISTS facility_beds_updated_at
AFTER UPDATE ON facility_beds
FOR EACH ROW
BEGIN
  UPDATE facility_beds
    SET updated_at = strftime('%s','now')
    WHERE id = OLD.id;
END;

-- アクセス情報
CREATE TABLE IF NOT EXISTS facility_access_info (
  facility_id       TEXT PRIMARY KEY REFERENCES facilities(id) ON DELETE CASCADE,
  organization_id   TEXT REFERENCES organizations(id),
  nearest_station   TEXT,
  bus               TEXT,
  parking_available INTEGER,
  parking_capacity  INTEGER,
  parking_notes     TEXT,
  barrier_free      TEXT,
  notes             TEXT,
  summary           TEXT,
  source            TEXT DEFAULT 'manual',
  updated_at        INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TRIGGER IF NOT EXISTS facility_access_info_updated
AFTER UPDATE ON facility_access_info
FOR EACH ROW
BEGIN
  UPDATE facility_access_info
    SET updated_at = strftime('%s','now')
    WHERE facility_id = OLD.facility_id;
END;
CREATE INDEX IF NOT EXISTS facility_access_info_org_idx
  ON facility_access_info (organization_id, facility_id);

-- 診療形態
CREATE TABLE IF NOT EXISTS facility_modes (
  id             TEXT PRIMARY KEY,
  facility_id    TEXT NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  organization_id TEXT REFERENCES organizations(id),
  code           TEXT NOT NULL,
  label          TEXT,
  icon           TEXT,
  color          TEXT,
  display_order  INTEGER,
  notes          TEXT,
  source         TEXT DEFAULT 'manual',
  created_at     INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at     INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  UNIQUE(facility_id, code)
);

CREATE INDEX IF NOT EXISTS facility_modes_facility_idx
  ON facility_modes (facility_id);
CREATE INDEX IF NOT EXISTS facility_modes_org_idx
  ON facility_modes (organization_id, facility_id);

CREATE TRIGGER IF NOT EXISTS facility_modes_updated_at
AFTER UPDATE ON facility_modes
FOR EACH ROW
BEGIN
  UPDATE facility_modes
    SET updated_at = strftime('%s','now')
    WHERE id = OLD.id;
END;

-- 予防接種
CREATE TABLE IF NOT EXISTS facility_vaccinations (
  id             TEXT PRIMARY KEY,
  facility_id    TEXT NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  organization_id TEXT REFERENCES organizations(id),
  vaccine_code   TEXT,
  name           TEXT NOT NULL,
  category       TEXT,
  description    TEXT,
  reference_url  TEXT,
  notes          TEXT,
  source         TEXT DEFAULT 'manual',
  created_at     INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at     INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  UNIQUE(facility_id, vaccine_code, name)
);

CREATE INDEX IF NOT EXISTS facility_vaccinations_facility_idx
  ON facility_vaccinations (facility_id);
CREATE INDEX IF NOT EXISTS facility_vaccinations_org_idx
  ON facility_vaccinations (organization_id, facility_id);

CREATE TRIGGER IF NOT EXISTS facility_vaccinations_updated_at
AFTER UPDATE ON facility_vaccinations
FOR EACH ROW
BEGIN
  UPDATE facility_vaccinations
    SET updated_at = strftime('%s','now')
    WHERE id = OLD.id;
END;

-- 健診
CREATE TABLE IF NOT EXISTS facility_checkups (
  id             TEXT PRIMARY KEY,
  facility_id    TEXT NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  organization_id TEXT REFERENCES organizations(id),
  checkup_code   TEXT,
  name           TEXT NOT NULL,
  category       TEXT,
  description    TEXT,
  reference_url  TEXT,
  notes          TEXT,
  source         TEXT DEFAULT 'manual',
  created_at     INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at     INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  UNIQUE(facility_id, checkup_code, name)
);

CREATE INDEX IF NOT EXISTS facility_checkups_facility_idx
  ON facility_checkups (facility_id);
CREATE INDEX IF NOT EXISTS facility_checkups_org_idx
  ON facility_checkups (organization_id, facility_id);

CREATE TRIGGER IF NOT EXISTS facility_checkups_updated_at
AFTER UPDATE ON facility_checkups
FOR EACH ROW
BEGIN
  UPDATE facility_checkups
    SET updated_at = strftime('%s','now')
    WHERE id = OLD.id;
END;

ALTER TABLE facility_schedule ADD COLUMN day_label TEXT;
ALTER TABLE facility_schedule ADD COLUMN source TEXT DEFAULT 'manual';
ALTER TABLE facility_schedule ADD COLUMN organization_id TEXT REFERENCES organizations(id);

CREATE INDEX IF NOT EXISTS facility_schedule_org_idx
  ON facility_schedule (facility_id, organization_id, day_of_week);

-- 任意項目
CREATE TABLE IF NOT EXISTS facility_extra (
  facility_id     TEXT PRIMARY KEY REFERENCES facilities(id) ON DELETE CASCADE,
  organization_id TEXT REFERENCES organizations(id),
  payload         TEXT NOT NULL,
  source          TEXT DEFAULT 'manual',
  updated_at      INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TRIGGER IF NOT EXISTS facility_extra_updated
AFTER UPDATE ON facility_extra
FOR EACH ROW
BEGIN
  UPDATE facility_extra
    SET updated_at = strftime('%s','now')
    WHERE facility_id = OLD.facility_id;
END;
CREATE INDEX IF NOT EXISTS facility_extra_org_idx
  ON facility_extra (organization_id, facility_id);
