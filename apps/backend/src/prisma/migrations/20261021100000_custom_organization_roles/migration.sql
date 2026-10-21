DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "Organization" o
        WHERE NOT EXISTS (
            SELECT 1
            FROM "User" u
            JOIN "Department" d ON d."id" = u."department_id"
            JOIN "Workspace" w ON w."id" = d."workspace_id"
            WHERE w."org_id" = o."id"
              AND u."role"::TEXT = 'Admin'
        )
    ) THEN
        RAISE EXCEPTION
            'Every existing organization must have an Admin account to become its immutable Owner before this migration';
    END IF;
END $$;

CREATE TABLE "OrganizationRole" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "is_owner" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationRole_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DocumentRoleAccess" (
    "document_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,

    CONSTRAINT "DocumentRoleAccess_pkey" PRIMARY KEY ("document_id", "role_id")
);

ALTER TABLE "Organization" ADD COLUMN "owner_user_id" TEXT;
ALTER TABLE "User" ADD COLUMN "role_id" TEXT;

CREATE TEMPORARY TABLE "_OwnerAssignment" (
    "org_id" TEXT PRIMARY KEY,
    "user_id" TEXT NOT NULL
);

INSERT INTO "_OwnerAssignment" ("org_id", "user_id")
SELECT "org_id", "user_id"
FROM (
    SELECT
        w."org_id",
        u."id" AS "user_id",
        ROW_NUMBER() OVER (
            PARTITION BY w."org_id"
            ORDER BY (u."role"::TEXT = 'Admin') DESC, u."id"
        ) AS "owner_rank"
    FROM "User" u
    JOIN "Department" d ON d."id" = u."department_id"
    JOIN "Workspace" w ON w."id" = d."workspace_id"
) candidates
WHERE "owner_rank" = 1
  AND EXISTS (
      SELECT 1
      FROM "User" admin_user
      JOIN "Department" admin_department ON admin_department."id" = admin_user."department_id"
      JOIN "Workspace" admin_workspace ON admin_workspace."id" = admin_department."workspace_id"
      WHERE admin_workspace."org_id" = candidates."org_id"
        AND admin_user."role"::TEXT = 'Admin'
        AND admin_user."id" = candidates."user_id"
  );

INSERT INTO "OrganizationRole" ("id", "org_id", "name", "permissions", "is_owner")
SELECT
    gen_random_uuid()::TEXT,
    o."id",
    'Owner',
    ARRAY[
        'documents:search',
        'documents:upload',
        'documents:delete',
        'documents:reindex',
        'documents:manage_access',
        'drive:connect',
        'drive:import',
        'users:manage',
        'roles:manage',
        'workspace:manage',
        'analytics:view'
    ]::TEXT[],
    true
FROM "Organization" o;

WITH old_roles AS (
    SELECT w."org_id", d."id" AS "department_id", u."role"::TEXT AS "legacy_role"
    FROM "User" u
    JOIN "Department" d ON d."id" = u."department_id"
    JOIN "Workspace" w ON w."id" = d."workspace_id"
    UNION
    SELECT w."org_id", d."id" AS "department_id", old_role::TEXT AS "legacy_role"
    FROM "Document" doc
    JOIN "Department" d ON d."id" = doc."department_id"
    JOIN "Workspace" w ON w."id" = d."workspace_id"
    CROSS JOIN LATERAL unnest(doc."allowed_roles") AS old_role
)
INSERT INTO "OrganizationRole" ("id", "org_id", "name", "permissions")
SELECT
    gen_random_uuid()::TEXT,
    old_roles."org_id",
    'Legacy ' || old_roles."legacy_role" || ' - ' || department."name" ||
        ' (' || LEFT(old_roles."department_id", 8) || ')',
    CASE old_roles."legacy_role"
        WHEN 'Admin' THEN ARRAY[
            'documents:search', 'documents:upload', 'documents:delete',
            'documents:reindex', 'documents:manage_access',
            'drive:connect', 'drive:import', 'users:manage',
            'roles:manage', 'workspace:manage', 'analytics:view'
        ]::TEXT[]
        WHEN 'Manager' THEN ARRAY[
            'documents:search', 'documents:upload', 'documents:delete',
            'documents:reindex', 'drive:connect', 'drive:import'
        ]::TEXT[]
        WHEN 'Employee' THEN ARRAY[
            'documents:search', 'documents:upload', 'documents:delete'
        ]::TEXT[]
        ELSE ARRAY['documents:search', 'documents:upload', 'documents:delete']::TEXT[]
    END
