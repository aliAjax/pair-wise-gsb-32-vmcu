import { BatchStatus, SpotChangeKind, VariantStatus } from '../constants/sync';

/**
 * 分段批次：两名队员离线分头改同一行程，回信号后按批次合并。
 *
 * - segmentDays：本段负责的天，不同段直接接上（拼接，不覆盖别段）
 * - baseVersion：出发前版本，事件携带，用于识别同一行的并行改动
 * - appliedCount：已重放条数；中断后从这里继续，重放同批不会多出安排
 */
export interface SyncBatch {
  id: string;
  tripId: string;
  label: string;
  member: string;
  segmentDays: number[];
  baseVersion: string;
  status: BatchStatus;
  /** 中断恢复点：已经完整重放的事件条数 */
  appliedCount: number;
  createdAt: string;
  completedAt: string | null;
}

/** 队长对某个冲突键的选定结果（选定前该冲突项不计入预算和分享） */
export interface LeaderDecision {
  tripId: string;
  /** item 冲突键 `${dayIndex}:${spotId}`，trip 字段冲突键 `field:${name}` */
  conflictKey: string;
  /** 选中的改动 id；'__base__' 表示保留出发前原样 */
  selectedChangeId: string;
  decidedBy: string;
  decidedAt: string;
}

/** 并列候选的运行时状态（由投影器推导，不持久化） */
export interface VariantState {
  status: VariantStatus;
  selected: boolean;
}

/** 景点停业 / 价格变化登记。发生后相关日期失效待确认，旧结果仍可查看 */
export interface SpotRevision {
  id: string;
  spotId: string;
  kind: SpotChangeKind;
  /** kind=price 时的新价格（景点目录价格随之更新，历史快照仍保留旧价） */
  newPrice: number | null;
  changedAt: string;
  /** 受影响的行程天；这些天在队长确认前视为失效 */
  affectedDayIndexes: number[];
  /** 队长确认的天；确认后重新按最新景点信息计入 */
  acknowledgedDayIndexes: string[];
}

/**
 * 历史合并结果快照。
 * 每个批次完整重放后产生一个版本快照，旧结果仍可查看；
 * 景点停业/价格变化只让相关日期在当前结果中失效，不删除旧快照。
 */
export interface SyncSnapshot {
  id: string;
  tripId: string;
  version: string;
  batchId: string;
  batchLabel: string;
  createdAt: string;
  /** 快照时刻的旅行副本（含预算/成员） */
  trip: unknown;
  /** 快照时刻的每日安排副本 */
  days: unknown;
  /** 快照时刻的景点价格表副本，保证旧结果金额可复现 */
  priceMap: Record<string, number>;
  /** 快照时刻仍未选定的并列项，供旧结果查看时标注 */
  pendingConflictKeys: string[];
}
