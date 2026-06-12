-- Permite itens de pedido sem produto cadastrado no WMS (SKU pendente do ERP).
ALTER TABLE "order_items" ALTER COLUMN "productId" DROP NOT NULL;
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "erpSku" TEXT;
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "erpDescription" TEXT;
