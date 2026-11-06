import { apiFetch } from "@/lib/api/client";
import {
  downloadShippingLabelFile,
  triggerBlobDownload,
} from "@/lib/shipping-label-file";
import { printPdfWithQz, printZplWithQz } from "@/lib/shipping-label-qz";

type ShippingLabelApiResult = {
  status: string;
  urls: string[];
  message?: string;
};

function looksLikeZpl(text: string): boolean {
  return /\^XA/i.test(text) || /~DG/i.test(text);
}

/**
 * Garante etiqueta no Tiny e imprime automaticamente no packing.
 * Aceita qualquer formato que a Tiny devolver (ZIP→ZPL, ZPL direto, PDF).
 */
export async function ensureAndPrintOrderShippingLabel(
  orderId: string,
): Promise<{ printer: string; format: "zpl" | "pdf" }> {
  const result = await apiFetch<ShippingLabelApiResult>(
    `/api/packing/orders/${orderId}/shipping-labels`,
    { method: "POST", body: "{}" },
  );
  if (result.status !== "OK" || result.urls.length === 0) {
    throw new Error(result.message ?? "Etiqueta indisponível");
  }

  const { blob, contentType, filename } = await downloadShippingLabelFile(orderId);
  const isPdf =
    contentType.includes("pdf") ||
    filename.toLowerCase().endsWith(".pdf");

  if (isPdf) {
    try {
      const { printer } = await printPdfWithQz(blob);
      return { printer, format: "pdf" };
    } catch (e) {
      triggerBlobDownload(
        blob,
        filename.endsWith(".pdf") ? filename : `etiqueta-${orderId}.pdf`,
      );
      const raw = e instanceof Error ? e.message : "";
      if (/connection|websocket|QZ|impressora|timeout/i.test(raw) || !raw) {
        return { printer: "download PDF (QZ Tray indisponível)", format: "pdf" };
      }
      throw e;
    }
  }

  const zpl = (await blob.text()).trim();
  if (!zpl || !looksLikeZpl(zpl)) {
    throw new Error(
      "Etiqueta baixada sem ZPL/PDF válido. Atualize a etiqueta ou confira no Tiny.",
    );
  }

  try {
    const { printer } = await printZplWithQz(zpl);
    return { printer, format: "zpl" };
  } catch (e) {
    triggerBlobDownload(
      new Blob([zpl], { type: "text/plain;charset=utf-8" }),
      `etiqueta-${orderId}.zpl`,
    );
    const raw = e instanceof Error ? e.message : "";
    if (/connection|websocket|QZ|impressora|timeout/i.test(raw) || !raw) {
      return { printer: "download (QZ Tray indisponível)", format: "zpl" };
    }
    throw e;
  }
}
