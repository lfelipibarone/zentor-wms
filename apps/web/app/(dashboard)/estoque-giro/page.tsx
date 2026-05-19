"use client";

import { StockLocationsView } from "@/components/ops/stock-locations-view";

export default function EstoqueGiroPage() {
  return (
    <StockLocationsView
      title="Estoque de giro"
      description="Gôndolas de separação e expedição — saldos e movimentações."
      locationType="PICK_FACE"
      showMovementsTab
    />
  );
}
