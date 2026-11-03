import { apiFetch } from "@/lib/api/client";
import {
  fetchShippingLabelText,
  triggerBlobDownload,
} from "@/lib/shipping-label-file";
import { printZplWithQz } from "@/lib/shipping-label-qz";

type ShippingLabelApiResult = {
  status: string;
  urls: string[];
  message?: string;
};

/** Garante etiqueta e envia à térmica (QZ). Sem QZ, baixa o ZPL. */
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
  try {
    return await printZplWithQz(zpl);
  } catch (e) {
    triggerBlobDownload(
      new Blob([zpl], { type: "text/plain;charset=utf-8" }),
      `etiqueta-${orderId}.zpl`,
    );
    const raw = e instanceof Error ? e.message : "";
    if (/connection|websocket|QZ|impressora|timeout/i.test(raw) || !raw) {
      return { printer: "download (QZ Tray indisponível)" };
    }
    throw e;
  }
}