FROM old_roles
JOIN "Department" department ON department."id" = old_roles."department_id";

UPDATE "Organization" o
SET "owner_user_id" = assignment."user_id"
FROM "_OwnerAssignment" assignment
WHERE o."id" = assignment."org_id";

UPDATE "User" u
SET "role_id" = owner_role."id"
FROM "Department" d
JOIN "Workspace" w ON w."id" = d."workspace_id"
JOIN "_OwnerAssignment" assignment ON assignment."org_id" = w."org_id"
JOIN "OrganizationRole" owner_role
    ON owner_role."org_id" = w."org_id" AND owner_role."is_owner"
WHERE d."id" = u."department_id"
  AND assignment."user_id" = u."id";

UPDATE "User" u
SET "role_id" = legacy_role."id"
FROM "Department" d
JOIN "Workspace" w ON w."id" = d."workspace_id"
JOIN "OrganizationRole" legacy_role ON legacy_role."org_id" = w."org_id"
WHERE d."id" = u."department_id"
  AND legacy_role."name" = 'Legacy ' || u."role"::TEXT || ' - ' || d."name" ||
      ' (' || LEFT(d."id", 8) || ')'
  AND u."id" <> (
      SELECT assignment."user_id"
      FROM "_OwnerAssignment" assignment
      WHERE assignment."org_id" = w."org_id"
  );

INSERT INTO "DocumentRoleAccess" ("document_id", "role_id")
SELECT doc."id", role."id"
FROM "Document" doc
JOIN "Department" d ON d."id" = doc."department_id"
JOIN "Workspace" w ON w."id" = d."workspace_id"
CROSS JOIN LATERAL unnest(doc."allowed_roles") AS old_role
JOIN "OrganizationRole" role
    ON role."org_id" = w."org_id"
    AND role."name" = 'Legacy ' || old_role::TEXT || ' - ' || d."name" ||
        ' (' || LEFT(d."id", 8) || ')'
ON CONFLICT DO NOTHING;

ALTER TABLE "OrganizationRole"
    ADD CONSTRAINT "OrganizationRole_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "User"
    ALTER COLUMN "role_id" SET NOT NULL,
    ADD CONSTRAINT "User_role_id_fkey"
        FOREIGN KEY ("role_id") REFERENCES "OrganizationRole"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DocumentRoleAccess"
    ADD CONSTRAINT "DocumentRoleAccess_document_id_fkey"
        FOREIGN KEY ("document_id") REFERENCES "Document"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "DocumentRoleAccess_role_id_fkey"
        FOREIGN KEY ("role_id") REFERENCES "OrganizationRole"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Organization"
    ADD CONSTRAINT "Organization_owner_user_id_fkey"
    FOREIGN KEY ("owner_user_id") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Organization_owner_user_id_key" ON "Organization"("owner_user_id");
CREATE UNIQUE INDEX "OrganizationRole_org_id_name_key" ON "OrganizationRole"("org_id", "name");
CREATE INDEX "OrganizationRole_org_id_idx" ON "OrganizationRole"("org_id");
CREATE INDEX "DocumentRoleAccess_role_id_idx" ON "DocumentRoleAccess"("role_id");
CREATE INDEX "User_role_id_idx" ON "User"("role_id");

DROP TABLE "_OwnerAssignment";
ALTER TABLE "Document" DROP COLUMN "allowed_roles";
ALTER TABLE "User" DROP COLUMN "role";
DROP TYPE "Role";
