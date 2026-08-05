-- Restaura Coluna: Estante → Coluna → Linha

BEGIN;

CREATE TABLE IF NOT EXISTS warehouse_colunas (
  id TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "estanteId" TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT,
  "pickOrder" INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO warehouse_colunas (id, "tenantId", "estanteId", code, "pickOrder", active, "createdAt", "updatedAt")
SELECT
  'mcol_' || e.id,
  e."tenantId",
  e.id,
  '01',
  0,
  true,
  NOW(),
  NOW()
FROM warehouse_estantes e
WHERE EXISTS (SELECT 1 FROM warehouse_linhas l WHERE l."estanteId" = e.id)
  AND NOT EXISTS (
    SELECT 1 FROM warehouse_colunas c WHERE c."estanteId" = e.id AND c.code = '01'
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'warehouse_colunas_tenantId_fkey'
  ) THEN
    ALTER TABLE warehouse_colunas
      ADD CONSTRAINT "warehouse_colunas_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES tenants(id) ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'warehouse_colunas_estanteId_fkey'
  ) THEN
    ALTER TABLE warehouse_colunas
      ADD CONSTRAINT "warehouse_colunas_estanteId_fkey"
      FOREIGN KEY ("estanteId") REFERENCES warehouse_estantes(id) ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "warehouse_colunas_tenantId_estanteId_code_key"
  ON warehouse_colunas("tenantId", "estanteId", code);
CREATE INDEX IF NOT EXISTS "warehouse_colunas_estanteId_idx"
  ON warehouse_colunas("estanteId");

ALTER TABLE warehouse_linhas ADD COLUMN IF NOT EXISTS "colunaId" TEXT;

UPDATE warehouse_linhas l
SET "colunaId" = c.id
FROM warehouse_colunas c
WHERE l."estanteId" = c."estanteId" AND c.code = '01' AND l."colunaId" IS NULL;

DELETE FROM locations WHERE "linhaId" IN (
  SELECT id FROM warehouse_linhas WHERE "colunaId" IS NULL
);
DELETE FROM warehouse_linhas WHERE "colunaId" IS NULL;

ALTER TABLE warehouse_linhas DROP CONSTRAINT IF EXISTS "warehouse_linhas_estanteId_fkey";
DROP INDEX IF EXISTS "warehouse_linhas_tenantId_estanteId_code_key";
DROP INDEX IF EXISTS "warehouse_linhas_estanteId_idx";
ALTER TABLE warehouse_linhas DROP COLUMN IF EXISTS "estanteId";

ALTER TABLE warehouse_linhas ALTER COLUMN "colunaId" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'warehouse_linhas_colunaId_fkey'
  ) THEN
    ALTER TABLE warehouse_linhas
      ADD CONSTRAINT "warehouse_linhas_colunaId_fkey"
      FOREIGN KEY ("colunaId") REFERENCES warehouse_colunas(id) ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "warehouse_linhas_tenantId_colunaId_code_key"
  ON warehouse_linhas("tenantId", "colunaId", code);
CREATE INDEX IF NOT EXISTS "warehouse_linhas_colunaId_idx"
  ON warehouse_linhas("colunaId");

ALTER TABLE locations ADD COLUMN IF NOT EXISTS "colunaId" TEXT;

UPDATE locations loc
SET "colunaId" = l."colunaId"
FROM warehouse_linhas l
WHERE loc."linhaId" = l.id AND loc."colunaId" IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'locations_colunaId_fkey'
  ) THEN
    ALTER TABLE locations
      ADD CONSTRAINT "locations_colunaId_fkey"
      FOREIGN KEY ("colunaId") REFERENCES warehouse_colunas(id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
