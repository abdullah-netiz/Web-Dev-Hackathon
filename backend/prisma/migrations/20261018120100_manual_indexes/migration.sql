-- Hand-written indexes and grants that Prisma 6 cannot express (AGENTS.md §6).

-- Trigram search on names / phones / emails (Q9): https://www.postgresql.org/docs/current/pgtrgm.html
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS "Contact_name_trgm_idx" ON "Contact" USING GIN ((("firstName" || ' ' || "lastName")) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Contact_email_trgm_idx" ON "Contact" USING GIN ("email" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Contact_phone_trgm_idx" ON "Contact" USING GIN ("phone" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Company_name_trgm_idx" ON "Company" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Opportunity_name_trgm_idx" ON "Opportunity" USING GIN ("name" gin_trgm_ops);

-- Custom field filters on JSONB (F2.2): https://www.postgresql.org/docs/current/datatype-json.html#JSON-INDEXING
CREATE INDEX IF NOT EXISTS "Contact_custom_gin_idx" ON "Contact" USING GIN ("custom" jsonb_path_ops);
CREATE INDEX IF NOT EXISTS "Company_custom_gin_idx" ON "Company" USING GIN ("custom" jsonb_path_ops);
CREATE INDEX IF NOT EXISTS "Opportunity_custom_gin_idx" ON "Opportunity" USING GIN ("custom" jsonb_path_ops);

-- One accountable owner at a time: at most one PENDING assignment per lead (F3.8).
-- https://www.postgresql.org/docs/current/indexes-partial.html
CREATE UNIQUE INDEX IF NOT EXISTS "LeadAssignment_one_pending_per_lead" ON "LeadAssignment" ("leadId") WHERE "status" = 'PENDING';

-- Audit history is append-only at the database level too (F4.3). Applies when the app connects as the
-- dedicated role `ubmp_app` (create it in production: CREATE ROLE ubmp_app LOGIN PASSWORD '...').
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ubmp_app') THEN
    GRANT SELECT, INSERT ON "AuditEvent" TO ubmp_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON "AuditEvent" FROM ubmp_app;
  END IF;
END $$;
