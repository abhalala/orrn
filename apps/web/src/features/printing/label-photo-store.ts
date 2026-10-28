import { useCallback, useEffect, useState } from "react";

/**
 * The photo a label design was traced from, kept in this browser only (IndexedDB, keyed by
 * template id) as a JPEG data URL. It is never sent to the server: it is a drawing aid for the
 * person who took it, on the device they took it with.
 */

const DB_NAME = "orrn-label-photos";
const STORE = "photos";

let opening: Promise<IDBDatabase> | null = null;

function database(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch((error: unknown) => {
    opening = null;
    throw error;
  });
  return opening;
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise<T>((resolve, reject) => {
    const request = action(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadTracingPhoto(templateId: string): Promise<string | null> {
  const value = await run<unknown>("readonly", (store) => store.get(templateId));
  return typeof value === "string" ? value : null;
}

export async function saveTracingPhoto(templateId: string, dataUrl: string): Promise<void> {
  await run("readwrite", (store) => store.put(dataUrl, templateId));
}

export async function deleteTracingPhoto(templateId: string): Promise<void> {
  await run("readwrite", (store) => store.delete(templateId));
}

/** The design's tracing photo, if this browser has one, with save and remove. */
export function useTracingPhoto(templateId: string) {
  const [photo, setPhoto] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    setPhoto(null);
    loadTracingPhoto(templateId)
      .then((found) => {
        if (current) setPhoto(found);
      })
      .catch(() => {
        // Private browsing or storage turned off: the studio works without a photo.
      });
    return () => {
      current = false;
    };
  }, [templateId]);
  const save = useCallback(
    async (dataUrl: string) => {
      await saveTracingPhoto(templateId, dataUrl);
      setPhoto(dataUrl);
    },
    [templateId],
  );
  const remove = useCallback(async () => {
    await deleteTracingPhoto(templateId);
    setPhoto(null);
  }, [templateId]);
  return { photo, save, remove };
}
