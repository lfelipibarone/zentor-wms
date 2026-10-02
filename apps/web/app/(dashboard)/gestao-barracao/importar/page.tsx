"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ops/page-header";
import { LocationImportModal } from "@/components/cadastros/location-import-modal";

export default function GestaoBarracaoImportarPage() {
  const router = useRouter();

  return (
    <div>
      <PageHeader
        title="Importar posições"
        description="Importe gôndolas e pulmões via planilha XLSX (endereço: barracão → estante → coluna → linha). Se o código de barras for novo e o endereço já existir, a etiqueta da posição é atualizada."
      >
        <Link
          href="/gestao-barracao"
          className="rounded-lg border bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50"
        >
          Voltar
        </Link>
      </PageHeader>
      <LocationImportModal
        onClose={() => router.push("/gestao-barracao")}
        onImported={() => router.push("/gestao-barracao")}
      />
    </div>
  );
}
