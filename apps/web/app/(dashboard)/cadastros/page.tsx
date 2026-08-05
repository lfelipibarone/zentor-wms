"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
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
import { apiFetch } from "@/lib/api/client";
import { Pagination } from "@/components/ui/pagination";
import type { PaginationMeta } from "@/lib/pagination";
import { FuncionariosPanel } from "@/components/cadastros/funcionarios-panel";
import { fetchBaskets } from "@/lib/api/operations";

type Tab = "baskets" | "employees";

export default function CadastrosPage() {
  const [tab, setTab] = useState<Tab>("baskets");
  const [baskets, setBaskets] = useState<
    Awaited<ReturnType<typeof fetchBaskets>>["baskets"]
  >([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [basketForm, setBasketForm] = useState(false);

  useEffect(() => {
    setPage(1);
  }, [tab]);

  const load = useCallback(async () => {
    if (tab === "employees") return;
    setLoading(true);
    setError(null);
    try {
      const bas = await fetchBaskets(page);
      setBaskets(bas.baskets);
      setPagination(bas.pagination);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, [tab, page]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <PageHeader
        title="Cadastros"
        description="Cestas de separação e funcionários. Posições do galpão ficam em Layout do galpão."
      />

      <p className="mb-4 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-950">
        Gôndolas e pulmões são cadastrados em{" "}
        <Link href="/gestao-barracao" className="font-semibold underline">
          Layout do galpão
        </Link>
        .
      </p>

      <div className="mb-4 flex flex-wrap gap-2">
        <TabBtn active={tab === "baskets"} onClick={() => setTab("baskets")}>
          Cestas
        </TabBtn>
        <TabBtn active={tab === "employees"} onClick={() => setTab("employees")}>
          Funcionários
        </TabBtn>
        {tab === "baskets" ? (
          <button
            type="button"
            onClick={() => setBasketForm(true)}
            className="ml-auto inline-flex items-center gap-1 rounded-lg bg-[#0d9488] px-3 py-2 text-sm font-semibold text-white"
          >
            <Plus className="h-4 w-4" /> Nova cesta
          </button>
        ) : null}
      </div>

      {tab === "employees" ? (
        <FuncionariosPanel embedded />
      ) : (
        <DataState loading={loading} error={error} empty={false}>
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
          {pagination && pagination.total > 0 ? (
            <Pagination pagination={pagination} onPageChange={setPage} />
          ) : null}
        </DataState>
      )}

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
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4">
      <div className="flex min-h-full items-center justify-center">
        <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
          <h2 className="text-lg font-bold">{title}</h2>
          <div className="mt-4 space-y-3">{children}</div>
          <div className="mt-5 flex justify-end gap-2">
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
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block text-sm">
      {label}
      <input
        className="mt-1 w-full rounded-lg border px-3 py-2"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
