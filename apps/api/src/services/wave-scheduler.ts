import { prisma } from "../lib/prisma.js";
import {
  addOrdersToWave,
  buildWaveCandidateOrders,
  getOpenWave,
  releasePickWave,
} from "./pick-wave.js";
import { getWaveSettings, type WaveSchedule } from "./wave-settings.js";

const lastAutoRunBySlot = new Map<string, true>();

function todayKeyInSaoPaulo(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Sao_Paulo",
  });
}

function currentMinutesInSaoPaulo(): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

function todayDayOfWeekInSaoPaulo(): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
  }).formatToParts(new Date());
  const w = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[w] ?? 0;
}

function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(":").map((x) => Number(x));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 6 * 60 + 30;
  return h * 60 + m;
}

async function tryAutoReleaseForTenant(tenantId: string): Promise<void> {
  const settings = await getWaveSettings(tenantId);
  if (!settings.enabled || !settings.autoReleaseEnabled) return;

  const todayKey = todayKeyInSaoPaulo();
  const nowMinutes = currentMinutesInSaoPaulo();
  const todayDow = todayDayOfWeekInSaoPaulo();

  const schedules: WaveSchedule[] =
    settings.autoReleaseSchedules.length > 0
      ? settings.autoReleaseSchedules
      : [{ dayOfWeek: todayDow, time: settings.autoReleaseTime }];

  const dueSlots = schedules.filter((slot) => {
    if (slot.dayOfWeek !== todayDow) return false;
    const target = parseTimeToMinutes(slot.time);
    if (nowMinutes < target) return false;
    const slotKey = `${tenantId}|${todayKey}|${slot.dayOfWeek}-${slot.time}`;
    return !lastAutoRunBySlot.has(slotKey);
  });

  if (dueSlots.length === 0) return;

  const admin = await prisma.user.findFirst({
    where: { tenantId, role: "ADMIN", active: true, isPlatformAdmin: false },
  });
  if (!admin) return;

  for (const slot of dueSlots) {
    const slotKey = `${tenantId}|${todayKey}|${slot.dayOfWeek}-${slot.time}`;
    lastAutoRunBySlot.set(slotKey, true);
    try {
      const open = await getOpenWave(tenantId);
      if (open) {
        const candidates = await buildWaveCandidateOrders(tenantId, {
          maxOrders: settings.autoReleaseMaxOrders,
          onlyDeadlineToday: settings.onlyDeadlineToday,
          marketplace: settings.autoReleaseMarketplace ?? undefined,
        });
        if (candidates.length > 0) {
          const result = await addOrdersToWave(
            tenantId,
            open.id,
            candidates.map((o) => o.id),
          );
          console.log(
            `[wave-scheduler] ${result.added} pedido(s) anexados à onda em aberto (${tenantId} slot ${slot.dayOfWeek}-${slot.time})`,
          );
        }
      } else {
        await releasePickWave(tenantId, admin.id, {
          auto: true,
          marketplace: settings.autoReleaseMarketplace ?? undefined,
          partitionStrategy: settings.defaultPartitionStrategy,
        });
        console.log(
          `[wave-scheduler] Onda automática liberada (${tenantId} slot ${slot.dayOfWeek}-${slot.time})`,
        );
      }
    } catch (e) {
      console.warn(`[wave-scheduler] ${tenantId} slot ${slot.dayOfWeek}-${slot.time}`, e);
    }
  }
}

export async function tryAutoReleaseWave(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    where: { active: true },
    select: { id: true },
  });
  for (const t of tenants) {
    await tryAutoReleaseForTenant(t.id);
  }
}

export function startWaveScheduler(): void {
  const tick = () => {
    void tryAutoReleaseWave();
  };
  tick();
  setInterval(tick, 60_000);
}
