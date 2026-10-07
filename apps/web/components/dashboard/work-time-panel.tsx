"use client";

import { useCallback, useEffect, useState } from "react";
import { Timer, Users } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LiveDuration } from "@/components/ops/work-shares-panel";
import {
  fetchDashboardWorkShares,
  formatDuration,
  type DashboardWorkShares,
} from "@/lib/api/work-shares";

const REFRESH_MS = 15_000;

/** Cronômetro por funcionário: quem está trabalhando agora e o tempo de hoje por etapa. */
export function WorkTimePanel() {
  const [data, setData] = useState<DashboardWorkShares | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await fetchDashboardWorkShares());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar tempos");
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const inProgress = data?.inProgress ?? [];
  const rows = data?.byUserStage ?? [];

  return (
    <section className="grid gap-6 lg:grid-cols-5">
      <Card className="shadow-md lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Timer className="h-5 w-5 text-sky-600" />
            Em andamento agora
          </CardTitle>
          <CardDescription>Cronômetro de quem tocou em Iniciar e ainda não terminou</CardDescription>
        </CardHeader>
        <CardContent>
          {error && !data ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : inProgress.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ninguém com tarefa em andamento.</p>
          ) : (
            <ul className="divide-y">
              {inProgress.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{s.assignedTo.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {s.kindLabel} · {s.title}
                      {s.shareCount > 1 ? ` · parte ${s.shareIndex}/${s.shareCount}` : ""} ·{" "}
                      {s.itemsDone}/{s.itemsTotal} itens
                    </p>
                  </div>
                  <LiveDuration share={s} className="text-lg" />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-md lg:col-span-3">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Tempo por funcionário e etapa (hoje)
          </CardTitle>
          <CardDescription>
            Partes concluídas hoje — separação em onda, conferência NF e armazenagem
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma parte concluída hoje.</p>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Funcionário</TableHead>
                    <TableHead>Etapa</TableHead>
                    <TableHead className="text-right">Partes</TableHead>
                    <TableHead className="text-right">Unidades</TableHead>
                    <TableHead className="text-right">Tempo total</TableHead>
                    <TableHead className="text-right">Médio</TableHead>
                    <TableHead className="text-right">Un./hora</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={`${r.userId}:${r.kind}`}>
                      <TableCell className="text-sm font-medium">{r.userName}</TableCell>
                      <TableCell className="text-sm">{r.kindLabel}</TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{r.tasks}</TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{r.units}</TableCell>
                      <TableCell className="text-right font-mono text-sm tabular-nums">
                        {formatDuration(r.totalSec)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm tabular-nums">
                        {formatDuration(r.avgSec)}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {r.unitsPerHour ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
