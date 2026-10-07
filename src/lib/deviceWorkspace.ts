import { activeApprovedCapabilities } from "./linkCapabilityPolicy";

export type DeviceView = {
  id: string; name: string; platform: string; platformVersion: string; appVersion: string;
  ownerId: string | null; ownerName: string | null; lastSeenAt: string | null; createdAt: string;
  online: boolean; capabilities: string[]; permissions: string[]; allowHouseholdShares: boolean;
};
type DeviceRow = {
  id: string; name: string; platform: string; platformVersion: string; appVersion: string;
  userId: string | null; user: { name: string } | null; lastSeenAt: Date | null; createdAt: Date;
  capabilities: string; approvedCapabilities: string | null; permissions: string; allowHouseholdShares: boolean;
};

export function permissionNames(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? [...new Set(parsed.filter((p): p is string => typeof p === "string"))] : [];
  } catch { return []; }
}

/** Explicit projection: credentials, pairing secrets and keys never enter client props. */
export function deviceView(device: DeviceRow, now = Date.now()): DeviceView {
  return {
    id: device.id, name: device.name, platform: device.platform, platformVersion: device.platformVersion,
    appVersion: device.appVersion, ownerId: device.userId, ownerName: device.user?.name ?? null,
    lastSeenAt: device.lastSeenAt?.toISOString() ?? null, createdAt: device.createdAt.toISOString(),
    online: !!device.lastSeenAt && now - device.lastSeenAt.getTime() >= 0 && now - device.lastSeenAt.getTime() < 90_000,
    capabilities: [...activeApprovedCapabilities(device.capabilities, device.approvedCapabilities)].sort(),
    permissions: permissionNames(device.permissions), allowHouseholdShares: device.allowHouseholdShares,
  };
}

export const PLATFORM_NAMES: Record<string, string> = { macos: "macOS", windows: "Windows", linux: "Linux", android: "Android", ios: "iOS" };
export function filterDevices(devices: DeviceView[], query: string, status: "all" | "online" | "offline") {
  const search = query.trim().toLocaleLowerCase();
  return devices.filter(device => (status === "all" || device.online === (status === "online"))
    && `${device.name} ${device.ownerName ?? ""} ${PLATFORM_NAMES[device.platform] ?? device.platform}`.toLocaleLowerCase().includes(search));
}

export type GraphNode = { id: string; kind: "server" | "account" | "device"; ownerId?: string | null; deviceId?: string; x: number; y: number; width: number; height: number };
export type DeviceGraph = { nodes: GraphNode[]; edges: { from: string; to: string }[]; width: number; height: number };

/** Deterministic account lanes preserve the map through live status updates. */
export function deviceGraph(devices: DeviceView[]): DeviceGraph {
  const accounts = new Map<string, DeviceView[]>();
  for (const device of devices) {
    const id = device.ownerId === null ? "unassigned" : `account:${device.ownerId}`;
    const group = accounts.get(id) ?? [];
    group.push(device); accounts.set(id, group);
  }
  const groups = [...accounts.entries()].sort(([a], [b]) => a.localeCompare(b));
  const laneWidths = groups.map(([, devices]) => Math.max(276, Math.min(devices.length, 2) * 260));
  const width = Math.max(680, laneWidths.reduce((sum, lane) => sum + lane, 0) + Math.max(0, groups.length - 1) * 56 + 80);
  const height = Math.max(460, 294 + Math.max(0, ...groups.map(([, rows]) => Math.ceil(rows.length / 2))) * 134 + 32);
  const nodes: GraphNode[] = [{ id: "server", kind: "server", x: (width - 244) / 2, y: 28, width: 244, height: 90 }];
  const edges: DeviceGraph["edges"] = [];
  let left = (width - laneWidths.reduce((sum, lane) => sum + lane, 0) - Math.max(0, groups.length - 1) * 56) / 2;
  groups.forEach(([id, rows], index) => {
    const lane = laneWidths[index];
    nodes.push({ id, kind: "account", ownerId: rows[0].ownerId, x: left + (lane - 224) / 2, y: 166, width: 224, height: 78 });
    edges.push({ from: "server", to: id });
    const sorted = [...rows].sort((a, b) => a.id.localeCompare(b.id));
    sorted.forEach((device, i) => {
      const nodeId = `device:${device.id}`;
      const columns = Math.min(sorted.length, 2);
      nodes.push({ id: nodeId, kind: "device", deviceId: device.id, x: left + (lane - columns * 260) / 2 + (i % 2) * 260 + 12, y: 294 + Math.floor(i / 2) * 134, width: 236, height: 106 });
      edges.push({ from: id, to: nodeId });
    });
    left += lane + 56;
  });
  return { nodes, edges, width, height };
}

