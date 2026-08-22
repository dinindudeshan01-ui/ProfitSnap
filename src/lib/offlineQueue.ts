'use client';

// A real offline queue, not just "block and show a message" (which is
// what useOnline.ts alone gives you). When someone submits a sale or
// stock-in while offline, the action is stored here instead of being
// lost — then automatically replayed, in order, the moment the device
// reconnects. This is what makes "offline support" actually mean
// something for a shop with patchy signal, rather than just a clearer
// error message.
//
// Scope note: this is for WRITE actions that don't need a live network
// round-trip to produce their result (recording a sale, adding stock —
// the numbers are already known client-side). The scan/OCR flow can't
// use this pattern — it inherently needs Gemini to respond before there
// is anything to save, so there's nothing meaningful to queue.

import { openDB, DBSchema, IDBPDatabase } from 'idb';

interface QueuedAction {
  id: string;
  type: 'sale' | 'stock_in';
  payload: unknown;
  createdAt: number;
  lastError?: string;
}

interface OfflineDB extends DBSchema {
  queue: {
    key: string;
    value: QueuedAction;
  };
}

let dbPromise: Promise<IDBPDatabase<OfflineDB>> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<OfflineDB>('profitsnap-offline', 1, {
      upgrade(db) {
        db.createObjectStore('queue', { keyPath: 'id' });
      },
    });
  }
  return dbPromise;
}

export async function enqueueAction(type: QueuedAction['type'], payload: unknown): Promise<string> {
  const db = await getDb();
  const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await db.put('queue', { id, type, payload, createdAt: Date.now() });
  return id;
}

export async function getQueuedActions(type?: QueuedAction['type']): Promise<QueuedAction[]> {
  const db = await getDb();
  const all = await db.getAll('queue');
  const sorted = all.sort((a, b) => a.createdAt - b.createdAt);
  return type ? sorted.filter((a) => a.type === type) : sorted;
}

export async function removeQueuedAction(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('queue', id);
}

async function markQueuedActionError(id: string, message: string): Promise<void> {
  const db = await getDb();
  const existing = await db.get('queue', id);
  if (existing) await db.put('queue', { ...existing, lastError: message });
}

// Replays every queued action of a given type, in the order they were
// created — order matters here (e.g. two stock-ins on the same product
// must apply in sequence, since the second one's average-cost math
// depends on the first having already landed). Stops at the first
// failure rather than skipping ahead, so a bad item can't let later,
// dependent items apply out of order; failed items stay queued with
// their error recorded, ready to retry on the next flush.
export async function flushQueue(
  type: QueuedAction['type'],
  processFn: (payload: unknown) => Promise<void>
): Promise<{ succeeded: number; remaining: number }> {
  const actions = await getQueuedActions(type);
  let succeeded = 0;
  for (const action of actions) {
    try {
      await processFn(action.payload);
      await removeQueuedAction(action.id);
      succeeded++;
    } catch (err) {
      await markQueuedActionError(action.id, err instanceof Error ? err.message : 'Failed to sync');
      break; // preserve order — stop here, retry from this point next time
    }
  }
  const remaining = (await getQueuedActions(type)).length;
  return { succeeded, remaining };
}
