"use client";

import { useRef } from "react";
import { QRCodeCanvas, QRCodeSVG } from "qrcode.react";
import { Download, Printer } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** O conteúdo do QR é o SKU, igual à fórmula da planilha de etiquetas. */
export function ProductQrCard({ sku, name }: { sku: string; name: string }) {
  const svgWrapRef = useRef<HTMLDivElement>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);

  const printLabel = () => {
    const svg = svgWrapRef.current?.innerHTML;
    if (!svg) return;
    const win = window.open("", "_blank", "width=420,height=520");
    if (!win) return;
    win.document.write(`<!doctype html><html><head><title>${escapeHtml(sku)}</title>
<style>
  @page { margin: 4mm; }
  body { font-family: system-ui, sans-serif; display: flex; flex-direction: column; align-items: center; margin: 0; padding: 8px; }
  svg { width: 45mm; height: 45mm; }
  .sku { font: 700 14pt ui-monospace, monospace; margin-top: 4px; }
  .name { font-size: 9pt; text-align: center; max-width: 60mm; margin-top: 2px; }
</style></head><body>${svg}<div class="sku">${escapeHtml(sku)}</div><div class="name">${escapeHtml(name)}</div>
<script>window.onload = () => { window.print(); window.close(); };</script></body></html>`);
    win.document.close();
  };

  const downloadPng = () => {
    const canvas = canvasWrapRef.current?.querySelector("canvas");
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `qr-${sku}.png`;
    a.click();
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">QR code</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-3">
        <div ref={svgWrapRef} className="rounded-lg border bg-white p-3">
          <QRCodeSVG value={sku} size={176} level="M" marginSize={2} />
        </div>
        <div ref={canvasWrapRef} className="hidden">
          <QRCodeCanvas value={sku} size={600} level="M" marginSize={4} />
        </div>
        <p className="font-mono text-sm font-semibold">{sku}</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={printLabel}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-slate-50"
          >
            <Printer className="h-4 w-4" /> Imprimir
          </button>
          <button
            type="button"
            onClick={downloadPng}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-slate-50"
          >
            <Download className="h-4 w-4" /> Baixar PNG
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
