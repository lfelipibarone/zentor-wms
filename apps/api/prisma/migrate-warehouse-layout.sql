-- Migra layout do galpão: Barracão → Setor → Corredor → Estante → Coluna → Linha

BEGIN;

-- 1) Estantes: setorId → corredorId
ALTER TABLE warehouse_estantes ADD COLUMN IF NOT EXISTS "corredorId" TEXT;

UPDATE warehouse_estantes e
SET "corredorId" = sub.id
FROM (
  SELECT DISTINCT ON (e2.id) e2.id AS estante_id, c.id
  FROM warehouse_estantes e2
  JOIN warehouse_corredores c ON c."setorId" = e2."setorId"
  ORDER BY e2.id, c."pickOrder", c.code
) sub
WHERE e.id = sub.estante_id AND e."corredorId" IS NULL;

DELETE FROM locations
WHERE "estanteId" IN (SELECT id FROM warehouse_estantes WHERE "corredorId" IS NULL);

DELETE FROM warehouse_colunas
WHERE "prateleiraId" IN (
  SELECT p.id
  FROM warehouse_prateleiras p
  JOIN warehouse_estantes e ON e.id = p."estanteId"
  WHERE e."corredorId" IS NULL
);

DELETE FROM warehouse_prateleiras
WHERE "estanteId" IN (SELECT id FROM warehouse_estantes WHERE "corredorId" IS NULL);

DELETE FROM warehouse_estantes WHERE "corredorId" IS NULL;

ALTER TABLE warehouse_estantes DROP CONSTRAINT IF EXISTS "warehouse_estantes_setorId_fkey";
ALTER TABLE warehouse_estantes DROP CONSTRAINT IF EXISTS "warehouse_estantes_tenantId_setorId_code_key";
DROP INDEX IF EXISTS "warehouse_estantes_setorId_idx";
ALTER TABLE warehouse_estantes DROP COLUMN IF EXISTS "setorId";

ALTER TABLE warehouse_estantes ALTER COLUMN "corredorId" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'warehouse_estantes_corredorId_fkey'
  ) THEN
    ALTER TABLE warehouse_estantes
      ADD CONSTRAINT "warehouse_estantes_corredorId_fkey"
      FOREIGN KEY ("corredorId") REFERENCES warehouse_corredores(id)
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "warehouse_estantes_tenantId_corredorId_code_key"
  ON warehouse_estantes("tenantId", "corredorId", code);
CREATE INDEX IF NOT EXISTS "warehouse_estantes_corredorId_idx"
  ON warehouse_estantes("corredorId");

-- 2) Colunas: prateleiraId → estanteId
ALTER TABLE warehouse_colunas ADD COLUMN IF NOT EXISTS "estanteId" TEXT;

UPDATE warehouse_colunas col
SET "estanteId" = p."estanteId"
FROM warehouse_prateleiras p
WHERE col."prateleiraId" = p.id AND col."estanteId" IS NULL;

DELETE FROM locations WHERE "colunaId" IN (
  SELECT id FROM warehouse_colunas WHERE "estanteId" IS NULL
);
DELETE FROM warehouse_colunas WHERE "estanteId" IS NULL;

ALTER TABLE warehouse_colunas DROP CONSTRAINT IF EXISTS "warehouse_colunas_prateleiraId_fkey";
ALTER TABLE warehouse_colunas DROP CONSTRAINT IF EXISTS "warehouse_colunas_tenantId_prateleiraId_code_key";
DROP INDEX IF EXISTS "warehouse_colunas_prateleiraId_idx";
ALTER TABLE warehouse_colunas DROP COLUMN IF EXISTS "prateleiraId";

ALTER TABLE warehouse_colunas ALTER COLUMN "estanteId" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'warehouse_colunas_estanteId_fkey'
  ) THEN
    ALTER TABLE warehouse_colunas
      ADD CONSTRAINT "warehouse_colunas_estanteId_fkey"
      FOREIGN KEY ("estanteId") REFERENCES warehouse_estantes(id)
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "warehouse_colunas_tenantId_estanteId_code_key"
  ON warehouse_colunas("tenantId", "estanteId", code);
CREATE INDEX IF NOT EXISTS "warehouse_colunas_estanteId_idx"
  ON warehouse_colunas("estanteId");

-- 3) Linhas
CREATE TABLE IF NOT EXISTS warehouse_linhas (
  id TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "colunaId" TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT,
  "pickOrder" INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT warehouse_linhas_pkey PRIMARY KEY (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS "warehouse_linhas_tenantId_colunaId_code_key"
  ON warehouse_linhas("tenantId", "colunaId", code);
CREATE INDEX IF NOT EXISTS "warehouse_linhas_tenantId_idx" ON warehouse_linhas("tenantId");
CREATE INDEX IF NOT EXISTS "warehouse_linhas_colunaId_idx" ON warehouse_linhas("colunaId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'warehouse_linhas_tenantId_fkey'
  ) THEN
    ALTER TABLE warehouse_linhas
      ADD CONSTRAINT "warehouse_linhas_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES tenants(id)
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'warehouse_linhas_colunaId_fkey'
  ) THEN
    ALTER TABLE warehouse_linhas
      ADD CONSTRAINT "warehouse_linhas_colunaId_fkey"
      FOREIGN KEY ("colunaId") REFERENCES warehouse_colunas(id)
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 4) Locations
ALTER TABLE locations ADD COLUMN IF NOT EXISTS "linhaId" TEXT;

ALTER TABLE locations DROP CONSTRAINT IF EXISTS "locations_fileiraId_fkey";
ALTER TABLE locations DROP CONSTRAINT IF EXISTS "locations_prateleiraId_fkey";
ALTER TABLE locations DROP COLUMN IF EXISTS "fileiraId";
ALTER TABLE locations DROP COLUMN IF EXISTS "prateleiraId";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'locations_linhaId_fkey'
  ) THEN
    ALTER TABLE locations
      ADD CONSTRAINT "locations_linhaId_fkey"
      FOREIGN KEY ("linhaId") REFERENCES warehouse_linhas(id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 5) Remove tabelas antigas
DROP TABLE IF EXISTS warehouse_fileiras CASCADE;
DROP TABLE IF EXISTS warehouse_prateleiras CASCADE;

COMMIT;
