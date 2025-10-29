-- 004_organization_support.sql
-- Introduce organization entities and link facilities to organizations.
-- Apply after 003_facility_service_tables.sql.

CREATE TABLE IF NOT EXISTS organizations (
  id          TEXT PRIMARY KEY,                 -- organization:<uuid|slug>
  slug        TEXT UNIQUE,
  name        TEXT NOT NULL,
  type        TEXT,                             -- medicalAssociation / hospitalGroup / etc.
  status      TEXT DEFAULT 'active',
  contact     TEXT,                             -- JSON string (emails, phone, address)
  created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TRIGGER IF NOT EXISTS organizations_updated_at
AFTER UPDATE ON organizations
FOR EACH ROW
BEGIN
  UPDATE organizations
    SET updated_at = strftime('%s','now')
    WHERE id = OLD.id;
END;

CREATE TABLE IF NOT EXISTS organization_settings (
  organization_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  payload         TEXT NOT NULL,                -- JSON string
  updated_at      INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TRIGGER IF NOT EXISTS organization_settings_updated_at
AFTER UPDATE ON organization_settings
FOR EACH ROW
BEGIN
  UPDATE organization_settings
    SET updated_at = strftime('%s','now')
    WHERE organization_id = OLD.organization_id;
END;

ALTER TABLE facilities ADD COLUMN organization_id TEXT REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS facilities_org_idx ON facilities (organization_id);

ALTER TABLE facility_services ADD COLUMN organization_id TEXT REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS facility_services_org_idx ON facility_services (organization_id);

ALTER TABLE facility_tests ADD COLUMN organization_id TEXT REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS facility_tests_org_idx ON facility_tests (organization_id);

ALTER TABLE facility_qualifications ADD COLUMN organization_id TEXT REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS facility_qualifications_org_idx ON facility_qualifications (organization_id);

ALTER TABLE facility_staff_lookup ADD COLUMN organization_id TEXT REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS facility_staff_lookup_org_idx ON facility_staff_lookup (organization_id);
