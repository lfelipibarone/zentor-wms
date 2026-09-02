import type { DashboardProductivity } from "@/lib/types/dashboard";

/** Mock alinhado ao schema Prisma (OrderStatus, Location minThreshold) */
export const mockDashboardProductivity: DashboardProductivity = {
  updatedAt: new Date().toISOString(),
  kpis: {
    awaitingPicking: 24,
    awaitingConference: 11,
    readyToShip: 18,
    deltaPicking: 12,
    deltaConference: -5,
    deltaShip: 8,
  },
  hourly: [
    { hour: "06:00", itemsPicked: 42, itemsConferenced: 18 },
    { hour: "07:00", itemsPicked: 88, itemsConferenced: 52 },
    { hour: "08:00", itemsPicked: 156, itemsConferenced: 98 },
    { hour: "09:00", itemsPicked: 203, itemsConferenced: 145 },
    { hour: "10:00", itemsPicked: 241, itemsConferenced: 198 },
    { hour: "11:00", itemsPicked: 278, itemsConferenced: 231 },
    { hour: "12:00", itemsPicked: 195, itemsConferenced: 210 },
    { hour: "13:00", itemsPicked: 312, itemsConferenced: 267 },
    { hour: "14:00", itemsPicked: 356, itemsConferenced: 301 },
    { hour: "15:00", itemsPicked: 298, itemsConferenced: 285 },
    { hour: "16:00", itemsPicked: 264, itemsConferenced: 248 },
    { hour: "17:00", itemsPicked: 187, itemsConferenced: 192 },
  ],
  pickerRanking: [
    { userId: "1", userName: "João Separador", itemsPicked: 412 },
    { userId: "2", userName: "Maria Silva", itemsPicked: 387 },
    { userId: "3", userName: "Carlos Mendes", itemsPicked: 356 },
    { userId: "4", userName: "Ana Costa", itemsPicked: 298 },
    { userId: "5", userName: "Pedro Lima", itemsPicked: 241 },
  ],
  shelfAlerts: [
    {
      locationId: "loc-1",
      corridor: "A",
      row: "02",
      barcode: "LOC-A02-01",
      productSku: "MOT-220V",
      productName: "Motor 220V",
      currentQuantity: 2,
      minThreshold: 2,
      capacity: 10,
    },
  ],
  stageMetrics: {
    picking: {
      avgDurationSec: 540,
      medianDurationSec: 510,
      ordersCount: 12,
      deltaVsYesterday: 8,
    },
    packing: {
      avgDurationSec: 330,
      medianDurationSec: 300,
      ordersCount: 9,
      deltaVsYesterday: 5,
    },
    packingReturns: {
      countToday: 3,
      inQueue: 1,
      avgResolutionSec: 1200,
      deltaVsYesterday: 50,
      byReason: [
        { type: "MISSING", label: "Item faltando", count: 2 },
        { type: "DAMAGED", label: "Avaria no produto", count: 1 },
      ],
    },
  },
};
