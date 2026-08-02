/* Remembering where iRacing puts your telemetry.
 *
 * ┌ WHY THIS IS NOT JUST A TEXT BOX ────────────────────────────────────────┐
 * │ "Set a default path" is the obvious ask, and a browser cannot honour it │
 * │ literally: a web page is not allowed to read C:\Users\...\Telemetry     │
 * │ because a path was typed into it. That restriction is the whole point   │
 * │ of the sandbox and it is not going away.                                │
 * │                                                                         │
 * │ What a browser CAN do — Chromium-based ones, at least — is let you pick │
 * │ the folder ONCE, hold onto a handle to it, and re-open that handle on   │
 * │ every later visit with a single click to confirm. That is what this     │
 * │ module does, and functionally it is the thing that was asked for: after │
 * │ the first visit, "load my newest session" is one click.                 │
 * │                                                                         │
 * │ The handle is not a path and cannot be turned into one. It lives in     │
 * │ IndexedDB because it is structured-cloneable but not JSON, so           │
 * │ localStorage cannot hold it.                                            │
 * │                                                                         │
 * │ On Firefox and Safari, which have no directory picker, everything here  │
 * │ reports itself unavailable and the screen falls back to a plain file    │
 * │ chooser. The rig watcher in /uploader is the answer that works          │
 * │ everywhere, and the screen says so.                                     │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

const DB_NAME = "proctor";
const STORE = "handles";
const KEY = "telemetry-folder";

/* Minimal shapes for the File System Access API. Declared here rather than
   relying on lib.dom, whose coverage of this API varies by TypeScript version —
   a build that fails on a missing global is worse than four interfaces. */
interface FsPermissionDescriptor {
  mode?: "read" | "readwrite";
}
interface FsHandleBase {
  kind: "file" | "directory";
  name: string;
  queryPermission?(d?: FsPermissionDescriptor): Promise<PermissionState>;
  requestPermission?(d?: FsPermissionDescriptor): Promise<PermissionState>;
}
export interface FsFileHandle extends FsHandleBase {
  kind: "file";
  getFile(): Promise<File>;
}
export interface FsDirectoryHandle extends FsHandleBase {
  kind: "directory";
  values(): AsyncIterableIterator<FsFileHandle | FsDirectoryHandle>;
}
type DirectoryPicker = (options?: {
  id?: string;
  mode?: "read" | "readwrite";
  startIn?: string;
}) => Promise<FsDirectoryHandle>;

function picker(): DirectoryPicker | null {
  if (typeof window === "undefined") return null;
  const fn = (window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;
  return typeof fn === "function" ? fn : null;
}

/** True where the browser can remember a folder at all. */
export function supportsFolderMemory(): boolean {
  return picker() != null && typeof indexedDB !== "undefined";
}

// ─────────────────────────────────────────────────────────────────────────────
// The handle store
// ─────────────────────────────────────────────────────────────────────────────

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("could not open the local handle store"));
  });
}

async function put(handle: FsDirectoryHandle | null): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    if (handle) store.put(handle, KEY);
    else store.delete(KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("could not write the folder handle"));
  });
  db.close();
}

async function get(): Promise<FsDirectoryHandle | null> {
  const db = await openDb();
  const handle = await new Promise<FsDirectoryHandle | null>((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve((req.result as FsDirectoryHandle) ?? null);
    req.onerror = () => reject(req.error ?? new Error("could not read the folder handle"));
  });
  db.close();
  return handle;
}

// ─────────────────────────────────────────────────────────────────────────────
// Using it
// ─────────────────────────────────────────────────────────────────────────────

/** The folder chosen on a previous visit, or null. Does NOT prompt. */
export async function rememberedFolder(): Promise<FsDirectoryHandle | null> {
  if (!supportsFolderMemory()) return null;
  try {
    return await get();
  } catch {
    // A blocked or unavailable IndexedDB is not worth failing the screen over.
    return null;
  }
}

/** Ask for a folder and remember it. Throws if the driver cancels the dialog. */
export async function chooseFolder(): Promise<FsDirectoryHandle> {
  const show = picker();
  if (!show) throw new Error("This browser cannot remember a folder. Use Choose a file instead.");
  // `id` makes the browser reopen at the same place next time; `startIn` only
  // applies the very first time, before there is anything to reopen at.
  const handle = await show({ id: "proctor-telemetry", mode: "read", startIn: "documents" });
  await put(handle);
  return handle;
}

export async function forgetFolder(): Promise<void> {
  try {
    await put(null);
  } catch {
    // Nothing to clean up if the store was never reachable.
  }
}

/** Whether the page may still read a remembered folder without prompting.
 *
 *  Chromium drops the grant between visits, so a remembered handle usually
 *  comes back as "prompt" — which is not an error, it is one click. */
export async function folderPermission(
  handle: FsDirectoryHandle,
): Promise<PermissionState> {
  if (!handle.queryPermission) return "granted";
  try {
    return await handle.queryPermission({ mode: "read" });
  } catch {
    return "denied";
  }
}

/** Re-ask for read access. Must be called from a user gesture. */
export async function requestFolderAccess(handle: FsDirectoryHandle): Promise<boolean> {
  if (await folderPermission(handle) === "granted") return true;
  if (!handle.requestPermission) return false;
  try {
    return (await handle.requestPermission({ mode: "read" })) === "granted";
  } catch {
    return false;
  }
}

export interface FoundFile {
  file: File;
  name: string;
  modified: number;
  size: number;
}

/** Every .ibt in the folder, newest first.
 *
 *  Sorted on the file's own modification time rather than on the timestamp in
 *  its name. The two normally agree — iRacing writes both — but where they do
 *  not, the one the filesystem recorded is the one that is a fact. */
export async function listTelemetry(handle: FsDirectoryHandle): Promise<FoundFile[]> {
  const found: FoundFile[] = [];
  for await (const entry of handle.values()) {
    if (entry.kind !== "file" || !/\.ibt$/i.test(entry.name)) continue;
    try {
      const file = await entry.getFile();
      found.push({ file, name: entry.name, modified: file.lastModified, size: file.size });
    } catch {
      // A file being written right now can refuse to open. Skipping it is
      // correct: a half-written .ibt is exactly what must not be uploaded.
    }
  }
  return found.sort((a, b) => b.modified - a.modified);
}

/** The most recent .ibt in the remembered folder, or null if there is none. */
export async function newestTelemetry(handle: FsDirectoryHandle): Promise<FoundFile | null> {
  return (await listTelemetry(handle))[0] ?? null;
}
