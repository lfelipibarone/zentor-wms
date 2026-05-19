ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
UPDATE "system_settings" SET "tenantId" = 'default-tenant' WHERE "tenantId" IS NULL;

ALTER TABLE "tiny_connections" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
UPDATE "tiny_connections" SET "tenantId" = 'default-tenant' WHERE "tenantId" IS NULL;
