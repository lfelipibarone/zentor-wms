import { readFileSync } from "node:fs";
import { join } from "node:path";
import Link from "next/link";

export default function UsuariosTesteDocPage() {
  const path = join(process.cwd(), "..", "..", "docs", "usuarios-teste.md");
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    content =
      "Arquivo docs/usuarios-teste.md não encontrado. Consulte o repositório na raiz do monorepo.";
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <Link
          href="/login"
          className="text-sm font-medium text-[#0d9488] hover:underline"
        >
          ← Voltar ao login
        </Link>
        <pre className="mt-6 overflow-x-auto rounded-xl border bg-white p-6 text-sm leading-relaxed whitespace-pre-wrap">
          {content}
        </pre>
      </div>
    </div>
  );
}
