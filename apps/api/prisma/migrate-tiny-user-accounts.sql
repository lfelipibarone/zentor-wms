-- Migra conexões Tiny de tenant único para contas por usuário.
ALTER TABLE "tiny_connections" ADD COLUMN IF NOT EXISTS "userId" TEXT;
ALTER TABLE "tiny_connections" ADD COLUMN IF NOT EXISTS "isDefault" BOOLEAN NOT NULL DEFAULT false;

UPDATE "tiny_connections" tc
SET "userId" = sub."userId"
FROM (
  SELECT DISTINCT ON (tc2.id)
    tc2.id AS connection_id,
    u.id AS "userId"
  FROM "tiny_connections" tc2
  JOIN "users" u ON u."tenantId" = tc2."tenantId"
  ORDER BY tc2.id, CASE WHEN u.role = 'ADMIN' THEN 0 ELSE 1 END, u."createdAt"
) sub
WHERE tc.id = sub.connection_id
  AND tc."userId" IS NULL;

DELETE FROM "tiny_connections" WHERE "userId" IS NULL;

ALTER TABLE "tiny_connections" DROP CONSTRAINT IF EXISTS "tiny_connections_tenantId_key";

UPDATE "tiny_connections" tc
SET "isDefault" = true
WHERE tc."isDefault" = false
  AND NOT EXISTS (
    SELECT 1
    FROM "tiny_connections" other
    WHERE other."tenantId" = tc."tenantId"
      AND other."userId" = tc."userId"
      AND other."isDefault" = true
      AND other.id <> tc.id
  );

ALTER TABLE "tiny_connections"
  ADD CONSTRAINT "tiny_connections_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "tiny_connections_tenantId_idx" ON "tiny_connections"("tenantId");
CREATE INDEX IF NOT EXISTS "tiny_connections_userId_idx" ON "tiny_connections"("userId");
CREATE INDEX IF NOT EXISTS "tiny_connections_tenantId_userId_idx" ON "tiny_connections"("tenantId", "userId");
