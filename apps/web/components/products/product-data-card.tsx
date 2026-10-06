import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ProductDetail } from "@/lib/api/products";

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

export function ProductDataCard({ product }: { product: ProductDetail }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Dados do produto</CardTitle>
        <p className="text-xs text-muted-foreground">Vêm do Tiny e não são alterados pelo WMS.</p>
      </CardHeader>
      <CardContent>
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
        </dl>
      </CardContent>
    </Card>
  );
}
