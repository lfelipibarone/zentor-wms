"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export type TileOption = {
  id: string;
  primary: string;
  secondary?: string | null;
  disabled?: boolean;
  disabledHint?: string;
};

const TILE_THRESHOLD = 6;

export function splitPathLabel(label: string): { primary: string; secondary: string | null } {
  const parts = label.split(" / ").map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) {
    return { primary: label, secondary: null };
  }
  return {
    primary: parts[parts.length - 1]!,
    secondary: parts.slice(0, -1).join(" / "),
  };
}

function optionSearchText(opt: TileOption): string {
  return [opt.primary, opt.secondary, opt.disabledHint]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function WarehouseSearchSelect({
  title,
  description,
  options,
  value,
  onChange,
  placeholder = "Buscar…",
  emptyMessage,
  compact = false,
}: {
  title: string;
  description?: string;
  options: TileOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  emptyMessage?: string;
  compact?: boolean;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const enabledOptions = options.filter((o) => !o.disabled);
  const selected = options.find((o) => o.id === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return enabledOptions;
    return enabledOptions.filter((o) => optionSearchText(o).includes(q));
  }, [enabledOptions, query]);

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

  if (options.length === 0) {
    return (
      <section className="space-y-2">
        {!compact ? <PickerHeader title={title} description={description} /> : null}
        <p
          className={cn(
            "rounded-xl border border-dashed bg-slate-50 text-center text-sm text-slate-500",
            compact ? "px-2 py-3 text-xs" : "px-4 py-6",
          )}
        >
          {emptyMessage ?? "Nenhuma opção disponível"}
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-2" ref={rootRef}>
      {!compact ? <PickerHeader title={title} description={description} /> : null}
      <div className="relative">
        <button
          type="button"
          onClick={() => {
            setOpen((v) => !v);
            setTimeout(() => inputRef.current?.focus(), 0);
          }}
          className={cn(
            "flex w-full items-center gap-2 rounded-xl border bg-white text-left shadow-sm transition",
            compact ? "px-2 py-2" : "px-3 py-2.5",
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
            <ul
              id={listId}
              role="listbox"
              className="max-h-60 overflow-y-auto py-1"
            >
              {filtered.length === 0 ? (
                <li className="px-3 py-4 text-center text-sm text-slate-500">
                  Nenhum resultado
                </li>
              ) : (
                filtered.map((opt) => {
                  const isSelected = value === opt.id;
                  return (
                    <li key={opt.id} role="option" aria-selected={isSelected}>
                      <button
                        type="button"
                        onClick={() => {
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
            {enabledOptions.length > TILE_THRESHOLD ? (
              <p className="border-t px-3 py-1.5 text-xs text-slate-500">
                {filtered.length} de {enabledOptions.length} opções
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** Tiles para poucas opções; dropdown com busca quando a lista é grande. */
export function WarehouseOptionPicker({
  title,
  description,
  options,
  value,
  onChange,
  emptyMessage,
  searchPlaceholder,
  preferSearch,
  compact,
}: {
  title: string;
  description?: string;
  options: TileOption[];
  value: string;
  onChange: (id: string) => void;
  emptyMessage?: string;
  searchPlaceholder?: string;
  /** Força dropdown mesmo com poucas opções (ex.: proximidade com caminho longo). */
  preferSearch?: boolean;
  compact?: boolean;
}) {
  if (!preferSearch && options.length <= TILE_THRESHOLD) {
    return (
      <WarehouseTilePicker
        title={title}
        description={description}
        options={options}
        value={value}
        onChange={onChange}
        emptyMessage={emptyMessage}
        compact={compact}
      />
    );
  }
  return (
    <WarehouseSearchSelect
      title={title}
      description={description}
      options={options}
      value={value}
      onChange={onChange}
      emptyMessage={emptyMessage}
      placeholder={searchPlaceholder}
      compact={compact}
    />
  );
}

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

export function WarehouseTilePicker({  title,
  description,
  options,
  value,
  onChange,
  emptyMessage,
  compact = false,
}: {
  title: string;
  description?: string;
  options: TileOption[];
  value: string;
  onChange: (id: string) => void;
  emptyMessage?: string;
  compact?: boolean;
}) {
  if (options.length === 0) {
    return (
      <section className="space-y-2">
        {!compact ? (
          <div>
            <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
            {description ? (
              <p className="mt-0.5 text-xs text-slate-500">{description}</p>
            ) : null}
          </div>
        ) : null}
        <p className="rounded-xl border border-dashed bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
          {emptyMessage ?? "Nenhuma opção disponível"}
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      {!compact ? (
        <div>
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
          {description ? (
            <p className="mt-0.5 text-xs text-slate-500">{description}</p>
          ) : null}
        </div>
      ) : null}
      <div
        className={cn(
          "grid gap-2",
          compact ? "grid-cols-1" : "grid-cols-2 sm:grid-cols-3",
        )}
      >
        {options.map((opt) => {
          const selected = value === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              disabled={opt.disabled}
              onClick={() => onChange(opt.id)}
              className={cn(
                "flex flex-col items-start justify-center rounded-xl border-2 px-3 py-3 text-left transition",
                compact ? "min-h-[3.25rem] py-2" : "min-h-[4.5rem]",
                opt.disabled
                  ? "cursor-not-allowed border-slate-100 bg-slate-50 opacity-50"
                  : selected
                    ? "border-[#0d9488] bg-[#0d9488]/5 shadow-sm ring-1 ring-[#0d9488]/30"
                    : "border-slate-200 bg-white hover:border-[#0d9488]/40 hover:bg-slate-50",
              )}
            >
              <span
                className={cn(
                  "font-mono text-sm font-semibold leading-tight",
                  selected ? "text-[#0d9488]" : "text-slate-900",
                )}
              >
                {opt.primary}
              </span>
              {opt.secondary ? (
                <span className="mt-1 line-clamp-2 text-[11px] leading-snug text-slate-500">
                  {opt.secondary}
                </span>
              ) : null}
              {opt.disabled && opt.disabledHint ? (
                <span className="mt-1 text-[10px] text-slate-400">{opt.disabledHint}</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function WarehouseFormStep({
  step,
  title,
  children,
  visible = true,
  layout = "stacked",
}: {
  step: number;
  title: string;
  children: React.ReactNode;
  visible?: boolean;
  layout?: "stacked" | "column";
}) {
  if (!visible) return null;
  if (layout === "column") {
    return (
      <div className="flex min-w-[9.5rem] flex-1 flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50/50 p-3">
        <div className="flex items-center gap-1.5">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#0d9488] text-[10px] font-bold text-white">
            {step}
          </span>
          <h2 className="text-xs font-semibold text-slate-800">{title}</h2>
        </div>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    );
  }
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/50 p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#0d9488] text-xs font-bold text-white">
          {step}
        </span>
        <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
      </div>
      {children}
    </div>
  );
}
