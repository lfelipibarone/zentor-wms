"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import {
  fetchWarehouseItems,
  type WarehouseSegment,
} from "@/lib/api/warehouse";
import {
  segmentItemToTile,
  type WarehouseSegmentPathItem,
} from "@/lib/warehouse-segment-path";
import { cn } from "@/lib/utils";
import type { TileOption } from "@/components/warehouse/warehouse-tile-picker";

const SEGMENT_RESPONSE_KEY: Record<WarehouseSegment, string> = {
  barracoes: "barracoes",
  setores: "setores",
  corredores: "corredores",
  estantes: "estantes",
  colunas: "colunas",
  linhas: "linhas",
};

function PickerHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      {description ? (
        <p className="mt-0.5 text-xs text-slate-500">{description}</p>
      ) : null}
    </div>
  );
}

export function WarehouseLevelSearchSelect({
  segment,
  title,
  description,
  value,
  onChange,
  placeholder = "Buscar…",
  emptyMessage = "Nenhum resultado",
  displaySelected,
  availableOnly = false,
  parentId,
  compact = false,
}: {
  segment: WarehouseSegment;
  title: string;
  description?: string;
  value: string;
  onChange: (id: string, item: WarehouseSegmentPathItem | null) => void;
  placeholder?: string;
  emptyMessage?: string;
  displaySelected?: { primary: string; secondary?: string } | null;
  /** Linhas sem posição cadastrada (legado). */
  availableOnly?: boolean;
  /** Filtra pelo nível pai (ex.: setores do barracão). */
  parentId?: string;
  compact?: boolean;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef<Map<string, WarehouseSegmentPathItem>>(new Map());
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [options, setOptions] = useState<TileOption[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchWarehouseItems(segment, {
      q: debouncedQuery || undefined,
      pageSize: 100,
      parentId: parentId || undefined,
      availableOnly: segment === "linhas" ? availableOnly : undefined,
    })
      .then((data) => {
        if (cancelled) return;
        const key = SEGMENT_RESPONSE_KEY[segment];
        const items = (data[key] ?? []) as WarehouseSegmentPathItem[];
        const map = new Map<string, WarehouseSegmentPathItem>();
        const tiles = items.map((item) => {
          map.set(item.id, item);
          return segmentItemToTile(segment, item);
        });
        itemsRef.current = map;
        setOptions(tiles);
        setTotal(data.pagination?.total ?? tiles.length);
      })
      .catch(() => {
        if (!cancelled) {
          itemsRef.current = new Map();
          setOptions([]);
          setTotal(0);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [segment, debouncedQuery, availableOnly, parentId]);

  const selected = useMemo(() => {
    if (value) {
      const fromOptions = options.find((o) => o.id === value);
      if (fromOptions) return fromOptions;
      const cached = itemsRef.current.get(value);
      if (cached) return segmentItemToTile(segment, cached);
    }
    return undefined;
  }, [options, value, segment]);

  const buttonLabel = selected ?? (!value ? displaySelected : null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const footer =
    total > options.length
      ? `Mostrando ${options.length} de ${total} — digite para buscar`
      : options.length > 0
        ? `${options.length} resultado${options.length === 1 ? "" : "s"}`
        : null;

  return (
    <section
      className={cn("space-y-2", compact && "min-w-[9rem] flex-1")}
      ref={rootRef}
    >
      {!compact ? <PickerHeader title={title} description={description} /> : null}
      <div className="relative">
        <button
          type="button"
          onClick={() => {
            setOpen((v) => !v);
            setTimeout(() => inputRef.current?.focus(), 0);
          }}
          className={cn(
            "flex w-full items-center gap-2 rounded-xl border bg-white px-3 py-2.5 text-left shadow-sm transition",
            compact && "py-2",
            open
              ? "border-[#0d9488] ring-1 ring-[#0d9488]/30"
              : "border-slate-200 hover:border-slate-300",
          )}
        >
          <div className="min-w-0 flex-1">
            {buttonLabel ? (
              <>
                <span className="block truncate font-mono text-sm font-semibold text-slate-900">
                  {buttonLabel.primary}
                </span>
                {buttonLabel.secondary ? (
                  <span className="block truncate text-xs text-slate-500">
                    {buttonLabel.secondary}
                  </span>
                ) : null}
              </>
            ) : (
              <span className="text-sm text-slate-400">Selecione…</span>
            )}
          </div>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-slate-400 transition",
              open && "rotate-180",
            )}
          />
        </button>

        {open ? (
          <div className="absolute z-30 mt-1 w-full min-w-[14rem] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
            <div className="flex items-center gap-2 border-b px-3 py-2">
              <Search className="h-4 w-4 shrink-0 text-slate-400" />
              <input
                ref={inputRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={placeholder}
                className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
                autoComplete="off"
              />
            </div>
            <ul id={listId} role="listbox" className="max-h-60 overflow-y-auto py-1">
              {loading ? (
                <li className="px-3 py-4 text-center text-sm text-slate-500">
                  Buscando…
                </li>
              ) : options.length === 0 ? (
                <li className="px-3 py-4 text-center text-sm text-slate-500">
                  {emptyMessage}
                </li>
              ) : (
                options.map((opt) => {
                  const isSelected = value === opt.id;
                  const disabled = opt.disabled;
                  return (
                    <li key={opt.id} role="option" aria-selected={isSelected}>
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => {
                          if (disabled) return;
                          onChange(opt.id, itemsRef.current.get(opt.id) ?? null);
                          setOpen(false);
                        }}
                        className={cn(
                          "flex w-full flex-col items-start px-3 py-2 text-left text-sm transition",
                          disabled
                            ? "cursor-not-allowed opacity-50"
                            : isSelected
                              ? "bg-[#0d9488]/10 text-[#0d9488]"
                              : "hover:bg-slate-50",
                        )}
                      >
                        <span className="font-mono font-semibold">{opt.primary}</span>
                        {opt.secondary ? (
                          <span className="text-xs text-slate-500">{opt.secondary}</span>
                        ) : null}
                        {opt.disabledHint ? (
                          <span className="text-xs text-amber-700">{opt.disabledHint}</span>
                        ) : null}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
            {footer ? (
              <p className="border-t px-3 py-1.5 text-xs text-slate-500">{footer}</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
