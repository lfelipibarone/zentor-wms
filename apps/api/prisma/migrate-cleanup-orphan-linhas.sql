-- Remove linhas sem posição (Location) vinculada.
DELETE FROM "WarehouseLinha"
WHERE "id" NOT IN (
  SELECT "linhaId" FROM "Location" WHERE "linhaId" IS NOT NULL
);

-- Limpeza opcional de estrutura vazia (execute após o DELETE acima).
DELETE FROM "WarehouseColuna" c
WHERE NOT EXISTS (SELECT 1 FROM "WarehouseLinha" l WHERE l."colunaId" = c."id");

DELETE FROM "WarehouseEstante" e
WHERE NOT EXISTS (SELECT 1 FROM "WarehouseColuna" c WHERE c."estanteId" = e."id");

DELETE FROM "WarehouseCorredor" c
WHERE NOT EXISTS (SELECT 1 FROM "WarehouseEstante" e WHERE e."corredorId" = c."id");

DELETE FROM "WarehouseSetor" s
WHERE NOT EXISTS (SELECT 1 FROM "WarehouseCorredor" c WHERE c."setorId" = s."id");
