"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  PACKING_ISSUE_TYPE_LABEL,
  reportPackingIssue,
  type PackingIssueType,
  type PackingOrder,
} from "@/lib/api/operations";

interface PackingIssueModalProps {
  order: PackingOrder;
  onClose: () => void;
  onSubmitted: () => void;
}

const TYPE_OPTIONS: PackingIssueType[] = [
  "MISSING",
  "DAMAGED",
  "WRONG_ITEM",
  "WRONG_QUANTITY",
];

export function PackingIssueModal({
  order,
  onClose,
  onSubmitted,
}: PackingIssueModalProps) {
  const reportableItems = useMemo(
    () => order.items.filter((i) => i.quantityPicked > 0),
    [order.items],
  );

  const [itemId, setItemId] = useState<string>(
    reportableItems[0]?.id ?? "",
  );
  const [type, setType] = useState<PackingIssueType>("MISSING");
  const selectedItem = reportableItems.find((i) => i.id === itemId);
  const [quantity, setQuantity] = useState<string>(
    String(selectedItem?.quantityPicked ?? 1),
  );
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleItemChange = (newId: string) => {
    setItemId(newId);
    const item = reportableItems.find((i) => i.id === newId);
    if (item) setQuantity(String(item.quantityPicked));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem) {
      setError("Selecione um item");
      return;
    }
    const qty = Math.floor(Number(quantity));
    if (!Number.isFinite(qty) || qty <= 0) {
      setError("Quantidade inválida");
      return;
    }
    if (qty > selectedItem.quantityPicked) {
      setError(
        `Quantidade maior que o separado (${selectedItem.quantityPicked})`,
      );
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await reportPackingIssue(order.id, {
        itemId: selectedItem.id,
        quantity: qty,
        type,
        description: description.trim() || undefined,
      });
      onSubmitted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao reportar problema");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-amber-100 p-2">
            <AlertTriangle className="h-5 w-5 text-amber-700" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-bold text-slate-900">
              Relatar problema na conferência
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              O pedido voltará para a fila de separação no mobile para que o
              operador corrija o item.
            </p>
          </div>
        </div>

        {reportableItems.length === 0 ? (
          <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-muted-foreground">
            Nenhum item separado para reportar.
          </p>
        ) : (
          <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">
                Item afetado
              </span>
              <select
                value={itemId}
                onChange={(e) => handleItemChange(e.target.value)}
                disabled={submitting}
                className="w-full rounded-lg border bg-white px-3 py-2 text-sm"
              >
                {reportableItems.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.product.sku} · {i.product.name} (separado{" "}
                    {i.quantityPicked})
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">
                Tipo do problema
              </span>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as PackingIssueType)}
                disabled={submitting}
                className="w-full rounded-lg border bg-white px-3 py-2 text-sm"
              >
                {TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {PACKING_ISSUE_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">
                Quantidade afetada
              </span>
              <input
                type="number"
                min={1}
                max={selectedItem?.quantityPicked ?? 1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                disabled={submitting}
                className="w-32 rounded-lg border px-3 py-2 text-sm"
              />
              {selectedItem ? (
                <span className="ml-2 text-xs text-muted-foreground">
                  máx. {selectedItem.quantityPicked}
                </span>
              ) : null}
            </label>

            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">
                Descrição (opcional)
              </span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value.slice(0, 280))}
                disabled={submitting}
                rows={3}
                placeholder="Detalhes adicionais para o separador..."
                className="w-full rounded-lg border bg-white px-3 py-2 text-sm"
              />
              <span className="text-xs text-muted-foreground">
                {description.length}/280
              </span>
            </label>

            {error ? (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            ) : null}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="rounded-lg border px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={submitting || !selectedItem}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                Devolver para separação
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
