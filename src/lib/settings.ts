export type ThemeId = "dark" | "light";
export type BranchId = "shop-1" | "shop-2" | "shop-3" | "shop-4";

export const BRANCH_IDS: BranchId[] = ["shop-1", "shop-2", "shop-3", "shop-4"];

export interface BranchSlot {
  id: BranchId;
  name: string;
  dbName: string;
  productCount: number;
  salesCount: number;
}

export interface AppSettings {
  year: number;
  dbName: string;
  theme: ThemeId;
  activeBranchId: BranchId;
  branches: BranchSlot[];
}

const KEY = "pos-sale-sync.settings.v1";

function normalizeTheme(value: unknown): ThemeId {
  return value === "light" ? "light" : "dark";
}

export function isBranchId(value: unknown): value is BranchId {
  return BRANCH_IDS.includes(value as BranchId);
}

export function defaultBranches(): BranchSlot[] {
  return BRANCH_IDS.map((id, index) => ({
    id,
    name: `Shop ${index + 1}`,
    dbName: "",
    productCount: 0,
    salesCount: 0,
  }));
}

export function normalizeBranches(raw: unknown, fallbackDbName = ""): BranchSlot[] {
  const defaults = defaultBranches();
  if (!Array.isArray(raw)) {
    if (fallbackDbName) defaults[0].dbName = fallbackDbName;
    return defaults;
  }
  return defaults.map((slot) => {
    const found = raw.find((item) => item && typeof item === "object" && (item as BranchSlot).id === slot.id) as
      | Partial<BranchSlot>
      | undefined;
    const name = String(found?.name ?? slot.name).trim();
    return {
      id: slot.id,
      name: name || slot.name,
      dbName: String(found?.dbName ?? ""),
      productCount: Number(found?.productCount) || 0,
      salesCount: Number(found?.salesCount) || 0,
    };
  });
}

export function loadSettings(): AppSettings {
  const year = new Date().getFullYear();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { year, dbName: "", theme: "dark", activeBranchId: "shop-1", branches: defaultBranches() };
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    const dbName = String(parsed.dbName ?? "");
    const branches = normalizeBranches(parsed.branches, dbName);
    const activeBranchId = isBranchId(parsed.activeBranchId) ? parsed.activeBranchId : "shop-1";
    return {
      year: Number(parsed.year) || year,
      dbName: branches.find((branch) => branch.id === activeBranchId)?.dbName || dbName,
      theme: normalizeTheme(parsed.theme),
      activeBranchId,
      branches,
    };
  } catch {
    return { year, dbName: "", theme: "dark", activeBranchId: "shop-1", branches: defaultBranches() };
  }
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const current = loadSettings();
  const next: AppSettings = {
    ...current,
    ...patch,
    branches: patch.branches ? normalizeBranches(patch.branches) : current.branches,
    activeBranchId: patch.activeBranchId && isBranchId(patch.activeBranchId) ? patch.activeBranchId : current.activeBranchId,
  };
  const active = next.branches.find((branch) => branch.id === next.activeBranchId);
  if (active && patch.dbName == null) next.dbName = active.dbName;
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function activeBranch(settings: AppSettings = loadSettings()): BranchSlot {
  return settings.branches.find((branch) => branch.id === settings.activeBranchId) ?? settings.branches[0];
}

export function patchBranch(id: BranchId, patch: Partial<Omit<BranchSlot, "id">>): AppSettings {
  const settings = loadSettings();
  const branches = settings.branches.map((branch) => (branch.id === id ? { ...branch, ...patch, id } : branch));
  const extra: Partial<AppSettings> = { branches };
  if (id === settings.activeBranchId && patch.dbName != null) extra.dbName = patch.dbName;
  return saveSettings(extra);
}

export function applyTheme(theme: ThemeId = loadSettings().theme): ThemeId {
  const next = normalizeTheme(theme);
  document.documentElement.dataset.theme = next;
  document.documentElement.style.colorScheme = next;
  return next;
}
