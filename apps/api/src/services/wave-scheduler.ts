import { PickWaveStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { releasePickWave } from "./pick-wave.js";
import { getWaveSettings } from "./wave-settings.js";

let lastAutoRunDateKey: string | null = null;

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

export async function tryAutoReleaseWave(): Promise<void> {
  const settings = await getWaveSettings();
  if (!settings.enabled || !settings.autoReleaseEnabled) return;

  const today = todayKeyInSaoPaulo();
  if (lastAutoRunDateKey === today) return;

  const target = parseTimeToMinutes(settings.autoReleaseTime);
  const now = currentMinutesInSaoPaulo();
  if (now < target) return;

  const active = await prisma.pickWave.findFirst({
    where: { status: PickWaveStatus.RELEASED },
  });
  if (active) {
    lastAutoRunDateKey = today;
    return;
  }

  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN", active: true },
  });
  if (!admin) return;

  try {
    await releasePickWave(admin.id, { auto: true });
    lastAutoRunDateKey = today;
    console.log("[wave-scheduler] Onda automática liberada");
  } catch (e) {
    console.warn("[wave-scheduler]", e);
  }
}

export function startWaveScheduler(): void {
  const tick = () => {
    void tryAutoReleaseWave();
  };
  tick();
  setInterval(tick, 60_000);
}
