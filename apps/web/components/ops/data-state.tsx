import { Loader2 } from "lucide-react";

export function DataState({
  loading,
  error,
  empty,
  emptyMessage = "Nenhum registro encontrado.",
  children,
}: {
  loading?: boolean;
  error?: string | null;
  empty?: boolean;
  emptyMessage?: string;
  children: React.ReactNode;
}) {
  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-[#0d9488]" />
      </div>
    );
  }
  if (error) {
    return (
      <p className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
        {error}
      </p>
    );
  }
  if (empty) {
    return (
      <p className="rounded-lg border bg-white p-8 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </p>
    );
  }
  return <>{children}</>;
}
