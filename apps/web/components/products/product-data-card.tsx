"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { updateProduct, type ProductDetail, type ProductUpdateInput } from "@/lib/api/products";

function formatDecimal(v: string | null, suffix = "") {
  if (v == null) return "—";
  const n = Number(v);
  return Number.isFinite(n) ? `${n.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}${suffix}` : v;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

const inputClass = "mt-1 w-full rounded-lg border px-3 py-2 text-sm";

export function ProductDataCard({
  product,
  onSaved,
}: {
  product: ProductDetail;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    barcode: "",
    imageUrl: "",
    unit: "",
    weight: "",
    requiresItemScan: false,
    active: true,
  });

  const startEdit = () => {
    setForm({
      name: product.name,
      barcode: product.barcode ?? "",
      imageUrl: product.imageUrl ?? "",
      unit: product.unit ?? "",
      weight: product.weight != null ? String(Number(product.weight)) : "",
      requiresItemScan: product.requiresItemScan,
      active: product.active,
    });
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    const weight = form.weight.trim() ? Number(form.weight.replace(",", ".")) : null;
    if (weight != null && !Number.isFinite(weight)) {
      setError("Peso inválido");
      return;
    }
    const body: ProductUpdateInput = {
      name: form.name,
      barcode: form.barcode.trim() || null,
      imageUrl: form.imageUrl.trim() || null,
      unit: form.unit.trim() || null,
      weight,
      requiresItemScan: form.requiresItemScan,
      active: form.active,
    };
    setSaving(true);
    setError(null);
    try {
      await updateProduct(product.id, body);
      setEditing(false);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base">Dados do produto</CardTitle>
        {!editing ? (
          <button
            type="button"
            onClick={startEdit}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-slate-50"
          >
            <Pencil className="h-4 w-4" /> Editar
          </button>
        ) : null}
      </CardHeader>
      <CardContent>
        {!editing ? (
          <dl className="divide-y">
            <Row label="SKU">
              <span className="font-mono font-semibold">{product.sku}</span>
            </Row>
            <Row label="Nome">{product.name}</Row>
            <Row label="EAN">
              <span className="font-mono">{product.barcode ?? "—"}</span>
            </Row>
            <Row label="Unidade">{product.unit ?? "—"}</Row>
            <Row label="Peso">{formatDecimal(product.weight, " kg")}</Row>
            <Row label="Fornecedor">{product.supplierName ?? "—"}</Row>
            <Row label="Estoque no Tiny">{formatDecimal(product.erpStockQuantity)}</Row>
            <Row label="Bipar cada unidade">{product.requiresItemScan ? "Sim" : "Não"}</Row>
            <Row label="Situação">{product.active ? "Ativo" : "Inativo"}</Row>
            <Row label="Link da foto">
              {product.imageUrl ? (
                <a href={product.imageUrl} target="_blank" rel="noreferrer" className="text-[#0d9488] underline">
                  abrir
                </a>
              ) : (
                "—"
              )}
            </Row>
          </dl>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              O SKU <span className="font-mono font-semibold">{product.sku}</span> não muda: é o conteúdo do QR
              da etiqueta.
            </p>
            <Field label="Nome">
              <input
                className={inputClass}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="EAN (código da caixa)">
                <input
                  className={`${inputClass} font-mono`}
                  value={form.barcode}
                  onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                />
              </Field>
              <Field label="Unidade">
                <input
                  className={inputClass}
                  value={form.unit}
                  onChange={(e) => setForm({ ...form, unit: e.target.value })}
                />
              </Field>
              <Field label="Peso (kg)">
                <input
                  className={inputClass}
                  inputMode="decimal"
                  value={form.weight}
                  onChange={(e) => setForm({ ...form, weight: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Link da foto">
              <input
                className={inputClass}
                placeholder="https://…"
                value={form.imageUrl}
                onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
              />
            </Field>
            <div className="flex flex-wrap gap-6 text-sm">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.requiresItemScan}
                  onChange={(e) => setForm({ ...form, requiresItemScan: e.target.checked })}
                />
                Exigir bipar cada unidade
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm({ ...form, active: e.target.checked })}
                />
                Ativo
              </label>
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <div className="flex gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={save}
                className="rounded-lg bg-[#0d9488] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0f766e] disabled:opacity-60"
              >
                {saving ? "Salvando…" : "Salvar"}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => setEditing(false)}
                className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-slate-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
