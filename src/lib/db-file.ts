import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { loadCatalog, loadSales } from "./aronium";
import { deleteBranchHandle, loadBranchHandle, saveBranchHandle } from "./branches";
import { activeBranch, loadSettings, patchBranch, saveSettings, type BranchId } from "./settings";
import { zipStore } from "./zip";

let sqlPromise: Promise<SqlJsStatic> | null = null;
let handle: FileSystemFileHandle | null = null;
let currentDb: Database | null = null;
let currentName = "";
let currentBranchId: BranchId | null = null;

async function sqlEngine(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({ locateFile: () => wasmUrl });
  }
  return sqlPromise;
}

export function hasFileAccess(): boolean {
  return typeof window.showOpenFilePicker === "function";
}

export function connectedName(): string {
  return currentName;
}

export function getDatabase(): Database | null {
  return currentDb;
}

function closeCurrent(): void {
  currentDb?.close();
  currentDb = null;
  handle = null;
  currentName = "";
  currentBranchId = null;
}

export function snapshotActiveBranchStats(): void {
  const settings = loadSettings();
  const branchId = currentBranchId ?? settings.activeBranchId;
  const db = currentDb;
  patchBranch(branchId, {
    dbName: currentName,
    productCount: db ? loadCatalog(db).length : 0,
    salesCount: db ? loadSales(db).length : 0,
  });
}

async function openHandle(picked: FileSystemFileHandle, branchId: BranchId): Promise<string> {
  if (picked.requestPermission) {
    const permission = await picked.requestPermission({ mode: "readwrite" });
    if (permission !== "granted") throw new Error("Read/write permission is required to save sales.");
  }
  handle = picked;
  currentName = picked.name;
  currentBranchId = branchId;
  await reloadFromHandle();
  return currentName;
}

export async function pickDatabaseFor(branchId: BranchId): Promise<string> {
  if (!window.showOpenFilePicker) {
    throw new Error("This browser cannot keep a live file handle. Use Chrome or Edge, or choose a file to download after writing.");
  }
  const [picked] = await window.showOpenFilePicker({
    types: [{ description: "Aronium pos.db", accept: { "application/octet-stream": [".db"] } }],
  });
  await saveBranchHandle(branchId, picked);
  saveSettings({ activeBranchId: branchId, dbName: picked.name });
  const name = await openHandle(picked, branchId);
  snapshotActiveBranchStats();
  return name;
}

export async function pickDatabase(): Promise<string> {
  return pickDatabaseFor(loadSettings().activeBranchId);
}

export async function loadFromFileFor(branchId: BranchId, file: File): Promise<string> {
  await deleteBranchHandle(branchId);
  saveSettings({ activeBranchId: branchId, dbName: file.name });
  handle = null;
  currentName = file.name;
  currentBranchId = branchId;
  const SQL = await sqlEngine();
  currentDb?.close();
  currentDb = new SQL.Database(new Uint8Array(await file.arrayBuffer()));
  snapshotActiveBranchStats();
  return currentName;
}

export async function loadFromFile(file: File): Promise<string> {
  return loadFromFileFor(loadSettings().activeBranchId, file);
}

async function reloadFromHandle(): Promise<void> {
  if (!handle) return;
  const file = await handle.getFile();
  const SQL = await sqlEngine();
  currentDb?.close();
  currentDb = new SQL.Database(new Uint8Array(await file.arrayBuffer()));
  currentName = handle.name;
}

export async function activateBranch(branchId: BranchId): Promise<boolean> {
  const slot = loadSettings().branches.find((branch) => branch.id === branchId) ?? activeBranch();
  saveSettings({ activeBranchId: branchId, dbName: slot.dbName });
  const stored = await loadBranchHandle(branchId);
  if (!stored) {
    if (currentBranchId === branchId && currentDb) return true;
    closeCurrent();
    return false;
  }
  try {
    await openHandle(stored, branchId);
    snapshotActiveBranchStats();
    return true;
  } catch {
    closeCurrent();
    currentName = "";
    return false;
  }
}

export async function restoreActiveBranch(): Promise<boolean> {
  return activateBranch(loadSettings().activeBranchId);
}

export async function branchNeedsReattach(branchId: BranchId): Promise<boolean> {
  const slot = loadSettings().branches.find((branch) => branch.id === branchId);
  if (!slot?.dbName) return false;
  if (currentBranchId === branchId && currentDb) return false;
  return (await loadBranchHandle(branchId)) == null;
}

export function exportBytes(): Uint8Array {
  if (!currentDb) throw new Error("No database loaded.");
  return currentDb.export();
}

export function downloadBytes(bytes: Uint8Array, filename: string): void {
  const copy = new Uint8Array(bytes);
  const blob = new Blob([copy], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function stamp(): string {
  const now = new Date();
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

export function snapshotBytes(): Uint8Array {
  return exportBytes();
}

async function writeInPlace(bytes: Uint8Array): Promise<boolean> {
  if (!handle?.createWritable) return false;
  try {
    if (handle.requestPermission) {
      const permission = await handle.requestPermission({ mode: "readwrite" });
      if (permission !== "granted") return false;
    }
    const writable = await handle.createWritable();
    await writable.write(new Blob([new Uint8Array(bytes)]));
    await writable.close();
    return true;
  } catch {
    return false;
  }
}

export function downloadOriginalAndUpdatedZip(original: Uint8Array, updated: Uint8Array): string {
  const base = (currentName || "pos.db").replace(/\.db$/i, "") || "pos";
  const mark = stamp();
  const zipName = `${base}-original-and-updated-${mark}.zip`;
  const archive = zipStore([
    { name: `original-${base}.db`, data: original },
    { name: `updated-${base}.db`, data: updated },
  ]);
  downloadBytes(archive, zipName);
  return zipName;
}

export async function persistAndDownloadPair(original: Uint8Array): Promise<{
  zipName: string;
  wroteInPlace: boolean;
}> {
  const updated = exportBytes();
  const wroteInPlace = await writeInPlace(updated);
  const zipName = downloadOriginalAndUpdatedZip(original, updated);
  snapshotActiveBranchStats();
  return { zipName, wroteInPlace };
}
