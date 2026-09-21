import type { BranchId } from "./settings";

const IDB_NAME = "pos-sale-sync.v1";
const STORE = "branch-handles";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB failed"));
  });
}

export async function saveBranchHandle(id: BranchId, handle: FileSystemFileHandle): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(handle, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Could not save file handle"));
    });
  } finally {
    db.close();
  }
}

export async function loadBranchHandle(id: BranchId): Promise<FileSystemFileHandle | null> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).get(id);
      request.onsuccess = () => resolve((request.result as FileSystemFileHandle | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error("Could not read file handle"));
    });
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export async function deleteBranchHandle(id: BranchId): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Could not delete file handle"));
    });
  } finally {
    db.close();
  }
}

export async function hasBranchHandle(id: BranchId): Promise<boolean> {
  return (await loadBranchHandle(id)) != null;
}

export async function clearAllBranchHandles(): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Could not clear file handles"));
    });
  } finally {
    db.close();
  }
}
