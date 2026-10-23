-- Migration: Add explicit role scope (organization vs. department) and
-- department-scoped role records, with a backward-compatible data migration.
--
-- Scope model
--   scope = 'organization'  -> organization-wide custom role (or protected Owner)
--   scope = 'department'    -> exactly one department (department_id set)
--
-- Organization-wide names are unique per org. Department-scoped names are
-- unique per org + department, allowing the same name in different departments.
--
-- Legacy data
--   - The protected Owner role stays organization-wide (department_id = NULL).
--   - Legacy roles were encoded as "Legacy <type> - <department> (<8-hex>)".
--     Each is mapped best-effort to its department; any role that cannot be
--     mapped unambiguously is preserved as organization-wide (department_id
--     = NULL) so nothing is dropped or silently escalated.

-- 1. Drop the old org-wide uniqueness rule. Older databases may represent it
--    as either a Prisma constraint-backed index or a standalone unique index.
ALTER TABLE "OrganizationRole" DROP CONSTRAINT IF EXISTS "OrganizationRole_org_id_name_key";
DROP INDEX IF EXISTS "OrganizationRole_org_id_name_key";

-- 2. Add the explicit role-scope representation.
ALTER TABLE "OrganizationRole" ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'organization';
ALTER TABLE "OrganizationRole" ADD COLUMN "department_id" TEXT;

-- 3. Migrate existing data.
DO $migration$
DECLARE
  r RECORD;
  dept_name_text TEXT;
  hash8          TEXT;
  dept_id        TEXT;
BEGIN
  -- Protected Owner role remains organization-wide (department_id = NULL).
  UPDATE "OrganizationRole"
  SET "scope" = 'organization'
  WHERE "is_owner" = TRUE;

  -- Legacy custom roles were named "Legacy <type> - <department> (<8-hex>)".
  -- Map each to one department when that mapping is unambiguous.
  FOR r IN
    SELECT id, org_id, name
    FROM "OrganizationRole"
    WHERE "is_owner" = FALSE
      AND "department_id" IS NULL
  LOOP
    dept_name_text := SPLIT_PART(SPLIT_PART(r.name, ' - ', 2), ' (', 1);
    hash8          := SPLIT_PART(SPLIT_PART(r.name, '(', 2), ')', 1);

    SELECT MIN("id") INTO dept_id
    FROM "Department"
    WHERE "workspace_id" IN (
            SELECT "id" FROM "Workspace" WHERE "org_id" = r."org_id"
          )
      AND "name" = dept_name_text
      AND LEFT("id", 8) = hash8
    HAVING COUNT(*) = 1;

    IF dept_id IS NOT NULL THEN
      UPDATE "OrganizationRole"
      SET "scope" = 'department',
          "department_id" = dept_id
      WHERE "id" = r.id;
    END IF;
  END LOOP;
END $migration$;

-- 4. Foreign key and uniqueness constraints for the new scope model.
ALTER TABLE "OrganizationRole" ADD CONSTRAINT "OrganizationRole_department_id_fkey"
  FOREIGN KEY ("department_id") REFERENCES "Department"("id") ON DELETE RESTRICT;

-- Keep the Owner and other organization-wide role names unique.
CREATE UNIQUE INDEX "OrganizationRole_org_id_name_key"
  ON "OrganizationRole"("org_id", "name")
  WHERE "department_id" IS NULL;

-- Department-scoped roles can share names across departments.
CREATE UNIQUE INDEX "OrganizationRole_org_id_department_id_name_key"
  ON "OrganizationRole"("org_id", "department_id", "name");

ALTER TABLE "OrganizationRole"
  ADD CONSTRAINT "OrganizationRole_scope_department_check"
  CHECK (
    ("scope" = 'organization' AND "department_id" IS NULL)
    OR ("scope" = 'department' AND "department_id" IS NOT NULL AND "is_owner" = FALSE)
  );