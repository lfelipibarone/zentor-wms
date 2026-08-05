"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { fetchUnassignedPickFaceProducts } from "@/lib/api/operations";
import { cn } from "@/lib/utils";
import type { TileOption } from "@/components/warehouse/warehouse-tile-picker";

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

export function WarehouseSkuSearchSelect({
  title,
  description,
  value,
  onChange,
  includeProduct,
  placeholder = "Buscar SKU ou nome…",
  emptyMessage = "Nenhum produto encontrado",
}: {
  title: string;
  description?: string;
  value: string;
  onChange: (id: string) => void;
  /** Mantém o SKU já vinculado visível na edição. */
  includeProduct?: { id: string; sku: string; name: string | null };
  placeholder?: string;
  emptyMessage?: string;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedRef = useRef<TileOption | null>(null);
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
    fetchUnassignedPickFaceProducts({
      q: debouncedQuery,
      pageSize: 100,
      scope: "catalog",
    })
      .then((data) => {
        if (cancelled) return;
        const mapped = data.products
          .filter((p) => p.id)
          .map((p) => ({
            id: p.id!,
            primary: p.sku,
            secondary: p.name,
          }));
        setOptions(mapped);
        setTotal(data.total);
      })
      .catch(() => {
        if (!cancelled) {
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
  }, [debouncedQuery]);

  const displayOptions = useMemo(() => {
    if (!includeProduct) return options;
    if (options.some((o) => o.id === includeProduct.id)) return options;
    return [
      {
        id: includeProduct.id,
        primary: includeProduct.sku,
        secondary: includeProduct.name,
      },
      ...options,
    ];
  }, [options, includeProduct]);

  const selected = useMemo(() => {
    const fromOptions = displayOptions.find((o) => o.id === value);
    if (fromOptions) {
      selectedRef.current = fromOptions;
      return fromOptions;
    }
    if (selectedRef.current?.id === value) return selectedRef.current;
    if (includeProduct?.id === value) {
      return {
        id: includeProduct.id,
        primary: includeProduct.sku,
        secondary: includeProduct.name,
      };
    }
    return undefined;
  }, [displayOptions, value, includeProduct]);

  useEffect(() => {
    if (!value) selectedRef.current = null;
  }, [value]);

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
    total > displayOptions.length
      ? `Mostrando ${displayOptions.length} de ${total} — digite para buscar`
      : displayOptions.length > 0
        ? `${displayOptions.length} produto${displayOptions.length === 1 ? "" : "s"}`
        : null;

  return (
    <section className="space-y-2" ref={rootRef}>
      <PickerHeader title={title} description={description} />
      <div className="relative">
        <button
          type="button"
          onClick={() => {
            setOpen((v) => !v);
            setTimeout(() => inputRef.current?.focus(), 0);
          }}
          className={cn(
            "flex w-full items-center gap-2 rounded-xl border bg-white px-3 py-2.5 text-left shadow-sm transition",
            open ? "border-[#0d9488] ring-1 ring-[#0d9488]/30" : "border-slate-200 hover:border-slate-300",
          )}
        >
          <div className="min-w-0 flex-1">
            {selected ? (
              <>
                <span className="block truncate font-mono text-sm font-semibold text-slate-900">
                  {selected.primary}
                </span>
                {selected.secondary ? (
                  <span className="block truncate text-xs text-slate-500">
                    {selected.secondary}
                  </span>
                ) : null}
              </>
            ) : (
              <span className="text-sm text-slate-400">Selecione…</span>
            )}
          </div>
          <ChevronDown
            className={cn("h-4 w-4 shrink-0 text-slate-400 transition", open && "rotate-180")}
          />
        </button>

        {open ? (
          <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
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
              ) : displayOptions.length === 0 ? (
                <li className="px-3 py-4 text-center text-sm text-slate-500">
                  {emptyMessage}
                </li>
              ) : (
                displayOptions.map((opt) => {
                  const isSelected = value === opt.id;
                  return (
                    <li key={opt.id} role="option" aria-selected={isSelected}>
                      <button
                        type="button"
                        onClick={() => {
                          selectedRef.current = opt;
                          onChange(opt.id);
                          setOpen(false);
                        }}
                        className={cn(
                          "flex w-full flex-col items-start px-3 py-2 text-left text-sm transition",
                          isSelected
                            ? "bg-[#0d9488]/10 text-[#0d9488]"
                            : "hover:bg-slate-50",
                        )}
                      >
                        <span className="font-mono font-semibold">{opt.primary}</span>
                        {opt.secondary ? (
                          <span className="text-xs text-slate-500">{opt.secondary}</span>
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
