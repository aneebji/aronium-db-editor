export interface AppSettings {
  year: number;
  dbName: string;
}

const KEY = "pos-sale-sync.settings.v1";

export function loadSettings(): AppSettings {
  const year = new Date().getFullYear();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { year, dbName: "" };
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      year: Number(parsed.year) || year,
      dbName: String(parsed.dbName ?? ""),
    };
  } catch {
    return { year, dbName: "" };
  }
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...loadSettings(), ...patch };
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}
