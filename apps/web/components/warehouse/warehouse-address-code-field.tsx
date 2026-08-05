"use client";

import { WarehouseLevelSearchSelect } from "@/components/warehouse/warehouse-level-search-select";
import type { WarehouseSegment } from "@/lib/api/warehouse";
import type { WarehouseSegmentPathItem } from "@/lib/warehouse-segment-path";

export function WarehouseAddressCodeField({
  segment,
  title,
  code,
  selectedId = "",
  onCodeChange,
  onSelect,
  parentId,
  disabled,
}: {
  segment: WarehouseSegment;
  title: string;
  code: string;
  selectedId?: string;
  onCodeChange: (code: string) => void;
  onSelect?: (item: WarehouseSegmentPathItem) => void;
  parentId?: string;
  disabled?: boolean;
}) {
  const handleSelect = (_id: string, item: WarehouseSegmentPathItem | null) => {
    if (!item) return;
    onSelect?.(item);
    onCodeChange(item.code.toUpperCase());
  };

  const displaySelected = code.trim()
    ? {
        primary: code.trim(),
        secondary: selectedId ? undefined : "Digitado manualmente",
      }
    : null;

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-slate-800">{title}</label>
      <WarehouseLevelSearchSelect
        segment={segment}
        title={`Buscar ${title.toLowerCase()}`}
        value={selectedId}
        displaySelected={displaySelected}
        onChange={handleSelect}
        placeholder={`Buscar ${title.toLowerCase()} existente…`}
        emptyMessage={`Nenhum ${title.toLowerCase()} encontrado`}
        parentId={parentId}
        compact
      />
      <label className="block text-xs text-slate-500">
        Ou digite o {title.toLowerCase()}
        <input
          className="mt-1 w-full rounded-lg border px-3 py-2 font-mono uppercase disabled:bg-slate-50"
          value={code}
          onChange={(e) => onCodeChange(e.target.value.toUpperCase())}
          placeholder={title}
          disabled={disabled}
        />
      </label>
    </div>
  );
}
