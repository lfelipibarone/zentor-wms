"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/ops/page-header";
import { DataState } from "@/components/ops/data-state";
import { ProductImageZoom } from "@/components/ops/product-image-zoom";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProductQrCard } from "@/components/products/product-qr-card";
import { ProductDataCard } from "@/components/products/product-data-card";
import { ProductLocationsCard } from "@/components/products/product-locations-card";
import { fetchProduct, type ProductDetail } from "@/lib/api/products";

export default function ProdutoDetailPage() {
  const params = useParams<{ id: string }>();
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError(null);
      try {
        const data = await fetchProduct(params.id);
        setProduct(data.product);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao carregar");
      } finally {
        setLoading(false);
      }
    },
    [params.id],
  );

  useEffect(() => {
    load();
  }, [load]);

  const reload = () => load(true);

  return (
    <div className="space-y-4">
      <Link
        href="/produtos"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Produtos
      </Link>

      <DataState loading={loading} error={error} empty={!loading && !product}>
        {product ? (
          <>
            <PageHeader title={product.sku} description={product.name}>
              {!product.active ? <Badge variant="secondary">Inativo</Badge> : null}
            </PageHeader>

            <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
              <div className="grid content-start gap-4 sm:grid-cols-2 lg:grid-cols-1">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Foto</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ProductImageZoom
                      src={product.imageUrl}
                      alt={product.name}
                      placeholder="Sem foto cadastrada"
                      className="relative mx-auto aspect-square w-full max-w-[240px]"
                      sizes="240px"
                    />
                  </CardContent>
                </Card>
                <ProductQrCard sku={product.sku} name={product.name} />
              </div>

              <div className="space-y-4">
                <ProductLocationsCard product={product} onChanged={reload} />
                <ProductDataCard product={product} onSaved={reload} />
              </div>
            </div>
          </>
        ) : null}
      </DataState>
    </div>
  );
}
