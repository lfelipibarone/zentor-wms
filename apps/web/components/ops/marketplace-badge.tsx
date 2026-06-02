import {
  formatMarketplace,
  MARKETPLACE_BADGE,
  normalizeMarketplace,
} from "@wms/shared";

export function MarketplaceBadge({
  value,
}: {
  value: string | null | undefined;
}) {
  if (!value?.trim()) {
    return <span className="text-muted-foreground">—</span>;
  }
  const code = normalizeMarketplace(value);
  const colors = code
    ? MARKETPLACE_BADGE[code]
    : { bg: "bg-slate-100", text: "text-slate-700" };
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${colors.bg} ${colors.text}`}
    >
      {formatMarketplace(value)}
    </span>
  );
}
