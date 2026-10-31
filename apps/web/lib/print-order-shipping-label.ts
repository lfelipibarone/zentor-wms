import { apiFetch } from "@/lib/api/client";
import { fetchShippingLabelText } from "@/lib/shipping-label-file";
import { printZplWithQz } from "@/lib/shipping-label-qz";

type ShippingLabelApiResult = {
  status: string;
  urls: string[];
  message?: string;
};

/** Garante etiqueta (Tiny) e envia ZPL à térmica. */
export async function ensureAndPrintOrderShippingLabel(
  orderId: string,
): Promise<{ printer: string }> {
  const result = await apiFetch<ShippingLabelApiResult>(
    `/api/packing/orders/${orderId}/shipping-labels`,
    { method: "POST", body: "{}" },
  );
  if (result.status !== "OK" || result.urls.length === 0) {
    throw new Error(result.message ?? "Etiqueta indisponível");
  }
  const zpl = (await fetchShippingLabelText(orderId)).trim();
  if (!zpl) throw new Error("Etiqueta ZPL vazia");
  return printZplWithQz(zpl);
}
