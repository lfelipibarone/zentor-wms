import { prisma } from "../lib/prisma.js";

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
    select: { id: true, role: true, permissions: true },
  });

  const targets = users.filter(
    (u) => u.role === "ADMIN" || u.permissions.includes(permission),
  );

  await Promise.all(
    targets.map((u) =>
      createNotification({
        userId: u.id,
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
