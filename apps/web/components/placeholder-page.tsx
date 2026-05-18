import { Construction } from "lucide-react";

interface PlaceholderPageProps {
  title: string;
  description: string;
}

export function PlaceholderPage({ title, description }: PlaceholderPageProps) {
  return (
    <div className="rounded-xl border bg-white p-10 text-center shadow-sm">
      <Construction className="mx-auto h-12 w-12 text-[#0d9488]" />
      <h1 className="mt-4 text-2xl font-bold tracking-tight">{title}</h1>
      <p className="mx-auto mt-2 max-w-lg text-muted-foreground">{description}</p>
    </div>
  );
}
