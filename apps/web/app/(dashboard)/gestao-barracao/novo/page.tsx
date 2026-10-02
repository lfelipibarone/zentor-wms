"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/ops/page-header";
import { WarehouseAddForm } from "@/components/warehouse/warehouse-add-form";

function NovoPageHeader() {
  const searchParams = useSearchParams();
  const tipo = searchParams.get("tipo")?.toLowerCase();

  let title = "Nova localização";
  let description =
    "Cadastre o endereço e a etiqueta da posição. O SKU é associado depois, na lista de localizações.";

  if (tipo === "pulmao" || tipo === "pulmão") {
    description = "Nova localização do tipo pulmão.";
  } else if (
    tipo === "pick_face" ||
    tipo === "sku" ||
    tipo === "estoque-de-giro"
  ) {
    description = "Nova localização de estoque de giro.";
  }

  return (
    <PageHeader title={title} description={description}>
      <Link
        href="/gestao-barracao"
        className="rounded-lg border bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50"
      >
        Voltar
      </Link>
    </PageHeader>
  );
}

export default function GestaoBarracaoNovoPage() {
  return (
    <div>
      <Suspense fallback={<p className="text-sm text-slate-500">Carregando…</p>}>
        <NovoPageHeader />
        <WarehouseAddForm />
      </Suspense>
    </div>
  );
}
