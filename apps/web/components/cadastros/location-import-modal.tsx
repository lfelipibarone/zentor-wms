"use client";

import { useRef, useState } from "react";
import { Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import {
  downloadLocationsTemplate,
  importLocationsToApi,
  parseLocationsXlsx,
  type ImportMode,
  type ParsedLocationRow,
} from "@/lib/locations-import";

interface LocationImportModalProps {
  onClose: () => void;
  onImported: () => void;
}

export function LocationImportModal({
  onClose,
  onImported,
}: LocationImportModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ParsedLocationRow[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [mode, setMode] = useState<ImportMode>("upsert");
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{
    created: number;
    updated: number;
    skipped: number;
    errors: Array<{ row: number; barcode?: string; message: string }>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onPickFile = async (picked: File | null) => {
    setFile(picked);
    setPreview([]);
    setParseErrors([]);
    setResult(null);
    setError(null);
    if (!picked) return;

    setParsing(true);
    try {
      const { rows, parseErrors: pe } = await parseLocationsXlsx(picked);
      setPreview(rows);
      setParseErrors(pe);
      if (rows.length === 0 && pe.length === 0) {
        setError("Nenhuma linha válida encontrada na planilha.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao ler planilha");
    } finally {
      setParsing(false);
    }
  };

  const runImport = async () => {
    if (preview.length === 0) return;
    setImporting(true);
    setError(null);
    try {
      const res = await importLocationsToApi(preview, mode);
      setResult(res);
      if (res.created + res.updated > 0) {
        onImported();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha na importação");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-bold text-slate-900">
          Importar localizações (XLSX)
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Envie uma planilha com corredor, linha, barcode, tipo (Gôndola ou
          Pulmão), SKU do produto, capacidade e estoque mínimo. Linhas com o
          mesmo barcode podem ser atualizadas.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => downloadLocationsTemplate()}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <Download className="h-4 w-4" />
            Baixar modelo
          </button>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-lg bg-[#0d9488] px-3 py-2 text-sm font-semibold text-white"
          >
            <Upload className="h-4 w-4" />
            Selecionar arquivo
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
          />
        </div>

        {file ? (
          <p className="mt-2 flex items-center gap-2 text-sm text-slate-600">
            <FileSpreadsheet className="h-4 w-4 text-[#0d9488]" />
            {file.name}
            {parsing ? (
              <Loader2 className="h-4 w-4 animate-spin text-[#0d9488]" />
            ) : (
              <span className="text-muted-foreground">
                · {preview.length} linha(s) válida(s)
              </span>
            )}
          </p>
        ) : null}

        <label className="mt-4 block text-sm font-medium text-slate-700">
          Modo de importação
          <select
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            value={mode}
            onChange={(e) => setMode(e.target.value as ImportMode)}
            disabled={importing || !!result}
          >
            <option value="upsert">
              Criar ou atualizar (recomendado — sincroniza planilha com o banco)
            </option>
            <option value="createOnly">
              Apenas criar novas (ignora barcodes já cadastrados)
            </option>
          </select>
        </label>

        {parseErrors.length > 0 ? (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-semibold">Avisos na leitura da planilha</p>
            <ul className="mt-1 list-inside list-disc">
              {parseErrors.slice(0, 8).map((msg) => (
                <li key={msg}>{msg}</li>
              ))}
              {parseErrors.length > 8 ? (
                <li>… e mais {parseErrors.length - 8}</li>
              ) : null}
            </ul>
          </div>
        ) : null}

        {preview.length > 0 ? (
          <div className="mt-4 max-h-48 overflow-auto rounded-lg border text-xs">
            <table className="w-full">
              <thead className="sticky top-0 bg-slate-100">
                <tr>
                  <th className="px-2 py-1 text-left">Barcode</th>
                  <th className="px-2 py-1 text-left">Corredor</th>
                  <th className="px-2 py-1 text-left">Fileira</th>
                  <th className="px-2 py-1 text-left">Tipo</th>
                </tr>
              </thead>
              <tbody>
                {preview.slice(0, 12).map((r) => (
                  <tr key={r.barcode} className="border-t">
                    <td className="px-2 py-1 font-mono">{r.barcode}</td>
                    <td className="px-2 py-1">{r.corridor}</td>
                    <td className="px-2 py-1">{r.row}</td>
                    <td className="px-2 py-1">{r.type}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.length > 12 ? (
              <p className="border-t bg-slate-50 px-2 py-1 text-muted-foreground">
                … mais {preview.length - 12} linha(s)
              </p>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <p className="mt-4 text-sm font-medium text-destructive">{error}</p>
        ) : null}

        {result ? (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm">
            <p className="font-semibold text-emerald-900">Importação concluída</p>
            <ul className="mt-2 space-y-1 text-emerald-800">
              <li>{result.created} criada(s)</li>
              <li>{result.updated} atualizada(s)</li>
              {result.skipped > 0 ? (
                <li>{result.skipped} ignorada(s) (já existiam)</li>
              ) : null}
              {result.errors.length > 0 ? (
                <li className="text-amber-800">
                  {result.errors.length} erro(s) — veja detalhes abaixo
                </li>
              ) : null}
            </ul>
            {result.errors.length > 0 ? (
              <ul className="mt-2 max-h-32 overflow-auto list-inside list-disc text-amber-900">
                {result.errors.slice(0, 10).map((err) => (
                  <li key={`${err.row}-${err.barcode}`}>
                    Linha {err.row}
                    {err.barcode ? ` (${err.barcode})` : ""}: {err.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border px-4 py-2 text-sm"
          >
            {result ? "Fechar" : "Cancelar"}
          </button>
          {!result ? (
            <button
              type="button"
              disabled={preview.length === 0 || parsing || importing}
              onClick={runImport}
              className="inline-flex items-center gap-2 rounded-lg bg-[#0d9488] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {importing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Importando…
                </>
              ) : (
                "Importar para o banco"
              )}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

