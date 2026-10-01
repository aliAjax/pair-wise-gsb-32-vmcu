/**
 * 离线分段批次合并相关的枚举与常量。
 *
 * 对应需求：
 * - 旅行计划 / 每日安排 / 景点 被拆成分段批次（segment）逐段接入；
 * - 每个改动都带成员、时刻、出发前版本（baseVersion）；
 * - 批次中断后从上次完整结果（checkpoint）继续；
 * - 景点停业或价格变化后，相关日期失效待队长确认。
 */

/** 分段类型：把旅行计划、每日安排、景点接成分段批次 */
export enum SegmentType {
  TRIP_META = 'trip_meta',
  DAY_ITEMS = 'day_items',
  SPOT_FEED = 'spot_feed',
}

/** 每一类分段里允许发生的改动 */
export enum SyncEventType {
  /** 旅行计划：改预算 / 改标题 / 加同行人 */
  SET_BUDGET = 'set_budget',
  SET_TITLE = 'set_title',
  ADD_MEMBER = 'add_member',
  /** 每日安排：加入或更新某一天某景点的时刻；删除安排 */
  UPSERT_DAY_ITEM = 'upsert_day_item',
  DELETE_DAY_ITEM = 'delete_day_item',
  /** 景点：停业 / 价格变化（上报当天仍在线，回信号才合入） */
  SPOT_CLOSED = 'spot_closed',
  SPOT_PRICE_CHANGED = 'spot_price_changed',
  /** 队长裁决：冲突并列项里选定一个 */
  RESOLVE_VARIANT = 'resolve_variant',
  /** 队长确认景点失效：确认后相关日期才真正移出预算/分享 */
  CONFIRM_INVALIDATION = 'confirm_invalidation',
}

/** 批次处理状态：中断后可以从 OPEN 继续 */
export enum BatchState {
  OPEN = 'open',
  PROCESSING = 'processing',
  INTERRUPTED = 'interrupted',
  APPLIED = 'applied',
}

/** 并列保留的同天同景点改动，在队长选定前的状态 */
export enum VariantState {
  PENDING = 'pending',
  CHOSEN = 'chosen',
}

/** 队长选定前，预算 / 分享 是否计入该改动 */
export enum ProjectionGate {
  EXCLUDED = 'excluded',
  INCLUDED = 'included',
}

/** 景点当前的失效原因 */
export enum InvalidationReason {
  CLOSED = 'closed',
  PRICE_CHANGED = 'price_changed',
}

/** 失效确认状态 */
export enum InvalidationState {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
}

/** 没有任何已合入结果时的出发前基线版本 */
export const BASELINE_VERSION = 0;

/** 段与段之间直接接上的固定顺序 */
export const SEGMENT_ORDER: SegmentType[] = [
  SegmentType.TRIP_META,
  SegmentType.DAY_ITEMS,
  SegmentType.SPOT_FEED,
];

export const segmentTypeText: Record<SegmentType, string> = {
  [SegmentType.TRIP_META]: '旅行计划',
  [SegmentType.DAY_ITEMS]: '每日安排',
  [SegmentType.SPOT_FEED]: '景点反馈',
};

export const invalidationReasonText: Record<InvalidationReason, string> = {
  [InvalidationReason.CLOSED]: '景点停业',
  [InvalidationReason.PRICE_CHANGED]: '价格变化',
};
