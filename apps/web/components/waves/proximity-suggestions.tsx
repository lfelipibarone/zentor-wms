"use client";

import { useState } from "react";
import { Check, Clock, MapPin, Route } from "lucide-react";
import { MarketplaceBadge } from "@/components/ops/marketplace-badge";
import type { PickProximityGroup } from "@/lib/api/operations";
import { cn } from "@/lib/utils";

const COLLAPSED_COUNT = 6;
const VISIBLE_ORDERS = 3;

function formatDeadline(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function GroupCard({
  group,
  active,
  onSelect,
}: {
  group: PickProximityGroup;
  active: boolean;
  onSelect: () => void;
}) {
  const [showOrders, setShowOrders] = useState(false);
  const marketplaces = [...new Set(group.orders.map((o) => o.marketplace ?? ""))];
  const overdue =
    group.earliestDeadline != null && new Date(group.earliestDeadline).getTime() < Date.now();
  const orders = showOrders ? group.orders : group.orders.slice(0, VISIBLE_ORDERS);
  const hidden = group.orders.length - VISIBLE_ORDERS;

  const stats = [
    `${group.orders.length} pedido${group.orders.length === 1 ? "" : "s"}`,
    group.units ? `${group.units} un.` : null,
    group.locationCount
      ? `${group.locationCount} gôndola${group.locationCount === 1 ? "" : "s"}`
      : null,
  ].filter(Boolean);

  return (
    <div
      className={cn(
        "rounded-xl border bg-white p-3 transition",
        active ? "border-[#0d9488] bg-teal-50/40 ring-2 ring-[#0d9488]/20" : "hover:border-slate-300",
      )}
    >
      <div className="flex items-start gap-2">
        <MapPin
          className={cn(
            "mt-0.5 h-4 w-4 shrink-0",
            group.routeHint ? "text-[#0d9488]" : "text-slate-400",
          )}
        />
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "truncate text-sm font-semibold",
              group.routeHint ? "text-slate-900" : "font-medium italic text-slate-500",
            )}
            title={group.routeHint ?? undefined}
          >
            {group.routeHint ?? "Sem gôndola definida"}
          </p>
          <p className="text-xs text-slate-500">{stats.join(" · ")}</p>
        </div>
        <button
          type="button"
          onClick={onSelect}
          className={cn(
            "inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2.5 text-xs font-semibold transition",
            active
              ? "bg-[#0d9488] text-white hover:bg-[#0b7f75]"
              : "border border-slate-200 text-slate-700 hover:border-[#0d9488] hover:text-[#0d9488]",
          )}
          title={active ? "Desfazer seleção" : "Selecionar estes pedidos"}
        >
          {active ? (
            <>
              <Check className="h-3.5 w-3.5" />
              Selecionado
            </>
          ) : (
            "Selecionar"
          )}
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-6">
        {marketplaces.map((m) => (
          <MarketplaceBadge key={m || "none"} value={m || null} />
        ))}
        {group.earliestDeadline ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 text-xs",
              overdue ? "font-semibold text-red-600" : "text-slate-500",
            )}
            title={overdue ? "Prazo de coleta vencido" : "Prazo de coleta mais próximo"}
          >
            <Clock className="h-3.5 w-3.5" />
            {formatDeadline(group.earliestDeadline)}
          </span>
        ) : null}
      </div>

      <div className="mt-1.5 flex flex-wrap gap-1 pl-6">
        {orders.map((o) => (
          <span
            key={o.id}
            title={o.customerName ?? undefined}
            className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600"
          >
            {o.erpOrderId}
          </span>
        ))}
        {hidden > 0 ? (
          <button
            type="button"
            onClick={() => setShowOrders((v) => !v)}
            className="rounded px-1.5 py-0.5 text-[11px] font-medium text-[#0d9488] hover:bg-teal-50"
          >
            {showOrders ? "menos" : `+${hidden}`}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function ProximitySuggestions({
  groups,
  activeGroupId,
  onSelect,
}: {
  groups: PickProximityGroup[];
  activeGroupId: string | null;
  onSelect: (group: PickProximityGroup) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (groups.length === 0) return null;

  const visible = expanded ? groups : groups.slice(0, COLLAPSED_COUNT);
  const activeHidden =
    !expanded && activeGroupId != null && !visible.some((g) => g.id === activeGroupId);

  return (
    <section className="rounded-xl border bg-slate-50/70 p-4">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Route className="h-4 w-4 text-[#0d9488]" />
            Sugestões de proximidade
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Pedidos cujos itens ficam perto um do outro no galpão. Selecione um grupo para montar a
            onda.
          </p>
        </div>
        {groups.length > COLLAPSED_COUNT ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-sm font-medium text-[#0d9488] hover:underline"
          >
            {expanded ? "Mostrar menos" : `Ver todas (${groups.length})`}
            {activeHidden ? " · selecionado oculto" : ""}
          </button>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((g) => (
          <GroupCard
            key={g.id}
            group={g}
            active={g.id === activeGroupId}
            onSelect={() => onSelect(g)}
          />
        ))}
      </div>
    </section>
  );
}
