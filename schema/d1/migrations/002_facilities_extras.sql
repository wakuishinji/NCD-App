-- 002_facilities_extras.sql
-- Extend the facilities table with additional columns needed for schema v2 data.
-- This migration must be applied after schema/d1/schema.sql (initial tables).

ALTER TABLE facilities ADD COLUMN phone TEXT;
ALTER TABLE facilities ADD COLUMN fax TEXT;
ALTER TABLE facilities ADD COLUMN email TEXT;
ALTER TABLE facilities ADD COLUMN website TEXT;
ALTER TABLE facilities ADD COLUMN metadata TEXT;
