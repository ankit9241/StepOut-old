import type { TaskEntity } from "../server/types";

export function isNotificationSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function getNotificationPermission(): NotificationPermission {
  if (!isNotificationSupported()) return "denied";
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!isNotificationSupported()) return "denied";
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

export function formatReminderNotification(task: TaskEntity): { title: string; body: string } {
  const timing =
    task.reminder?.note ||
    (task.reminder?.offsetMinutes ? `${task.reminder.offsetMinutes} minutes before` : "Reminder");

  let dueStr = "No deadline set";
  if (task.deadline) {
    try {
      const d = new Date(task.deadline);
      dueStr = `Due ${d.toLocaleDateString()} at ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
    } catch {
      dueStr = `Due ${task.deadline}`;
    }
  }

  const title = `${timing} — ${task.title}`;
  const body = `${dueStr}${task.evidence ? `\nContext: ${task.evidence}` : ""}`;

  return { title, body };
}

export function triggerBrowserNotification(title: string, body: string): boolean {
  if (isNotificationSupported() && Notification.permission === "granted") {
    try {
      const notif = new Notification(title, {
        body,
        icon: "/favicon.svg",
      });
      notif.onclick = () => {
        window.focus();
        notif.close();
      };
      return true;
    } catch (err) {
      console.warn("Failed to create browser notification:", err);
    }
  }
  return false;
}
