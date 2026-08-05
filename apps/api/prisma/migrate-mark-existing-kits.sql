-- Marca kits já importados antes do filtro de tipo (heurística por SKU/nome).
-- Após isso, o sync Tiny mantém tinyTipo atualizado pela API.

UPDATE products
SET
  "tinyTipo" = 'K',
  active = false
WHERE
  "tinyTipo" IS NULL
  AND (
    sku ILIKE 'KIT%'
    OR sku ILIKE 'KIT-%'
    OR sku ILIKE 'KIT\_%'
    OR name ILIKE 'KIT %'
    OR name ILIKE 'KIT-%'
    OR name ILIKE '% KIT %'
    OR name ILIKE '% (KIT)%'
  );
