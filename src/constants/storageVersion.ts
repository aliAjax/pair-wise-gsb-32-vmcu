export const STORAGE_VERSION = 'tripweaver-v1';
export const STORAGE_KEYS = {
  trips: STORAGE_VERSION + ':trips',
  spots: STORAGE_VERSION + ':spots',
  dayPlans: STORAGE_VERSION + ':dayPlans',
  theme: STORAGE_VERSION + ':theme',
  /** 离线同步：事件流、分段批次、队长选定、景点变化登记、历史快照 */
  changes: STORAGE_VERSION + ':sync.changes',
  batches: STORAGE_VERSION + ':sync.batches',
  decisions: STORAGE_VERSION + ':sync.decisions',
  revisions: STORAGE_VERSION + ':sync.revisions',
  snapshots: STORAGE_VERSION + ':sync.snapshots',
};
