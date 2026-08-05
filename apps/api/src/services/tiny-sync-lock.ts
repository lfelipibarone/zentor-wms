const locks = new Set<string>();

function lockKey(tenantId: string, kind: "products" | "orders"): string {
  return `${tenantId}:${kind}`;
}

export function tryAcquireTinySyncLock(
  tenantId: string,
  kind: "products" | "orders",
): boolean {
  const key = lockKey(tenantId, kind);
  if (locks.has(key)) return false;
  locks.add(key);
  return true;
}

export function releaseTinySyncLock(
  tenantId: string,
  kind: "products" | "orders",
): void {
  locks.delete(lockKey(tenantId, kind));
}

export function isTinySyncLocked(
  tenantId: string,
  kind: "products" | "orders",
): boolean {
  return locks.has(lockKey(tenantId, kind));
}
