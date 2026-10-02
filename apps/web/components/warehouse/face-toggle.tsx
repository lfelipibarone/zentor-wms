"use client";

import type { LocationFace } from "@/lib/api/warehouse";

const OPTIONS: Array<{ id: LocationFace; label: string; hint: string }> = [
  { id: "A", label: "LD", hint: "Um lado da estante" },
  { id: "B", label: "LE", hint: "Outro lado (colunas continuam a numeração do LD)" },
];

export function FaceToggle({
  value,
  onChange,
}: {
  value: LocationFace;
  onChange: (face: LocationFace) => void;
}) {
  return (
    <div className="text-sm">
      <p className="font-medium text-slate-700">Lado da estante</p>
      <div className="mt-1 grid grid-cols-2 gap-2">
        {OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={`rounded-lg border px-3 py-2 text-left transition-colors ${
              value === opt.id
                ? "border-teal-400 bg-teal-50 ring-1 ring-teal-300"
                : "bg-white hover:border-teal-200"
            }`}
          >
            <span className="block font-semibold text-slate-900">{opt.label}</span>
            <span className="block text-xs text-slate-500">{opt.hint}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
