import { resumePausedOrdersAfterPickFace } from "../src/services/product-locations.js";

const tenantId = process.argv[2];
const productId = process.argv[3];

if (!tenantId || !productId) {
  console.error("Uso: tsx scripts/resume-pick-face-orders.ts <tenantId> <productId>");
  process.exit(1);
}

const result = await resumePausedOrdersAfterPickFace(tenantId, productId);
console.log(JSON.stringify(result, null, 2));
