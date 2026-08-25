import { authHeaders } from "@/lib/auth";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333";

function parseFilename(contentDisposition: string | null, fallback: string): string {
  if (!contentDisposition) return fallback;
  const match = /filename="([^"]+)"/i.exec(contentDisposition);
  return match?.[1] ?? fallback;
}

export async function downloadShippingLabelFile(
  orderId: string,
  refresh = false,
): Promise<{ filename: string; blob: Blob }> {
  const qs = refresh ? "?refresh=1" : "";
  const res = await fetch(
    `${API_BASE}/api/packing/orders/${orderId}/shipping-label/file${qs}`,
    {
      headers: authHeaders(),
      cache: "no-store",
    },
  );

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg =
      typeof body === "object" && body && "message" in body
        ? String((body as { message: string }).message)
        : typeof body === "object" && body && "error" in body
          ? String((body as { error: string }).error)
          : `Erro ${res.status}`;
    throw new Error(msg);
  }

  const blob = await res.blob();
  const filename = parseFilename(
    res.headers.get("Content-Disposition"),
    `etiqueta-${orderId}.zpl`,
  );
  return { filename, blob };
}

export async function fetchShippingLabelText(
  orderId: string,
  refresh = false,
): Promise<string> {
  const { blob } = await downloadShippingLabelFile(orderId, refresh);
  return blob.text();
}

export async function fetchShippingLabelPreviewBlob(
  orderId: string,
  refresh = false,
): Promise<{ blob: Blob; contentType: string }> {
  const qs = refresh ? "?refresh=1" : "";
  const res = await fetch(
    `${API_BASE}/api/packing/orders/${orderId}/shipping-label/preview${qs}`,
    {
      headers: authHeaders(),
      cache: "no-store",
    },
  );

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg =
      typeof body === "object" && body && "message" in body
        ? String((body as { message: string }).message)
        : typeof body === "object" && body && "error" in body
          ? String((body as { error: string }).error)
          : `Erro ${res.status}`;
    throw new Error(msg);
  }

  const contentType = res.headers.get("Content-Type") ?? "image/png";
  const blob = await res.blob();
  return { blob, contentType };
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
