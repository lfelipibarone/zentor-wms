import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import type { ShelfAlertItem } from "@/lib/types/dashboard";

interface ShelfAlertsProps {
  alerts: ShelfAlertItem[];
}

export function ShelfAlerts({ alerts }: ShelfAlertsProps) {
  return (
    <Card className="shadow-md border-amber-200/60 dark:border-amber-900/50">
      <CardHeader className="flex flex-row items-start gap-3">
        <div className="rounded-lg bg-amber-100 p-2 dark:bg-amber-900/40">
          <AlertTriangle className="h-5 w-5 text-amber-700 dark:text-amber-400" />
        </div>
        <div>
          <CardTitle>Alertas de Gôndola</CardTitle>
          <CardDescription>
            Pick faces com estoque no ou abaixo do mínimo — acionar equipe do
            Pulmão
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Localização</TableHead>
              <TableHead className="text-right">Atual</TableHead>
              <TableHead className="text-right">Mínimo</TableHead>
              <TableHead className="text-right">Capacidade</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {alerts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  Nenhum alerta no momento
                </TableCell>
              </TableRow>
            ) : (
              alerts.map((row) => {
                const critical = row.currentQuantity === 0;
                return (
                  <TableRow key={row.locationId}>
                    <TableCell className="font-mono font-semibold">
                      {row.corridor}-{row.row}
                      <span className="block text-xs font-normal text-muted-foreground">
                        {row.barcode}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-bold tabular-nums">
                      {row.currentQuantity}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {row.minThreshold}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {row.capacity}
                    </TableCell>
                    <TableCell>
                      <Badge variant={critical ? "destructive" : "warning"}>
                        {critical ? "Zerado" : "Reabastecer"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

