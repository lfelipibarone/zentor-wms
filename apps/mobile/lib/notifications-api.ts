import { request } from "./api";

export interface NotificationDto {
  id: string;
  title: string;
  body: string;
  category: string;
  readAt: string | null;
  createdAt: string;
}

export function fetchNotifications(page = 1) {
  return request<{
    notifications: NotificationDto[];
    unreadCount: number;
  }>(`/api/notifications?page=${page}&pageSize=20`);
}

export function markNotificationRead(id: string) {
  return request<{ ok: boolean }>(`/api/notifications/${id}/read`, {
    method: "PATCH",
  });
}

export function markAllNotificationsRead() {
  return request<{ ok: boolean }>("/api/notifications/read-all", {
    method: "POST",
  });
}

export function registerPushDevice(token: string) {
  return request<{ ok: boolean }>("/api/notifications/register-device", {
    method: "POST",
    body: JSON.stringify({ platform: "expo", token }),
  });
}
