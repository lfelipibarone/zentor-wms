"use client";

import { PageHeader } from "@/components/ops/page-header";
import { WarehouseLayoutEditor } from "@/components/warehouse/warehouse-layout-editor";

export default function GestaoBarracaoPage() {
  return (
    <div>
      <PageHeader
        title="Layout do galpão"
        description="Visualize todo o layout do galpão em uma única tela. Use Novo para cadastrar barracão, setor, corredor, fileira, estante, prateleira ou coluna."
      />
      <WarehouseLayoutEditor />
    </div>
  );
}
