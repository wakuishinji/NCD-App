-- 006_mhlw_reference_tables.sql
-- Normalize MHLW (厚生労働省) CSV data into dedicated reference tables.

CREATE TABLE IF NOT EXISTS mhlw_facilities (
  facility_id        TEXT PRIMARY KEY,
  facility_type      TEXT,
  name               TEXT,
  name_kana          TEXT,
  official_name      TEXT,
  official_name_kana TEXT,
  short_name         TEXT,
  short_name_kana    TEXT,
  english_name       TEXT,
  prefecture_code    TEXT,
  prefecture         TEXT,
  city_code          TEXT,
  city               TEXT,
  address            TEXT,
  postal_code        TEXT,
  phone              TEXT,
  fax                TEXT,
  homepage_url       TEXT,
  latitude           REAL,
  longitude          REAL,
  search_name        TEXT,
  search_tokens      TEXT,
  source             TEXT DEFAULT 'mhlw',
  raw_json           TEXT,
  updated_at         INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS mhlw_facilities_name_idx
  ON mhlw_facilities (name);

CREATE INDEX IF NOT EXISTS mhlw_facilities_short_name_idx
  ON mhlw_facilities (short_name);

CREATE INDEX IF NOT EXISTS mhlw_facilities_pref_city_idx
  ON mhlw_facilities (prefecture, city);

CREATE INDEX IF NOT EXISTS mhlw_facilities_search_tokens_idx
  ON mhlw_facilities (search_tokens);

CREATE TRIGGER IF NOT EXISTS mhlw_facilities_touch_updated_at
AFTER UPDATE ON mhlw_facilities
FOR EACH ROW
BEGIN
  UPDATE mhlw_facilities
    SET updated_at = strftime('%s','now')
    WHERE facility_id = OLD.facility_id;
END;

CREATE TABLE IF NOT EXISTS mhlw_facility_departments (
  facility_id    TEXT NOT NULL REFERENCES mhlw_facilities(facility_id) ON DELETE CASCADE,
  department_code TEXT,
  department_name TEXT,
  PRIMARY KEY (facility_id, department_code, department_name)
);

CREATE INDEX IF NOT EXISTS mhlw_facility_departments_code_idx
  ON mhlw_facility_departments (department_code, department_name);

CREATE TABLE IF NOT EXISTS mhlw_facility_schedules (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  facility_id     TEXT NOT NULL REFERENCES mhlw_facilities(facility_id) ON DELETE CASCADE,
  department_code TEXT,
  department_name TEXT,
  slot_type       TEXT,
  day_of_week     INTEGER NOT NULL CHECK(day_of_week BETWEEN 0 AND 6),
  start_time      TEXT,
  end_time        TEXT,
  reception_start TEXT,
  reception_end   TEXT
);

CREATE INDEX IF NOT EXISTS mhlw_facility_schedules_facility_idx
  ON mhlw_facility_schedules (facility_id, day_of_week);

CREATE TABLE IF NOT EXISTS mhlw_facility_beds (
  facility_id TEXT NOT NULL REFERENCES mhlw_facilities(facility_id) ON DELETE CASCADE,
  bed_type    TEXT NOT NULL,
  bed_count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (facility_id, bed_type)
);

CREATE INDEX IF NOT EXISTS mhlw_facility_beds_facility_idx
  ON mhlw_facility_beds (facility_id);

