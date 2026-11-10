// Attachments of a capture: a photo (from the camera or the gallery) or a voice note, sent to the hub's upload route
// once the engine made the task (`POST /api/tasks/upload?id=<area>/<slug>`). Until then the file waits on the phone,
// in a store of its own (`FileStore`), next to the write that makes the task; the queue holds only what names it.
//
// The phone keeps files of shown areas only (MOB-02): a file belongs to the write of its area, and a write of an
// area that may not be shown any more is dropped on reading back, its files with it (`WriteQueue.load`).

/** The largest file the phone takes: the limit is named next to the buttons. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
/** The most files of one capture. */
export const MAX_FILES = 3;
/** The longest voice note: the recording stops by itself then. */
export const MAX_VOICE_MS = 5 * 60 * 1000;

export type AttachmentKind = 'photo' | 'voice';

/** What names a file that waits on the phone. */
export interface AttachmentRef {
  /** The key of the file in the `FileStore`. */
  key: string;
  /** The name the asset gets in the vault. */
  name: string;
  /** The media type the file was made with. */
  type: string;
  size: number;
  kind: AttachmentKind;
}

/** A file picked or recorded, before the capture is made. */
export interface NewAttachment {
  blob: Blob;
  kind: AttachmentKind;
}

export type AttachmentProblem = 'too_big' | 'too_many' | 'wrong_type' | 'empty';

/** The media types the page takes: images and audio, nothing a browser would run. */
export function acceptedType(kind: AttachmentKind, type: string): boolean {
  const base = type.split(';')[0]!.trim().toLowerCase();
  if (kind === 'photo') return /^image\/(jpeg|png|webp|heic|heif|gif)$/.test(base);
  return /^audio\/(webm|ogg|mp4|mpeg|aac|wav|x-m4a)$/.test(base);
}

/** Can this file be added to a capture that has `count` files already? */
export function checkAttachment(file: NewAttachment, count: number): AttachmentProblem | null {
  if (count >= MAX_FILES) return 'too_many';
  if (!acceptedType(file.kind, file.blob.type)) return 'wrong_type';
  if (file.blob.size === 0) return 'empty';
  if (file.blob.size > MAX_FILE_BYTES) return 'too_big';
  return null;
}

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/gif': 'gif',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/aac': 'aac',
  'audio/wav': 'wav',
};

/**
 * The name of the asset: made here from the kind and the time, never from the phone's file name (it may say more than
 * it should, and the hub cleans it anyway). `photo-2026-11-10-1130-2.jpg`; `n` tells files of one capture apart.
 */
export function assetName(kind: AttachmentKind, type: string, at: Date, n: number): string {
  const pad = (v: number) => String(v).padStart(2, '0');
  const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}`;
  const ext = EXTENSIONS[type.split(';')[0]!.trim().toLowerCase()] ?? (kind === 'photo' ? 'img' : 'audio');
  return `${kind}-${stamp}${n > 1 ? `-${n}` : ''}.${ext}`;
}

/** A size for people: `820 KB`, `3.4 MB`. */
export function sizeText(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** An `AttachmentRef` read back from the phone's storage, checked (MSEC-13); `null` when it is not one. */
export function restoreRef(value: unknown): AttachmentRef | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const kind = v['kind'];
  if (kind !== 'photo' && kind !== 'voice') return null;
  if (typeof v['key'] !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(v['key'])) return null;
  if (typeof v['name'] !== 'string' || !/^[A-Za-z0-9._-]{1,120}$/.test(v['name'])) return null;
  if (typeof v['type'] !== 'string' || !acceptedType(kind, v['type'])) return null;
  if (!Number.isInteger(v['size']) || (v['size'] as number) <= 0 || (v['size'] as number) > MAX_FILE_BYTES) return null;
  return { key: v['key'], name: v['name'], type: v['type'].slice(0, 100), size: v['size'] as number, kind };
}

/** Where the files wait (IndexedDB in the page, memory in the tests). Every failure of a read is a miss. */
export interface FileStore {
  put(key: string, blob: Blob): Promise<void>;
  get(key: string): Promise<Blob | null>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
  clear(): Promise<void>;
}

export function memoryFileStore(): FileStore & { files: Map<string, Blob> } {
  const files = new Map<string, Blob>();
  return {
    files,
    put: async (key, blob) => void files.set(key, blob),
    get: async (key) => files.get(key) ?? null,
    delete: async (key) => void files.delete(key),
    keys: async () => [...files.keys()],
    clear: async () => files.clear(),
  };
}

/** The files in IndexedDB of this origin (`tasks-mobile-files`); they go when the phone is unpaired (MSEC-12). */
export function indexedDbFileStore(factory: IDBFactory): FileStore {
  const DB = 'tasks-mobile-files';
  const STORE = 'files';
  let opened: Promise<IDBDatabase> | null = null;
  const db = (): Promise<IDBDatabase> => {
    opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        opened = null;
        reject(req.error ?? new Error('indexedDB'));
      };
    });
    return opened;
  };
  const run = async <T>(mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const store = (await db()).transaction(STORE, mode).objectStore(STORE);
    return new Promise<T>((resolve, reject) => {
      const req = work(store);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('indexedDB'));
    });
  };
  return {
    put: async (key, blob) => void (await run('readwrite', (s) => s.put(blob, key))),
    get: async (key) => {
      try {
        const value = await run<unknown>('readonly', (s) => s.get(key));
        return value instanceof Blob ? value : null;
      } catch {
        return null;
      }
    },
    delete: async (key) => {
      try {
        await run('readwrite', (s) => s.delete(key));
      } catch {
        // gone already, or no storage: nothing to delete
      }
    },
    keys: async () => {
      try {
        const keys = await run<IDBValidKey[]>('readonly', (s) => s.getAllKeys());
        return keys.filter((k): k is string => typeof k === 'string');
      } catch {
        return [];
      }
    },
    clear: async () => {
      try {
        await run('readwrite', (s) => s.clear());
      } catch {
        // no storage: nothing kept
      }
    },
  };
}
