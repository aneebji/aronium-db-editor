import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";

let sqlPromise: Promise<SqlJsStatic> | null = null;
let handle: FileSystemFileHandle | null = null;
let currentDb: Database | null = null;
let currentName = "";

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

export async function pickDatabase(): Promise<string> {
  if (!window.showOpenFilePicker) {
    throw new Error("This browser cannot keep a live file handle. Use Chrome or Edge, or choose a file to download after writing.");
  }
  const [picked] = await window.showOpenFilePicker({
    types: [{ description: "Aronium pos.db", accept: { "application/octet-stream": [".db"] } }],
  });
  if (picked.requestPermission) {
    const permission = await picked.requestPermission({ mode: "readwrite" });
    if (permission !== "granted") throw new Error("Read/write permission is required to save sales.");
  }
  handle = picked;
  currentName = picked.name;
  await reloadFromHandle();
  return currentName;
}

export async function loadFromFile(file: File): Promise<string> {
  handle = null;
  currentName = file.name;
  const SQL = await sqlEngine();
  currentDb?.close();
  currentDb = new SQL.Database(new Uint8Array(await file.arrayBuffer()));
  return currentName;
}

async function reloadFromHandle(): Promise<void> {
  if (!handle) return;
  const file = await handle.getFile();
  const SQL = await sqlEngine();
  currentDb?.close();
  currentDb = new SQL.Database(new Uint8Array(await file.arrayBuffer()));
  currentName = handle.name;
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

export function backupCurrent(): string {
  const backupName = `${currentName || "pos.db"}.bak-${stamp()}`;
  downloadBytes(exportBytes(), backupName);
  return backupName;
}

export async function persistDatabase(): Promise<boolean> {
  const next = exportBytes();
  if (handle?.createWritable) {
    try {
      if (handle.requestPermission) {
        const permission = await handle.requestPermission({ mode: "readwrite" });
        if (permission !== "granted") throw new Error("write denied");
      }
      const writable = await handle.createWritable();
      await writable.write(new Blob([new Uint8Array(next)]));
      await writable.close();
      return true;
    } catch {
      downloadBytes(next, currentName || "pos.db");
      return false;
    }
  }
  downloadBytes(next, currentName || "pos.db");
  return false;
}
