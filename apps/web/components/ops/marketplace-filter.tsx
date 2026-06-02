"use client";

import { useEffect, useState } from "react";
import { formatMarketplace } from "@wms/shared";
import { fetchAvailableMarketplaces } from "@/lib/api/operations";

export function MarketplaceFilter({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const [options, setOptions] = useState<
    Array<{ value: string; label: string }>
  >([]);

  useEffect(() => {
    fetchAvailableMarketplaces()
      .then((d) => setOptions(d.marketplaces))
      .catch(() => setOptions([]));
  }, []);

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={
        className ??
        "rounded-lg border bg-white px-3 py-2 text-sm min-w-[10rem]"
      }
    >
      <option value="">Todos os marketplaces</option>
      <option value="SEM_MARKETPLACE">Sem marketplace</option>
      <option value="OUTROS">Outros (não mapeados)</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
