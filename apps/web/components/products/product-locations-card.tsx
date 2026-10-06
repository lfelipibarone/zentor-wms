"use client";

import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  assignProductLocation,
  searchLocations,
  unassignProductLocation,
  type LocationOption,
  type ProductDetail,
} from "@/lib/api/products";

const TYPE_LABEL = { PICK_FACE: "Gôndola", PULMAO: "Pulmão" } as const;

export function ProductLocationsCard({
  product,
  onChanged,
}: {
  product: ProductDetail;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<LocationOption[]>([]);
  const [searchedQuery, setSearchedQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (!adding || q.length < 2) {
      setOptions([]);
      return;
    }
    const t = setTimeout(() => {
      searchLocations(q, "PICK_FACE")
        .then((r) => setOptions(r.locations))
        .catch(() => setOptions([]))
        .finally(() => setSearchedQuery(q));
    }, 250);
    return () => clearTimeout(t);
  }, [query, adding]);

  const run = async (action: () => Promise<string>) => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ kind: "ok", text: await action() });
      onChanged();
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "Erro" });
    } finally {
      setBusy(false);
    }
  };

  const assign = (loc: LocationOption) => {
    const taken = loc.product && loc.product.sku !== product.sku;
    if (taken) {
      const ok = window.confirm(
        `A posição ${loc.barcode} hoje é do SKU ${loc.product!.sku}. Trocar para ${product.sku}?`,
      );
      if (!ok) return;
    }
    void run(async () => {
      const r = await assignProductLocation(product.id, loc.id, Boolean(taken));
      setAdding(false);
      setQuery("");
      const resumed = r.resumedOrderIds.length;
      return `${loc.barcode} vinculada.${resumed ? ` ${resumed} pedido(s) pausado(s) liberado(s).` : ""}`;
    });
  };

  const unassign = (locationId: string, barcode: string) => {
    if (!window.confirm(`Desvincular ${product.sku} da posição ${barcode}?`)) return;
    void run(async () => {
      await unassignProductLocation(product.id, locationId);
      return `${barcode} desvinculada.`;
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base">Posições</CardTitle>
        {!adding ? (
          <button
            type="button"
            onClick={() => {
              setAdding(true);
              setMessage(null);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-slate-50"
          >
            <Plus className="h-4 w-4" /> Vincular posição
          </button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {adding ? (
          <div className="rounded-lg border bg-slate-50 p-3">
            <div className="flex items-center gap-2">
              <input
                autoFocus
                placeholder="Endereço da gôndola, ex.: B1-H-3-7"
                className="w-full rounded-lg border px-3 py-2 font-mono text-sm"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  setQuery("");
                }}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-200"
                aria-label="Cancelar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {options.length ? (
              <ul className="mt-2 divide-y rounded-lg border bg-white">
                {options.map((loc) => {
                  const own = loc.product?.sku === product.sku;
                  return (
                    <li key={loc.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <span className="font-mono font-semibold">{loc.barcode}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{TYPE_LABEL[loc.type]}</span>
                        <p className="truncate text-xs text-muted-foreground">
                          {!loc.active
                            ? "Inativa"
                            : loc.product
                              ? `${loc.product.sku} · ${loc.currentQuantity} un.`
                              : "Livre"}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={busy || own || !loc.active}
                        onClick={() => assign(loc)}
                        className="shrink-0 rounded-lg bg-[#0d9488] px-3 py-1 text-xs font-semibold text-white hover:bg-[#0f766e] disabled:opacity-40"
                      >
                        {own ? "Já vinculada" : loc.product ? "Trocar" : "Vincular"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : query.trim().length >= 2 && searchedQuery === query.trim() ? (
              <p className="mt-2 text-xs text-muted-foreground">Nenhuma posição encontrada.</p>
            ) : null}
          </div>
        ) : null}

        {message ? (
          <p className={message.kind === "ok" ? "text-sm text-teal-700" : "text-sm text-destructive"}>
            {message.text}
          </p>
        ) : null}

        {product.locations.length ? (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Posição</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Qtd.</TableHead>
                  <TableHead className="text-right">Capac.</TableHead>
                  <TableHead className="text-right">Mín.</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {product.locations.map((l) => (
                  <TableRow key={l.id} className={l.active ? undefined : "opacity-50"}>
                    <TableCell className="font-mono font-semibold">
                      {l.barcode}
                      {!l.active ? <span className="ml-2 text-xs font-normal">(inativa)</span> : null}
                    </TableCell>
                    <TableCell>
                      {TYPE_LABEL[l.type]}
                      {l.type === "PICK_FACE" ? (
                        <span className="ml-1 text-xs text-muted-foreground">{l.face === "B" ? "LE" : "LD"}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{l.currentQuantity}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.type === "PULMAO" ? "—" : l.capacity}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.type === "PULMAO" ? "—" : l.minThreshold}
                    </TableCell>
                    <TableCell className="text-right">
                      {l.type === "PULMAO" ? (
                        <span className="text-xs text-muted-foreground">Saldo no pulmão</span>
                      ) : (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => unassign(l.id, l.barcode)}
                          className="text-xs font-medium text-slate-500 hover:text-destructive disabled:opacity-40"
                        >
                          Desvincular
                        </button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-sm text-amber-700">Este produto ainda não tem posição no galpão.</p>
        )}
      </CardContent>
    </Card>
  );
}