export const DEVICE_PERMISSION_GROUPS = [
  { id: "sharing", ru: "Обмен между устройствами", en: "Sharing between devices", permissions: [
    { key: "share.relay", ru: "Быстрая отправка", en: "Quick sharing", hintRu: "Отправка текста, ссылок и файлов через этот сервер.", hintEn: "Send text, links and files through this server.", editable: true },
    { key: "clipboard.relay", ru: "Синхронизация буфера", en: "Clipboard sync", hintRu: "Скопированный текст передаётся между устройствами этого аккаунта.", hintEn: "Copied text travels between devices belonging to this account.", editable: true },
  ] },
  { id: "personal", ru: "Личные данные", en: "Personal data", permissions: [
    { key: "ideas.manage", ru: "Идеи и категории", en: "Ideas and categories", hintRu: "Чтение и изменение идей аккаунта.", hintEn: "Read and edit this account's ideas.", editable: true },
    { key: "plants.manage", ru: "Растения и полив", en: "Plants and watering", hintRu: "Растения, фотографии и отметки полива аккаунта.", hintEn: "Access this account's plants, photos and watering records.", editable: true },
    { key: "calendar.read", ru: "Просмотр календаря", en: "Read calendar", hintRu: "Просмотр календаря без изменения событий.", hintEn: "View the calendar without changing events.", editable: false },
    { key: "calendar.manage", ru: "Изменение календаря", en: "Edit calendar", hintRu: "Создание и изменение событий календаря.", hintEn: "Create and edit calendar events.", editable: false },
    { key: "reminder.manage", ru: "Напоминания", en: "Reminders", hintRu: "Создание и изменение напоминаний аккаунта.", hintEn: "Create and edit this account's reminders.", editable: false },
  ] },
  { id: "services", ru: "Сервисы сервера", en: "Server services", permissions: [
    { key: "dashboard.read", ru: "Просмотр дашборда", en: "Read dashboard", hintRu: "Просмотр данных дашборда HomePlace.", hintEn: "Read HomePlace dashboard data.", editable: false },
    { key: "media.request", ru: "Запросы медиатеки", en: "Media requests", hintRu: "Создание запросов на фильмы и сериалы.", hintEn: "Request movies and series.", editable: false },
    { key: "telegram.send", ru: "Отправка в Telegram", en: "Send to Telegram", hintRu: "Отправка через настроенную интеграцию Telegram.", hintEn: "Send through the configured Telegram integration.", editable: false },
  ] },
] as const;

export function permissionLabel(key: string, ru: boolean) {
  const entry = DEVICE_PERMISSION_GROUPS.flatMap(group => [...group.permissions]).find(permission => permission.key === key);
  return entry ? (ru ? entry.ru : entry.en) : key;
}

export const CAPABILITY_LABELS: Record<string, [string, string]> = {
  "notification.receive": ["Уведомления", "Notifications"], "url.open": ["Открытие ссылок", "Open links"],
  "text.receive": ["Приём текста", "Receive text"], "file.receive": ["Приём файлов", "Receive files"],
  "file.batch.receive": ["Пакеты файлов", "File batches"], "share.send": ["Отправка", "Send content"],
  "clipboard.send": ["Отправка буфера", "Send clipboard"], "clipboard.receive": ["Приём буфера", "Receive clipboard"],
  "device.battery": ["Заряд батареи", "Battery status"], "device.network": ["Сеть", "Network status"],
  "device.presence": ["Статус подключения", "Connection status"], "system.lock": ["Блокировка", "Lock system"], "system.sleep": ["Режим сна", "Sleep system"],
};
