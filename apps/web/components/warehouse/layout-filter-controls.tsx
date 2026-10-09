"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Search } from "lucide-react";
import type { WarehouseLayoutEstante } from "@/lib/api/warehouse";
import { cn } from "@/lib/utils";

const collator = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

export function FilterButton({
  label,
  value,
  active,
  disabled,
  open,
  onClick,
  className,
}: {
  label: string;
  value: ReactNode;
  active?: boolean;
  disabled?: boolean;
  open?: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm transition disabled:cursor-not-allowed disabled:opacity-50",
        active
          ? "border-[#0d9488] bg-teal-50 text-[#0f766e]"
          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300",
        open && "ring-2 ring-teal-100",
        className,
      )}
    >
      <span className={cn("text-xs", active ? "text-teal-700/70" : "text-slate-500")}>{label}</span>
      <span className="font-semibold">{value}</span>
      <ChevronDown className="h-3.5 w-3.5 opacity-60" />
    </button>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ id: T; label: ReactNode; title?: string }>;
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="inline-flex h-9 items-center rounded-lg bg-slate-100 p-0.5">
      {options.map((opt) => (
        <button
          key={opt.id || "all"}
          type="button"
          title={opt.title}
          onClick={() => onChange(opt.id)}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition",
            value === opt.id
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-500 hover:text-slate-800",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function SelectDropdown({
  label,
  value,
  options,
  onChange,
  disabled,
  placeholder = "Todas",
  allowEmpty = true,
}: {
  label: string;
  value: string;
  options: Array<{ id: string; label: string }>;
  onChange: (id: string) => void;
  disabled?: boolean;
  placeholder?: string;
  allowEmpty?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const selected = options.find((o) => o.id === value);
  const items = allowEmpty ? [{ id: "", label: placeholder }, ...options] : options;
  return (
    <div ref={ref} className="relative">
      <FilterButton
        label={label}
        value={selected?.label ?? placeholder}
        active={allowEmpty && !!value}
        disabled={disabled}
        open={open}
        onClick={() => setOpen((v) => !v)}
      />
      {open ? (
        <div className="absolute left-0 top-full z-30 mt-1 max-h-72 min-w-full overflow-auto rounded-xl border bg-white p-1 shadow-lg">
          {items.map((o) => (
            <button
              key={o.id || "all"}
              type="button"
              onClick={() => {
                onChange(o.id);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center justify-between gap-4 whitespace-nowrap rounded-lg px-3 py-1.5 text-left text-sm hover:bg-slate-50",
                value === o.id ? "font-semibold text-[#0f766e]" : "text-slate-700",
              )}
            >
              {o.label}
              {value === o.id ? <Check className="h-4 w-4" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function EstantePicker({
  estantes,
  value,
  onChange,
  allowAll,
}: {
  estantes: WarehouseLayoutEstante[];
  value: string;
  onChange: (id: string) => void;
  allowAll: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useDismiss(open, () => setOpen(false));
  const inputRef = useRef<HTMLInputElement>(null);

  const sorted = useMemo(
    () => [...estantes].sort((a, b) => collator.compare(a.label, b.label)),
    [estantes],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? sorted.filter((e) => e.label.toLowerCase().includes(q)) : sorted;
  }, [sorted, query]);

  const index = sorted.findIndex((e) => e.id === value);
  const selected = index >= 0 ? sorted[index] : null;

  useEffect(() => {
    if (open) {
      setQuery("");
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  const step = (delta: number) => {
    if (sorted.length === 0) return;
    const next = index < 0 ? 0 : (index + delta + sorted.length) % sorted.length;
    onChange(sorted[next].id);
  };

  return (
    <div ref={ref} className="relative flex items-center gap-1">
      {!allowAll ? (
        <button
          type="button"
          onClick={() => step(-1)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-slate-300"
          aria-label="Estante anterior"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      ) : null}
      <FilterButton
        label="Estante"
        value={
          selected ? (
            <span className="inline-flex items-center gap-1.5 font-mono">
              {selected.label}
              {selected.abaixoMin > 0 ? (
                <span className="rounded-full bg-amber-400 px-1.5 font-sans text-[11px] font-bold text-amber-950">
                  {selected.abaixoMin}
                </span>
              ) : null}
            </span>
          ) : (
            `Todas (${sorted.length})`
          )
        }
        active={!!selected && allowAll}
        open={open}
        onClick={() => setOpen((v) => !v)}
      />
      {!allowAll ? (
        <button
          type="button"
          onClick={() => step(1)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-slate-300"
          aria-label="Próxima estante"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      ) : null}

      {open ? (
        <div className="absolute left-0 top-full z-30 mt-1 w-[340px] rounded-xl border bg-white p-2 shadow-lg">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && filtered[0]) pick(filtered[0].id);
              }}
              placeholder="Buscar estante…"
              className="h-9 w-full rounded-lg border border-slate-200 pl-8 pr-3 text-sm outline-none focus:border-[#0d9488]"
            />
          </div>
          {allowAll ? (
            <button
              type="button"
              onClick={() => pick("")}
              className={cn(
                "mt-2 w-full rounded-lg px-3 py-1.5 text-left text-sm hover:bg-slate-50",
                !value ? "font-semibold text-[#0f766e]" : "text-slate-700",
              )}
            >
              Todas as estantes
            </button>
          ) : null}
          <div className="mt-2 grid max-h-64 grid-cols-4 gap-1 overflow-auto">
            {filtered.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => pick(e.id)}
                title={`${e.total} posições · ${e.semSku} sem SKU · ${e.abaixoMin} abaixo do mínimo`}
                className={cn(
                  "relative rounded-lg border px-2 py-1.5 text-center font-mono text-sm font-medium transition",
                  e.id === value
                    ? "border-slate-800 bg-slate-800 text-white"
                    : "border-slate-200 text-slate-700 hover:border-[#0d9488] hover:text-[#0f766e]",
                )}
              >
                {e.label}
                {e.abaixoMin > 0 ? (
                  <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-amber-400 px-1 font-sans text-[10px] font-bold leading-[18px] text-amber-950">
                    {e.abaixoMin}
                  </span>
                ) : null}
              </button>
            ))}
            {filtered.length === 0 ? (
              <p className="col-span-4 py-3 text-center text-sm text-slate-500">
                Nenhuma estante
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function MenuDropdown({
  label,
  icon,
  items,
}: {
  label: string;
  icon?: ReactNode;
  items: Array<{ id: string; label: string; icon?: ReactNode; href?: string; onClick?: () => void }>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:border-slate-400"
      >
        {icon}
        {label}
        <ChevronDown className="h-3.5 w-3.5 opacity-60" />
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-30 mt-1 min-w-[220px] rounded-xl border bg-white p-1 shadow-lg">
          {items.map((item) => {
            const content = (
              <>
                <span className="text-slate-500">{item.icon}</span>
                {item.label}
              </>
            );
            const cls =
              "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50";
            return item.href ? (
              <Link key={item.id} href={item.href} className={cls} onClick={() => setOpen(false)}>
                {content}
              </Link>
            ) : (
              <button
                key={item.id}
                type="button"
                className={cls}
                onClick={() => {
                  item.onClick?.();
                  setOpen(false);
                }}
              >
                {content}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
