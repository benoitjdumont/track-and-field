import type { RecordedSession, Waypoint } from '../types/track';

const DB_NAME = 'track_and_field_db';
const DB_VERSION = 1;
const STORE_NAME = 'sessions';

interface StoredWaypoint extends Omit<Waypoint, 'mediaUrl'> {
  mediaUrl: string;
  mediaBlob?: Blob;
}

export interface StoredSession extends Omit<RecordedSession, 'waypoints'> {
  waypoints: StoredWaypoint[];
  savedAtIso: string;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function resolveBlobForMedia(url: string): Promise<Blob | undefined> {
  if (!url) return undefined;
  try {
    if (url.startsWith('blob:') || url.startsWith('data:')) {
      const res = await fetch(url);
      return await res.blob();
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export async function saveSessionToPhone(session: RecordedSession): Promise<void> {
  const db = await openDB();
  const storedWaypoints: StoredWaypoint[] = await Promise.all(
    session.waypoints.map(async (wp) => {
      const blob = await resolveBlobForMedia(wp.mediaUrl);
      return {
        ...wp,
        mediaBlob: blob,
      };
    })
  );

  const record: StoredSession = {
    ...session,
    waypoints: storedWaypoints,
    savedAtIso: new Date().toISOString(),
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listSavedSessionsFromPhone(): Promise<RecordedSession[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => {
      const raw = (req.result as StoredSession[]) || [];
      const hydrated: RecordedSession[] = raw
        .sort((a, b) => (b.savedAtIso || b.dateIso).localeCompare(a.savedAtIso || a.dateIso))
        .map((s) => ({
          id: s.id,
          title: s.title,
          dateIso: s.dateIso,
          points: s.points,
          stats: s.stats,
          waypoints: s.waypoints.map((wp) => ({
            ...wp,
            mediaUrl: wp.mediaBlob ? URL.createObjectURL(wp.mediaBlob) : wp.mediaUrl,
          })),
        }));
      resolve(hydrated);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteSessionFromPhone(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
