-- Remove Coluna; Linha hangs from Estante; Location proximity + 1:1 linhaId

BEGIN;

-- 1) Linhas: colunaId -> estanteId
ALTER TABLE warehouse_linhas ADD COLUMN IF NOT EXISTS "estanteId" TEXT;

UPDATE warehouse_linhas l
SET "estanteId" = c."estanteId"
FROM warehouse_colunas c
WHERE l."colunaId" = c.id AND l."estanteId" IS NULL;

DELETE FROM locations WHERE "linhaId" IN (
  SELECT id FROM warehouse_linhas WHERE "estanteId" IS NULL
);
DELETE FROM warehouse_linhas WHERE "estanteId" IS NULL;

ALTER TABLE warehouse_linhas DROP CONSTRAINT IF EXISTS warehouse_linhas_colunaId_fkey;
ALTER TABLE warehouse_linhas DROP CONSTRAINT IF EXISTS "warehouse_linhas_tenantId_colunaId_code_key";
DROP INDEX IF EXISTS "warehouse_linhas_colunaId_idx";
ALTER TABLE warehouse_linhas DROP COLUMN IF EXISTS "colunaId";

ALTER TABLE warehouse_linhas ALTER COLUMN "estanteId" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'warehouse_linhas_estanteId_fkey'
  ) THEN
    ALTER TABLE warehouse_linhas
      ADD CONSTRAINT "warehouse_linhas_estanteId_fkey"
      FOREIGN KEY ("estanteId") REFERENCES warehouse_estantes(id)
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "warehouse_linhas_tenantId_estanteId_code_key"
  ON warehouse_linhas("tenantId", "estanteId", code);
CREATE INDEX IF NOT EXISTS "warehouse_linhas_estanteId_idx"
  ON warehouse_linhas("estanteId");

-- 2) Locations: drop colunaId, add proximity, unique linhaId
ALTER TABLE locations DROP CONSTRAINT IF EXISTS locations_colunaId_fkey;
ALTER TABLE locations DROP COLUMN IF EXISTS "colunaId";

ALTER TABLE locations ADD COLUMN IF NOT EXISTS "proximityCorredorId" TEXT;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS "proximityEstanteId" TEXT;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS "proximityLinhaId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'locations_proximityCorredorId_fkey'
  ) THEN
    ALTER TABLE locations
      ADD CONSTRAINT "locations_proximityCorredorId_fkey"
      FOREIGN KEY ("proximityCorredorId") REFERENCES warehouse_corredores(id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'locations_proximityEstanteId_fkey'
  ) THEN
    ALTER TABLE locations
      ADD CONSTRAINT "locations_proximityEstanteId_fkey"
      FOREIGN KEY ("proximityEstanteId") REFERENCES warehouse_estantes(id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'locations_proximityLinhaId_fkey'
  ) THEN
    ALTER TABLE locations
      ADD CONSTRAINT "locations_proximityLinhaId_fkey"
      FOREIGN KEY ("proximityLinhaId") REFERENCES warehouse_linhas(id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "locations_linhaId_key" ON locations("linhaId");

-- 3) Drop colunas table
DROP TABLE IF EXISTS warehouse_colunas CASCADE;

COMMIT;
