const DB_NAME = 'local-editing-studio-media';
const STORE_NAME = 'files';
const DB_VERSION = 1;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error('Could not open local media storage.'));
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
  });
}

export async function saveLocalMedia(id: string, file: File): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(file, id);
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not save local media.'));
    transaction.oncomplete = () => resolve();
  });
  database.close();
}

export async function getLocalMedia(id: string): Promise<File | undefined> {
  const database = await openDatabase();
  const file = await new Promise<File | undefined>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id);
    request.onerror = () => reject(request.error ?? new Error('Could not read local media.'));
    request.onsuccess = () => resolve(request.result as File | undefined);
  });
  database.close();
  return file;
}

export async function deleteLocalMedia(id: string): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(id);
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not delete local media.'));
    transaction.oncomplete = () => resolve();
  });
  database.close();
}

export async function clearLocalMedia(): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).clear();
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not clear local media.'));
    transaction.oncomplete = () => resolve();
  });
  database.close();
}

export async function restoreLocalAssets<T extends { id: string }>(
  assets: T[],
): Promise<{ assets: (T & { url: string })[]; missingIds: string[] }> {
  const restored: (T & { url: string })[] = [];
  const missingIds: string[] = [];

  for (const asset of assets) {
    const file = await getLocalMedia(asset.id).catch(() => undefined);
    if (!file) {
      missingIds.push(asset.id);
      continue;
    }
    restored.push({ ...asset, url: URL.createObjectURL(file) });
  }

  return { assets: restored, missingIds };
}