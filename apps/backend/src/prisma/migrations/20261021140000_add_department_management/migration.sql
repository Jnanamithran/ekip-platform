-- Migration: Add department management support
-- This migration ensures department_id indexes and constraints are in place
-- The Department model and relationships already exist in the schema

CREATE INDEX IF NOT EXISTS "Department_workspace_id_idx" ON "Department"("workspace_id");

CREATE INDEX IF NOT EXISTS "Document_department_id_idx" ON "Document"("department_id");