type SessionExpiredHandler = () => void;

let onExpired: SessionExpiredHandler | null = null;

export function registerSessionExpiredHandler(
  handler: SessionExpiredHandler,
): () => void {
  onExpired = handler;
  return () => {
    if (onExpired === handler) onExpired = null;
  };
}

export function notifySessionExpired(): void {
  onExpired?.();
}
