"use client";

import { useRef, useState } from "react";
import { QRCodeCanvas, QRCodeSVG } from "qrcode.react";
import { Download, Pencil, Printer } from "lucide-react";
import { productQrValue } from "@wms/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { setProductQrCode, type ProductDetail } from "@/lib/api/products";

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

const buttonClass =
  "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-50";

export function ProductQrCard({
  product,
  onSaved,
}: {
  product: ProductDetail;
  onSaved: () => void;
}) {
  const value = productQrValue(product);
  const customized = Boolean(product.qrCode);
  const svgWrapRef = useRef<HTMLDivElement>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (qrCode: string | null) => {
    setSaving(true);
    setError(null);
    try {
      await setProductQrCode(product.id, qrCode);
      setEditing(false);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const printLabel = () => {
    const svg = svgWrapRef.current?.innerHTML;
    if (!svg) return;
    const win = window.open("", "_blank", "width=420,height=520");
    if (!win) return;
    win.document.write(`<!doctype html><html><head><title>${escapeHtml(product.sku)}</title>
<style>
  @page { margin: 4mm; }
  body { font-family: system-ui, sans-serif; display: flex; flex-direction: column; align-items: center; margin: 0; padding: 8px; }
  svg { width: 45mm; height: 45mm; }
  .sku { font: 700 14pt ui-monospace, monospace; margin-top: 4px; }
  .name { font-size: 9pt; text-align: center; max-width: 60mm; margin-top: 2px; }
</style></head><body>${svg}<div class="sku">${escapeHtml(product.sku)}</div><div class="name">${escapeHtml(product.name)}</div>
<script>window.onload = () => { window.print(); window.close(); };</script></body></html>`);
    win.document.close();
  };

  const downloadPng = () => {
    const canvas = canvasWrapRef.current?.querySelector("canvas");
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `qr-${product.sku}.png`;
    a.click();
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">QR code</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-3">
        <div ref={svgWrapRef} className="rounded-lg border bg-white p-3">
          <QRCodeSVG value={value} size={176} level="M" marginSize={2} />
        </div>
        <div ref={canvasWrapRef} className="hidden">
          <QRCodeCanvas value={value} size={600} level="M" marginSize={4} />
        </div>
        <div className="text-center">
          <p className="break-all font-mono text-sm font-semibold">{value}</p>
          <p className="text-xs text-muted-foreground">
            {customized ? "Código cadastrado (o SKU também é aceito)" : "Padrão: o próprio SKU"}
          </p>
        </div>

        {editing ? (
          <div className="w-full space-y-2">
            <input
              autoFocus
              className="w-full rounded-lg border px-3 py-2 font-mono text-sm"
              placeholder="Conteúdo do QR"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
            <div className="flex gap-2">
              <button
                type="button"
                disabled={saving || !draft.trim()}
                onClick={() => save(draft)}
                className="rounded-lg bg-[#0d9488] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#0f766e] disabled:opacity-50"
              >
                {saving ? "Salvando…" : "Salvar"}
              </button>
              <button type="button" disabled={saving} onClick={() => setEditing(false)} className={buttonClass}>
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap justify-center gap-2">
            <button type="button" onClick={printLabel} className={buttonClass}>
              <Printer className="h-4 w-4" /> Imprimir
            </button>
            <button type="button" onClick={downloadPng} className={buttonClass}>
              <Download className="h-4 w-4" /> Baixar PNG
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(product.qrCode ?? "");
                setError(null);
                setEditing(true);
              }}
              className={buttonClass}
            >
              <Pencil className="h-4 w-4" /> Alterar QR
            </button>
            {customized ? (
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  if (window.confirm(`Voltar o QR de ${product.sku} para o próprio SKU?`)) void save(null);
                }}
                className={buttonClass}
              >
                Voltar para o SKU
              </button>
            ) : null}
          </div>
        )}
        {!editing && error ? <p className="text-xs text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
