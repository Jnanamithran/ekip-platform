-- Preserve legacy role records while preventing ambiguous department roles
-- from remaining broadly usable until an organization Owner reviews them.
ALTER TABLE "OrganizationRole"
  ADD COLUMN "scope_review_required" BOOLEAN NOT NULL DEFAULT FALSE;

-- The old custom-role migration included a department hash in legacy role
-- names. If that name no longer matches (for example, the department was
-- renamed), a single primary department shared by all assigned users is a
-- reliable fallback for determining the role's original department.
WITH assigned_departments AS (
  SELECT
    u."role_id",
    MIN(u."department_id") AS "department_id",
    COUNT(DISTINCT u."department_id") AS "department_count"
  FROM "User" u
  GROUP BY u."role_id"
)
UPDATE "OrganizationRole" r
SET "scope" = 'department',
    "department_id" = assigned_departments."department_id"
FROM assigned_departments
JOIN "Department" d
  ON d."id" = assigned_departments."department_id"
JOIN "Workspace" w
  ON w."id" = d."workspace_id"
WHERE r."id" = assigned_departments."role_id"
  AND assigned_departments."department_count" = 1
  AND w."org_id" = r."org_id"
  AND r."is_owner" = FALSE
  AND r."department_id" IS NULL
  AND r."name" ~ '^Legacy .+ - .+ \([0-9a-fA-F]{8}\)$';

-- Any remaining legacy-pattern role could not be mapped unambiguously.
-- Keep its role ID, permissions, users, and document grants intact, but block
-- authentication/assignment until an Owner reviews and explicitly resolves it.
UPDATE "OrganizationRole"
SET "scope_review_required" = TRUE
WHERE "is_owner" = FALSE
  AND "department_id" IS NULL
  AND "name" ~ '^Legacy .+ - .+ \([0-9a-fA-F]{8}\)$';

-- Prevent custom roles from claiming protected Owner identity in the database.
ALTER TABLE "OrganizationRole"
  ADD CONSTRAINT "OrganizationRole_owner_identity_check"
  CHECK (
    ("is_owner" = TRUE AND "name" = 'Owner' AND "scope" = 'organization' AND "department_id" IS NULL AND "scope_review_required" = FALSE)
    OR
    ("is_owner" = FALSE AND "name" <> 'Owner')
  );
