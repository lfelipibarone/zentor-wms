import { prisma } from "../lib/prisma.js";
import { releasePickWave } from "./pick-wave.js";
import { getWaveSettings } from "./wave-settings.js";

const lastAutoRunByTenant = new Map<string, string>();

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

function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(":").map((x) => Number(x));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 6 * 60 + 30;
  return h * 60 + m;
}

async function tryAutoReleaseForTenant(tenantId: string): Promise<void> {
  const settings = await getWaveSettings(tenantId);
  if (!settings.enabled || !settings.autoReleaseEnabled) return;

  const today = todayKeyInSaoPaulo();
  if (lastAutoRunByTenant.get(tenantId) === today) return;

  const target = parseTimeToMinutes(settings.autoReleaseTime);
  const now = currentMinutesInSaoPaulo();
  if (now < target) return;

  const admin = await prisma.user.findFirst({
    where: { tenantId, role: "ADMIN", active: true, isPlatformAdmin: false },
  });
  if (!admin) return;

  try {
    await releasePickWave(tenantId, admin.id, { auto: true });
    lastAutoRunByTenant.set(tenantId, today);
    console.log(`[wave-scheduler] Onda automática liberada (${tenantId})`);
  } catch (e) {
    console.warn(`[wave-scheduler] ${tenantId}`, e);
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
