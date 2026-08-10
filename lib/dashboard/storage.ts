import type { WorkOrder } from "../nucleus/normalize";

export type DashboardSnapshot = {
  orders: WorkOrder[];
  dateFrom: string;
  dateTo: string;
  email: string;
  lastSync?: string;
};

const STORAGE_KEY = "studio-laser-dashboard-snapshot";

export function loadDashboardSnapshot(): DashboardSnapshot | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(STORAGE_KEY);
    if (!rawValue) {
      return null;
    }

    const parsed = JSON.parse(rawValue) as DashboardSnapshot;
    return parsed?.orders ? parsed : null;
  } catch {
    return null;
  }
}

export function saveDashboardSnapshot(snapshot: DashboardSnapshot) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}

export function clearDashboardSnapshot() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(STORAGE_KEY);
}
