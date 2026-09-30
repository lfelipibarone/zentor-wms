import { prisma } from "../lib/prisma.js";
import {
  getRolePermissionMap,
  permissionsFromMap,
} from "./role-permissions.js";

export async function createNotification(params: {
  userId: string;
  title: string;
  body: string;
  category?: string;
  data?: Record<string, unknown>;
}) {
  const notification = await prisma.notification.create({
    data: {
      userId: params.userId,
      title: params.title,
      body: params.body,
      category: params.category ?? "SYSTEM",
      data: params.data ? JSON.stringify(params.data) : null,
    },
  });

  await sendPushToUser(params.userId, params.title, params.body, params.data);

  return notification;
}

export async function notifyUsersWithPermission(
  permission: string,
  payload: {
    title: string;
    body: string;
    category?: string;
    data?: Record<string, unknown>;
  },
  tenantId?: string,
) {
  const users = await prisma.user.findMany({
    where: {
      active: true,
      ...(tenantId ? { tenantId } : {}),
    },
    select: { id: true, role: true, tenantId: true, isPlatformAdmin: true },
  });

  const mapsByTenant = new Map<
    string,
    Awaited<ReturnType<typeof getRolePermissionMap>>
  >();
  const targets: string[] = [];

  for (const u of users) {
    if (u.role === "ADMIN") {
      targets.push(u.id);
      continue;
    }
    if (!u.tenantId) continue;
    let map = mapsByTenant.get(u.tenantId);
    if (!map) {
      map = await getRolePermissionMap(u.tenantId);
      mapsByTenant.set(u.tenantId, map);
    }
    const perms = permissionsFromMap(u.role, map, {
      isPlatformAdmin: u.isPlatformAdmin,
    });
    if (perms.includes(permission as never)) {
      targets.push(u.id);
    }
  }

  await Promise.all(
    targets.map((userId) =>
      createNotification({
        userId,
        title: payload.title,
        body: payload.body,
        category: payload.category,
        data: payload.data,
      }),
    ),
  );
}

async function sendPushToUser(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
) {
  const devices = await prisma.pushDevice.findMany({
    where: { userId, platform: "expo" },
  });

  if (devices.length === 0) return;

  const expoToken = process.env.EXPO_ACCESS_TOKEN;
  const messages = devices.map((d) => ({
    to: d.token,
    sound: "default" as const,
    title,
    body,
    data: data ?? {},
  }));

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (expoToken) {
      headers.Authorization = `Bearer ${expoToken}`;
    }

    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers,
      body: JSON.stringify(messages.length === 1 ? messages[0] : messages),
    });
  } catch {
    // Push opcional — notificação in-app já foi gravada
  }
}
