-- Multiple proximity references per location

BEGIN;

CREATE TABLE IF NOT EXISTS location_proximity_references (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "proximityCorredorId" TEXT,
  "proximityEstanteId" TEXT,
  "proximityLinhaId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS location_proximity_references_tenantId_idx
  ON location_proximity_references("tenantId");
CREATE INDEX IF NOT EXISTS location_proximity_references_locationId_idx
  ON location_proximity_references("locationId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'location_proximity_references_tenantId_fkey'
  ) THEN
    ALTER TABLE location_proximity_references
      ADD CONSTRAINT location_proximity_references_tenantId_fkey
      FOREIGN KEY ("tenantId") REFERENCES tenants(id)
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'location_proximity_references_locationId_fkey'
  ) THEN
    ALTER TABLE location_proximity_references
      ADD CONSTRAINT location_proximity_references_locationId_fkey
      FOREIGN KEY ("locationId") REFERENCES locations(id)
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'location_proximity_references_proximityCorredorId_fkey'
  ) THEN
    ALTER TABLE location_proximity_references
      ADD CONSTRAINT location_proximity_references_proximityCorredorId_fkey
      FOREIGN KEY ("proximityCorredorId") REFERENCES warehouse_corredores(id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'location_proximity_references_proximityEstanteId_fkey'
  ) THEN
    ALTER TABLE location_proximity_references
      ADD CONSTRAINT location_proximity_references_proximityEstanteId_fkey
      FOREIGN KEY ("proximityEstanteId") REFERENCES warehouse_estantes(id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'location_proximity_references_proximityLinhaId_fkey'
  ) THEN
    ALTER TABLE location_proximity_references
      ADD CONSTRAINT location_proximity_references_proximityLinhaId_fkey
      FOREIGN KEY ("proximityLinhaId") REFERENCES warehouse_linhas(id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

INSERT INTO location_proximity_references (
  id,
  "tenantId",
  "locationId",
  "sortOrder",
  "proximityCorredorId",
  "proximityEstanteId",
  "proximityLinhaId",
  "createdAt",
  "updatedAt"
)
SELECT
  'lpr_' || substr(md5(l.id || '-prox'), 1, 24),
  l."tenantId",
  l.id,
  0,
  l."proximityCorredorId",
  l."proximityEstanteId",
  l."proximityLinhaId",
  NOW(),
  NOW()
FROM locations l
WHERE (
  l."proximityCorredorId" IS NOT NULL
  OR l."proximityEstanteId" IS NOT NULL
  OR l."proximityLinhaId" IS NOT NULL
)
AND NOT EXISTS (
  SELECT 1 FROM location_proximity_references r WHERE r."locationId" = l.id
);

COMMIT;
