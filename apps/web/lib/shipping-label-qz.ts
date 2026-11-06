/**
 * Integração com QZ Tray para impressão raw ZPL em impressora térmica.
 * QZ Tray precisa estar instalado e rodando: https://qz.io/download/
 */

const QZ_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/qz-tray@2.2.4/qz-tray.js";
const PRINTER_STORAGE_KEY = "wms.qz.printerName";

export type QzTrayStatus = "checking" | "ready" | "missing" | "error";

type QzApi = {
  websocket: {
    isActive: () => boolean;
    connect: (opts?: { host?: string[]; usingSecure?: boolean }) => Promise<void>;
    disconnect: () => Promise<void>;
  };
  printers: {
    find: (query?: string | null) => Promise<string[]>;
    getDefault: () => Promise<string | null>;
  };
  configs: {
    create: (printer: string | null, opts?: { size?: { width: number; height: number } }) => unknown;
  };
  print: (
    config: unknown,
    data: Array<{
      type: string;
      format: string;
      flavor?: string;
      data: string;
    }>,
  ) => Promise<void>;
};

async function resolveQzPrinter(printerName?: string | null): Promise<string> {
  const qz = await getQz();
  if (!qz.websocket.isActive()) {
    await qz.websocket.connect({ host: ["localhost"], usingSecure: false });
  }

  const saved = printerName ?? getSavedQzPrinter();
  const printer =
    saved ??
    (await qz.printers.getDefault()) ??
    (await qz.printers.find())[0] ??
    null;

  if (!printer) {
    throw new Error(
      "Nenhuma impressora térmica encontrada. Instale o QZ Tray e configure a impressora padrão.",
    );
  }
  return printer;
}

declare global {
  interface Window {
    qz?: QzApi;
  }
}

let qzScriptPromise: Promise<void> | null = null;

function loadQzScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("QZ Tray só funciona no navegador"));
  }
  if (window.qz) return Promise.resolve();
  if (qzScriptPromise) return qzScriptPromise;

  qzScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-qz-tray="1"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Falha ao carregar QZ Tray")));
      return;
    }

    const script = document.createElement("script");
    script.src = QZ_SCRIPT_URL;
    script.async = true;
    script.dataset.qzTray = "1";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Falha ao carregar QZ Tray"));
    document.head.appendChild(script);
  });

  return qzScriptPromise;
}

async function getQz(): Promise<QzApi> {
  await loadQzScript();
  if (!window.qz) throw new Error("QZ Tray não disponível");
  return window.qz;
}

export function getSavedQzPrinter(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(PRINTER_STORAGE_KEY);
}

export function saveQzPrinter(name: string): void {
  localStorage.setItem(PRINTER_STORAGE_KEY, name);
}

export async function detectQzTray(): Promise<QzTrayStatus> {
  if (typeof window === "undefined") return "missing";
  try {
    const qz = await getQz();
    if (!qz.websocket.isActive()) {
      await Promise.race([
        qz.websocket.connect({ host: ["localhost"], usingSecure: false }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), 2500),
        ),
      ]);
    }
    return "ready";
  } catch {
    return "missing";
  }
}

export async function listQzPrinters(): Promise<string[]> {
  const qz = await getQz();
  if (!qz.websocket.isActive()) {
    await qz.websocket.connect({ host: ["localhost"], usingSecure: false });
  }
  return qz.printers.find();
}

export async function printZplWithQz(
  zpl: string,
  printerName?: string | null,
): Promise<{ printer: string }> {
  const qz = await getQz();
  const printer = await resolveQzPrinter(printerName);
  const config = qz.configs.create(printer);
  await qz.print(config, [{ type: "raw", format: "plain", data: zpl }]);
  saveQzPrinter(printer);
  return { printer };
}

/** PDF (ex.: Amazon / alguns carriers) via QZ pixel/pdf. */
export async function printPdfWithQz(
  pdfBytes: ArrayBuffer | Uint8Array | Blob,
  printerName?: string | null,
): Promise<{ printer: string }> {
  const qz = await getQz();
  const printer = await resolveQzPrinter(printerName);
  const config = qz.configs.create(printer, {
    size: { width: 4, height: 6 },
  });

  const buffer =
    pdfBytes instanceof Blob
      ? new Uint8Array(await pdfBytes.arrayBuffer())
      : pdfBytes instanceof ArrayBuffer
        ? new Uint8Array(pdfBytes)
        : pdfBytes;

  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < buffer.length; i += chunk) {
    binary += String.fromCharCode(...buffer.subarray(i, i + chunk));
  }
  const base64 = btoa(binary);

  await qz.print(config, [
    { type: "pixel", format: "pdf", flavor: "base64", data: base64 },
  ]);
  saveQzPrinter(printer);
  return { printer };
}
