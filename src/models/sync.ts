import {
  BatchState,
  InvalidationReason,
  InvalidationState,
  ProjectionGate,
  SegmentType,
  SyncEventType,
  VariantState,
} from '../constants/sync';

/** 旅行计划段改动负载 */
export interface SetBudgetPayload {
  budget: number;
}
export interface SetTitlePayload {
  title: string;
}
export interface AddMemberPayload {
  member: string;
}

/**
 * 每日安排段的最小键：同一天同一景点。
 * 两个离线成员对同一个 key 各改一次时刻，就会产生并列项。
 */
export interface DayItemKey {
  day_index: number;
  date: string;
  spot_id: string;
}

export interface UpsertDayItemPayload extends DayItemKey {
  start_time: string;
  end_time: string;
  note: string;
  transport: 'walk' | 'metro' | 'taxi' | 'train';
}
export interface DeleteDayItemPayload extends DayItemKey {}

/** 景点反馈段负载 */
export interface SpotClosedPayload {
  spot_id: string;
}
export interface SpotPriceChangedPayload {
  spot_id: string;
  new_price: number;
}

/** 队长裁决：在某个并列项里选定某个成员的版本 */
export interface ResolveVariantPayload {
  key: DayItemKey;
  chosen_event_id: string;
}
export interface ConfirmInvalidationPayload {
  invalidation_id: string;
  /** 队长确认时可以选择重新安排日期，留空表示维持原日期仅做确认 */
  reschedule_date?: string;
}

export type SyncPayload =
  | SetBudgetPayload
  | SetTitlePayload
  | AddMemberPayload
  | UpsertDayItemPayload
  | DeleteDayItemPayload
  | SpotClosedPayload
  | SpotPriceChangedPayload
  | ResolveVariantPayload
  | ConfirmInvalidationPayload;

/**
 * 一条离线改动。
 * - member：是谁改的（徒步队成员）；
 * - happened_at：改动时刻（ISO）；
 * - base_version：出发前/改动前看到的已合入版本号；
 * - segment：属于哪一段（计划 / 每日安排 / 景点反馈）。
 */
export interface ChangeEvent<T extends SyncPayload = SyncPayload> {
  id: string;
  trip_id: string;
  type: SyncEventType;
  segment: SegmentType;
  member: string;
  happened_at: string;
  base_version: number;
  payload: T;
}

/**
 * 分段批次：一批离线改动回到有信号的地方合入。
 * - segments：不同段直接接上，按 SEGMENT_ORDER 顺序处理；
 * - processed_count：中断恢复时从上次完整段继续的游标。
 */
export interface ChangeBatch {
  id: string;
  trip_id: string;
  label: string;
  state: BatchState;
  event_ids: string[];
  /** 已完整处理完的段数；从中断点恢复时从这里继续 */
  processed_count: number;
  created_at: string;
  applied_at?: string;
}

/** 同一个 (天, 景点) 下，不同成员给出的并列选项 */
export interface VariantOption {
  event_id: string;
  member: string;
  happened_at: string;
  base_version: number;
  start_time: string;
  end_time: string;
  note: string;
  transport: UpsertDayItemPayload['transport'];
}

/** 同一天同一景点被两人动过 → 并列保留，队长选定前不计入预算和分享 */
export interface PlanVariant {
  key: DayItemKey;
  state: VariantState;
  gate: ProjectionGate;
  options: VariantOption[];
  chosen_event_id?: string;
}

export interface Invalidation {
  id: string;
  spot_id: string;
  reason: InvalidationReason;
  state: InvalidationState;
  /** 受影响的日期 */
  affected_dates: string[];
  /** 价格变化时，新价格；旧结果仍可查看 */
  new_price?: number;
  reported_by: string;
  happened_at: string;
  confirmed_at?: string;
}

/** 旧结果快照：重放同批不能多出安排，旧结果也始终可查看 */
export interface PlanSnapshot {
  version: number;
  digest: string;
  created_at: string;
  /** 生成该结果时已合入的事件 id 集合 */
  event_ids: string[];
  title: string;
  budget: number;
  members: string[];
  days: SnapshotDay[];
  /** 当时被排除（队长未选定）的并列项数量 */
  pending_variants: number;
  /** 当时待确认的景点失效数量 */
  pending_invalidations: number;
  /** 计入预算/分享的安排对应总价 */
  included_cost: number;
}

export interface SnapshotDay {
  day_index: number;
  date: string;
  items: Array<{
    spot_id: string;
    start_time: string;
    end_time: string;
    note: string;
    transport: UpsertDayItemPayload['transport'];
    /** 该条来自哪个成员的哪次改动 */
    source_event_id: string;
    member: string;
  }>;
}

/** 对外投影：分“已计入”和“待队长裁决/确认”两栏 */
export interface PlanProjection {
  title: string;
  budget: number;
  members: string[];
  days: ProjectionDay[];
  variants: PlanVariant[];
  invalidations: Invalidation[];
  /** 计入预算 / 分享的安排总价（未选定的并列项、未确认失效日期不计入） */
  included_cost: number;
  excluded_items: number;
  ready_to_share: boolean;
}

export interface ProjectionDay {
  day_index: number;
  date: string;
  items: SnapshotDay['items'];
}

/** 景点目录的在线覆盖：停业 / 新价；旧结果快照里仍保留当时的价格 */
export type SpotOverride =
  | { kind: 'closed'; at: string }
  | { kind: 'price'; new_price: number; at: string };

export interface SyncState {
  events: ChangeEvent[];
  batches: ChangeBatch[];
  /** 每次完整合入后产生的不可变快照 */
  snapshots: PlanSnapshot[];
  /** 当前已合入到第几版（事件计数） */
  head_version: number;
  /** 景点 id -> 在线覆盖（合并自景点反馈段，以最后一条确认为准） */
  spotOverrides: Record<string, SpotOverride>;
}
