import Dexie, { type Table } from 'dexie';
import { STORAGE_VERSION } from '../constants/storageVersion';
import { messages } from '../constants/messages';

class TripWeaverDb extends Dexie {
  trips!: Table<unknown, string>;
  spots!: Table<unknown, string>;
  dayPlans!: Table<unknown, string>;
  syncChanges!: Table<unknown, string>;
  syncBatches!: Table<unknown, string>;
  syncSnapshots!: Table<unknown, string>;
  constructor() {
    super('tripweaver');
    this.version(1).stores({ trips: 'id,status,destination', spots: 'id,category', dayPlans: 'id,trip_id,day_index' });
    // v2：离线分段批次同步的事件流 / 批次 / 快照表（localStorage 仍是主存储，Dexie 预留给后续扩展）
    this.version(2).stores({
      trips: 'id,status,destination',
      spots: 'id,category',
      dayPlans: 'id,trip_id,day_index',
      syncChanges: 'id,tripId,batchId',
      syncBatches: 'id,tripId,status',
      syncSnapshots: 'id,tripId,version',
    });
  }
}

export const db = new TripWeaverDb();

export function loadLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed.version === STORAGE_VERSION ? parsed.data as T : fallback;
  } catch {
    console.warn(messages.storageRecovered);
    return fallback;
  }
}

export function saveLocal<T>(key: string, data: T) {
  localStorage.setItem(key, JSON.stringify({ version: STORAGE_VERSION, data, updatedAt: new Date().toISOString() }));
}
