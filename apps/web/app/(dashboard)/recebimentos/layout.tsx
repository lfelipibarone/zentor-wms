import { Suspense, type ReactNode } from "react";

export default function RecebimentosLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <Suspense fallback={<p className="p-6 text-muted-foreground">Carregando…</p>}>{children}</Suspense>;
}
