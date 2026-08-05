"use client";

import { PageHeader } from "@/components/ops/page-header";
import { WarehouseLayoutEditor } from "@/components/warehouse/warehouse-layout-editor";

export default function GestaoBarracaoPage() {
  return (
    <div>
      <PageHeader
        title="Layout do galpão"
        description="Cadastre e gerencie localizações do galpão (pulmão ou estoque de giro)."
      />
      <WarehouseLayoutEditor />
    </div>
  );
}
