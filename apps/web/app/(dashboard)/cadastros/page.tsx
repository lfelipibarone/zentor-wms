"use client";

import { useCallback, useEffect, useState } from "react";
import { FileUp, Plus } from "lucide-react";
import { LocationImportModal } from "@/components/cadastros/location-import-modal";
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
  fetchProducts,
  type LocationRow,
} from "@/lib/api/operations";

type Tab = "locations" | "products" | "baskets";
type LocTypeFilter = "" | "PULMAO" | "PICK_FACE";

export default function CadastrosPage() {
  const [tab, setTab] = useState<Tab>("locations");
  const [locTypeFilter, setLocTypeFilter] = useState<LocTypeFilter>("");
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [baskets, setBaskets] = useState<
    Awaited<ReturnType<typeof fetchBaskets>>["baskets"]
  >([]);
  const [products, setProducts] = useState<
    Awaited<ReturnType<typeof fetchProducts>>["products"]
  >([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [locForm, setLocForm] = useState(false);
  const [locImport, setLocImport] = useState(false);
  const [basketForm, setBasketForm] = useState(false);
  const [productForm, setProductForm] = useState(false);

  useEffect(() => {
    setPage(1);
  }, [tab, locTypeFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const prod = await fetchProducts(undefined, 1, 100);
      setProducts(prod.products);
      if (tab === "locations") {
        const loc = await fetchLocations(
          undefined,
          page,
          undefined,
          locTypeFilter || undefined,
        );
        setLocations(loc.locations);
        setPagination(loc.pagination);
      } else if (tab === "products") {
        const prodPage = await fetchProducts(undefined, page);
        setProducts(prodPage.products);
        setPagination(prodPage.pagination);
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
  }, [tab, page, locTypeFilter]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <PageHeader
        title="Cadastros"
        description="Gôndolas (pulmão e estoque de giro), produtos e cestas."
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <TabBtn active={tab === "locations"} onClick={() => setTab("locations")}>
          Gôndolas / Localizações
        </TabBtn>
        <TabBtn active={tab === "products"} onClick={() => setTab("products")}>
          Produtos
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
        ) : tab === "products" ? (
          <button
            type="button"
            onClick={() => setProductForm(true)}
            className="ml-auto inline-flex items-center gap-1 rounded-lg bg-[#0d9488] px-3 py-2 text-sm font-semibold text-white"
          >
            <Plus className="h-4 w-4" /> Novo produto
          </button>
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
        <div className="mb-4 flex flex-wrap gap-2">
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
        </div>
      ) : null}

      <DataState loading={loading} error={error} empty={false}>
        {tab === "locations" ? (
          <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Barcode</TableHead>
                  <TableHead>Corredor</TableHead>
                  <TableHead>Fileira</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Tamanho (cap.)</TableHead>
                  <TableHead>Qtd atual</TableHead>
                  <TableHead>Mín.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {locations.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-mono">{l.barcode}</TableCell>
                    <TableCell>{l.corridor}</TableCell>
                    <TableCell>{l.row}</TableCell>
                    <TableCell>
                      {LOCATION_TYPE_LABEL[l.type] ?? l.type}
                    </TableCell>
                    <TableCell>
                      {l.product?.sku ?? "—"}
                      {l.product?.name ? (
                        <span className="block text-xs text-muted-foreground">
                          {l.product.name}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>{l.capacity}</TableCell>
                    <TableCell>{l.currentQuantity}</TableCell>
                    <TableCell>{l.minThreshold}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : tab === "products" ? (
          <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead>Barcode</TableHead>
                  <TableHead>Unidade</TableHead>
                  <TableHead>Peso</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono">{p.sku}</TableCell>
                    <TableCell>{p.name}</TableCell>
                    <TableCell className="font-mono">{p.barcode ?? "—"}</TableCell>
                    <TableCell>{p.unit ?? "—"}</TableCell>
                    <TableCell>{p.weight != null ? String(p.weight) : "—"}</TableCell>
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
          products={products}
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
      {productForm ? (
        <ProductFormModal
          onClose={() => setProductForm(false)}
          onSaved={() => {
            setProductForm(false);
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
  products,
  onClose,
  onSaved,
}: {
  products: { id: string; sku: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [corridor, setCorridor] = useState("A");
  const [row, setRow] = useState("01");
  const [barcode, setBarcode] = useState("");
  const [type, setType] = useState("PICK_FACE");
  const [productId, setProductId] = useState("");
  const [capacity, setCapacity] = useState("100");
  const [minThreshold, setMinThreshold] = useState("10");

  const save = async () => {
    await apiFetch("/api/locations", {
      method: "POST",
      body: JSON.stringify({
        corridor,
        row,
        barcode,
        type,
        productId: productId || undefined,
        capacity: Number(capacity),
        minThreshold: Number(minThreshold),
      }),
    });
    onSaved();
  };

  return (
    <Modal title="Nova localização" onClose={onClose} onSave={save}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Corredor" value={corridor} onChange={setCorridor} />
        <Field label="Fileira" value={row} onChange={setRow} />
        <Field label="Barcode" value={barcode} onChange={setBarcode} className="sm:col-span-2" />
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
        <label className="text-sm sm:col-span-2">
          SKU
          <select
            className="mt-1 w-full rounded-lg border px-3 py-2"
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
          >
            <option value="">— Sem produto —</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.sku} — {p.name}
              </option>
            ))}
          </select>
        </label>
        <Field label="Tamanho (capacidade)" value={capacity} onChange={setCapacity} />
        <Field label="Mínimo" value={minThreshold} onChange={setMinThreshold} />
      </div>
    </Modal>
  );
}

function ProductFormModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [barcode, setBarcode] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [unit, setUnit] = useState("UN");
  const [weight, setWeight] = useState("");

  const save = async () => {
    await apiFetch("/api/products", {
      method: "POST",
      body: JSON.stringify({
        sku,
        name,
        barcode: barcode || undefined,
        imageUrl: imageUrl || null,
        unit: unit || null,
        weight: weight ? Number(weight) : null,
      }),
    });
    onSaved();
  };

  return (
    <Modal title="Novo produto" onClose={onClose} onSave={save}>
      <Field label="SKU" value={sku} onChange={setSku} />
      <Field label="Nome" value={name} onChange={setName} />
      <Field label="Código de barras" value={barcode} onChange={setBarcode} />
      <Field label="URL da imagem" value={imageUrl} onChange={setImageUrl} />
      <Field label="Unidade" value={unit} onChange={setUnit} />
      <Field label="Peso (kg)" value={weight} onChange={setWeight} />
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
