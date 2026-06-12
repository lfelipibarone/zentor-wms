"use client";

import { useCallback, useEffect, useState } from "react";
import { FileUp, Plus } from "lucide-react";
import { LocationImportModal } from "@/components/cadastros/location-import-modal";
import {
  LocationLayoutFields,
  emptyLayout,
  type LocationLayoutValue,
} from "@/components/cadastros/location-layout-fields";
import { PageHeader } from "@/components/ops/page-header";
import { DataState } from "@/components/ops/data-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LOCATION_TYPE_LABEL } from "@/lib/labels";
import { apiFetch } from "@/lib/api/client";
import { Pagination } from "@/components/ui/pagination";
import type { PaginationMeta } from "@/lib/pagination";
import {
  fetchBaskets,
  fetchLocations,
  type LocationRow,
} from "@/lib/api/operations";

type Tab = "locations" | "baskets";
type LocTypeFilter = "" | "PULMAO" | "PICK_FACE";

export default function CadastrosPage() {
  const [tab, setTab] = useState<Tab>("locations");
  const [locTypeFilter, setLocTypeFilter] = useState<LocTypeFilter>("");
  const [skuFilter, setSkuFilter] = useState("");
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [baskets, setBaskets] = useState<
    Awaited<ReturnType<typeof fetchBaskets>>["baskets"]
  >([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [locForm, setLocForm] = useState(false);
  const [locImport, setLocImport] = useState(false);
  const [basketForm, setBasketForm] = useState(false);

  useEffect(() => {
    setPage(1);
  }, [tab, locTypeFilter, skuFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (tab === "locations") {
        const loc = await fetchLocations({
          page,
          type: locTypeFilter || undefined,
          sku: skuFilter.trim() || undefined,
        });
        setLocations(loc.locations);
        setPagination(loc.pagination);
      } else {
        const bas = await fetchBaskets(page);
        setBaskets(bas.baskets);
        setPagination(bas.pagination);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, [tab, page, locTypeFilter, skuFilter]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <PageHeader
        title="Cadastros"
        description="Gôndolas (pulmão e estoque de giro) e cestas de separação."
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <TabBtn active={tab === "locations"} onClick={() => setTab("locations")}>
          Gôndolas / Localizações
        </TabBtn>
        <TabBtn active={tab === "baskets"} onClick={() => setTab("baskets")}>
          Cestas
        </TabBtn>
        {tab === "locations" ? (
          <>
            <button
              type="button"
              onClick={() => setLocImport(true)}
              className="ml-auto inline-flex items-center gap-1 rounded-lg border border-[#0d9488] bg-white px-3 py-2 text-sm font-semibold text-[#0d9488] hover:bg-teal-50"
            >
              <FileUp className="h-4 w-4" /> Importar XLSX
            </button>
            <button
              type="button"
              onClick={() => setLocForm(true)}
              className="inline-flex items-center gap-1 rounded-lg bg-[#0d9488] px-3 py-2 text-sm font-semibold text-white"
            >
              <Plus className="h-4 w-4" /> Nova localização
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setBasketForm(true)}
            className="ml-auto inline-flex items-center gap-1 rounded-lg bg-[#0d9488] px-3 py-2 text-sm font-semibold text-white"
          >
            <Plus className="h-4 w-4" /> Nova cesta
          </button>
        )}
      </div>

      {tab === "locations" ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {(
            [
              { key: "" as const, label: "Todos" },
              { key: "PULMAO" as const, label: "Pulmão" },
              { key: "PICK_FACE" as const, label: "Estoque de giro" },
            ] as const
          ).map((f) => (
            <button
              key={f.key || "all"}
              type="button"
              onClick={() => setLocTypeFilter(f.key)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                locTypeFilter === f.key
                  ? "bg-slate-700 text-white"
                  : "bg-slate-100 text-slate-700"
              }`}
            >
              {f.label}
            </button>
          ))}
          <input
            type="search"
            placeholder="Filtrar por SKU"
            value={skuFilter}
            onChange={(e) => setSkuFilter(e.target.value)}
            className="ml-auto min-w-[180px] rounded-lg border px-3 py-1.5 text-sm"
          />
        </div>
      ) : null}

      <DataState loading={loading} error={error} empty={false}>
        {tab === "locations" ? (
          <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Localização</TableHead>
                  <TableHead>Barracão</TableHead>
                  <TableHead>Setor</TableHead>
                  <TableHead>Estante</TableHead>
                  <TableHead>Prateleira</TableHead>
                  <TableHead>Coluna</TableHead>
                  <TableHead>Corredor</TableHead>
                  <TableHead>Fileira</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead title="Capacidade máxima / estoque atual">
                    Estoque
                  </TableHead>
                  <TableHead>Mín.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {locations.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-mono">
                      {l.product?.sku ?? "—"}
                    </TableCell>
                    <TableCell className="font-mono">{l.barcode}</TableCell>
                    <TableCell>{l.barracao?.code ?? "—"}</TableCell>
                    <TableCell>{l.setor?.code ?? "—"}</TableCell>
                    <TableCell>{l.estante?.code ?? "—"}</TableCell>
                    <TableCell>{l.prateleira?.code ?? "—"}</TableCell>
                    <TableCell>{l.coluna?.code ?? "—"}</TableCell>
                    <TableCell>{l.corredor?.code ?? l.corridor}</TableCell>
                    <TableCell>{l.fileira?.code ?? l.row}</TableCell>
                    <TableCell>
                      {LOCATION_TYPE_LABEL[l.type] ?? l.type}
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {l.capacity}/{l.currentQuantity}
                    </TableCell>
                    <TableCell>{l.minThreshold}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Barcode</TableHead>
                  <TableHead>Pedidos em uso</TableHead>
                  <TableHead>Ativa</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {baskets.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-mono">{b.code}</TableCell>
                    <TableCell className="font-mono">{b.barcode}</TableCell>
                    <TableCell>{b.ordersInUse}</TableCell>
                    <TableCell>{b.active ? "Sim" : "Não"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {pagination && pagination.total > 0 ? (
          <Pagination pagination={pagination} onPageChange={setPage} />
        ) : null}
      </DataState>

      {locImport ? (
        <LocationImportModal
          onClose={() => setLocImport(false)}
          onImported={() => {
            setPage(1);
            load();
          }}
        />
      ) : null}
      {locForm ? (
        <LocationFormModal
          onClose={() => setLocForm(false)}
          onSaved={() => {
            setLocForm(false);
            load();
          }}
        />
      ) : null}
      {basketForm ? (
        <BasketFormModal
          onClose={() => setBasketForm(false)}
          onSaved={() => {
            setBasketForm(false);
            load();
          }}
        />
      ) : null}
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-4 py-2 text-sm font-medium ${
        active ? "bg-[#0d9488] text-white" : "bg-white border text-slate-600"
      }`}
    >
      {children}
    </button>
  );
}

function LocationFormModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [barcode, setBarcode] = useState("");
  const [layout, setLayout] = useState<LocationLayoutValue>(emptyLayout);
  const [type, setType] = useState("PICK_FACE");
  const [capacity, setCapacity] = useState("100");
  const [minThreshold, setMinThreshold] = useState("10");

  const save = async () => {
    await apiFetch("/api/locations", {
      method: "POST",
      body: JSON.stringify({
        barcode,
        barracaoId: layout.barracaoId || null,
        setorId: layout.setorId || null,
        corredorId: layout.corredorId || null,
        fileiraId: layout.fileiraId || null,
        estanteId: layout.estanteId || null,
        prateleiraId: layout.prateleiraId || null,
        colunaId: layout.colunaId || null,
        type,
        capacity: Number(capacity),
        minThreshold: Number(minThreshold),
      }),
    });
    onSaved();
  };

  return (
    <Modal title="Nova localização" onClose={onClose} onSave={save}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Localização (código de barras)"
          value={barcode}
          onChange={setBarcode}
          className="sm:col-span-2"
        />
        <LocationLayoutFields value={layout} onChange={setLayout} />
        <label className="text-sm sm:col-span-2">
          Tipo
          <select
            className="mt-1 w-full rounded-lg border px-3 py-2"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="PICK_FACE">Estoque de giro</option>
            <option value="PULMAO">Pulmão</option>
          </select>
        </label>
        <Field label="Tamanho (capacidade)" value={capacity} onChange={setCapacity} />
        <Field label="Mínimo" value={minThreshold} onChange={setMinThreshold} />
      </div>
    </Modal>
  );
}

function BasketFormModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [code, setCode] = useState("");
  const [barcode, setBarcode] = useState("");

  const save = async () => {
    await apiFetch("/api/baskets", {
      method: "POST",
      body: JSON.stringify({ code, barcode }),
    });
    onSaved();
  };

  return (
    <Modal title="Nova cesta" onClose={onClose} onSave={save}>
      <Field label="Código" value={code} onChange={setCode} />
      <Field label="Barcode" value={barcode} onChange={setBarcode} />
    </Modal>
  );
}

function Modal({
  title,
  children,
  onClose,
  onSave,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-bold">{title}</h2>
        <div className="mt-4 space-y-3">{children}</div>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 text-sm">
            Cancelar
          </button>
          <button
            type="button"
            onClick={onSave}
            className="rounded-lg bg-[#0d9488] px-4 py-2 text-sm font-semibold text-white"
          >
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <label className={`block text-sm ${className ?? ""}`}>
      {label}
      <input
        className="mt-1 w-full rounded-lg border px-3 py-2"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
