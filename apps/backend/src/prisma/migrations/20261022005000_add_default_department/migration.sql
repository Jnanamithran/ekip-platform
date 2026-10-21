ALTER TABLE "Department"
ADD COLUMN "is_default" BOOLEAN NOT NULL DEFAULT FALSE;

WITH ranked_departments AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "workspace_id"
      ORDER BY CASE WHEN LOWER("name") = 'general' THEN 0 ELSE 1 END, "id"
    ) AS position
  FROM "Department"
)
UPDATE "Department" AS department
SET "is_default" = TRUE
FROM ranked_departments
WHERE department."id" = ranked_departments."id"
  AND ranked_departments.position = 1;

INSERT INTO "Department" ("id", "workspace_id", "name", "is_default")
SELECT gen_random_uuid()::text, workspace."id", 'General', TRUE
FROM "Workspace" AS workspace
WHERE NOT EXISTS (
  SELECT 1
  FROM "Department" AS department
  WHERE department."workspace_id" = workspace."id"
);

CREATE UNIQUE INDEX "Department_one_default_per_workspace_idx"
ON "Department"("workspace_id")
WHERE "is_default" = TRUE;
