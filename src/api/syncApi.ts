import { STORAGE_KEYS } from '../constants/storageVersion';
import { loadLocal, saveLocal } from '../utils/storage';
import { BASELINE_VERSION } from '../constants/sync';
import type { SyncState } from '../models/sync';

export const emptySyncState = (): SyncState => ({
  events: [],
  batches: [],
  snapshots: [],
  head_version: BASELINE_VERSION,
  spotOverrides: {},
});

export const syncApi = {
  load: (): SyncState => loadLocal<SyncState>(STORAGE_KEYS.syncState, emptySyncState()),
  save: (state: SyncState) => saveLocal(STORAGE_KEYS.syncState, state),
  isSeeded: (): boolean => loadLocal<boolean>(STORAGE_KEYS.syncSeeded, false),
  markSeeded: () => saveLocal(STORAGE_KEYS.syncSeeded, true),
  clearSeeded: () => localStorage.removeItem(STORAGE_KEYS.syncSeeded),
};
