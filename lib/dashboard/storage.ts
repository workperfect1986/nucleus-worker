import type { WorkOrder } from "../nucleus/normalize";

export type DashboardSnapshot = {
  orders: WorkOrder[];
  dateFrom: string;
  dateTo: string;
  email: string;
  lastSync?: string;
  totalCm2?: number;
  totalCm2UpdatedAt?: string;
};

const STORAGE_KEY = "studio-laser-dashboard-snapshot";
const SNAPSHOT_EVENT = "studio-laser-dashboard-snapshot-updated";
let cachedRawValue: string | null | undefined;
let cachedSnapshot: DashboardSnapshot | null = null;

function notifySnapshotUpdated() {
  window.dispatchEvent(new Event(SNAPSHOT_EVENT));
}

export function loadDashboardSnapshot(): DashboardSnapshot | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(STORAGE_KEY);
    if (rawValue === cachedRawValue) {
      return cachedSnapshot;
    }

    cachedRawValue = rawValue;
    if (!rawValue) {
      cachedSnapshot = null;
      return null;
    }

    const parsed = JSON.parse(rawValue) as DashboardSnapshot;
    cachedSnapshot = parsed?.orders ? parsed : null;
    return cachedSnapshot;
  } catch {
    cachedRawValue = null;
    cachedSnapshot = null;
    return null;
  }
}

export function saveDashboardSnapshot(snapshot: DashboardSnapshot) {
  if (typeof window === "undefined") {
    return;
  }

  const rawValue = JSON.stringify(snapshot);
  cachedRawValue = rawValue;
  cachedSnapshot = snapshot;
  window.localStorage.setItem(STORAGE_KEY, rawValue);
  notifySnapshotUpdated();
}

export function clearDashboardSnapshot() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(STORAGE_KEY);
  cachedRawValue = null;
  cachedSnapshot = null;
  notifySnapshotUpdated();
}

export function subscribeDashboardSnapshot(listener: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener();
  };
  window.addEventListener("storage", handleStorage);
  window.addEventListener(SNAPSHOT_EVENT, listener);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(SNAPSHOT_EVENT, listener);
  };
}
