import type { TripChange } from '../models/change';
import type { LeaderDecision, SpotRevision, SyncBatch, SyncSnapshot } from '../models/sync';
import { STORAGE_KEYS } from '../constants/storageVersion';
import { loadLocal, saveLocal } from '../utils/storage';

/**
 * 离线同步数据 API 层：事件、批次、选定、景点变化、快照各自独立存取。
 * 纯前端应用里事件流直接落 localStorage，Dexie 表在 utils/storage.ts 中预留。
 */
export const syncApi = {
  listChanges: () => loadLocal<TripChange[]>(STORAGE_KEYS.changes, []),
  saveChanges: (rows: TripChange[]) => saveLocal(STORAGE_KEYS.changes, rows),

  listBatches: () => loadLocal<SyncBatch[]>(STORAGE_KEYS.batches, []),
  saveBatches: (rows: SyncBatch[]) => saveLocal(STORAGE_KEYS.batches, rows),

  listDecisions: () => loadLocal<LeaderDecision[]>(STORAGE_KEYS.decisions, []),
  saveDecisions: (rows: LeaderDecision[]) => saveLocal(STORAGE_KEYS.decisions, rows),

  listRevisions: () => loadLocal<SpotRevision[]>(STORAGE_KEYS.revisions, []),
  saveRevisions: (rows: SpotRevision[]) => saveLocal(STORAGE_KEYS.revisions, rows),

  listSnapshots: () => loadLocal<SyncSnapshot[]>(STORAGE_KEYS.snapshots, []),
  saveSnapshots: (rows: SyncSnapshot[]) => saveLocal(STORAGE_KEYS.snapshots, rows),
};
