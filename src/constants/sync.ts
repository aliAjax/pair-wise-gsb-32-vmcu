/**
 * 离线分段批次同步相关枚举。
 * SpotCategory / TripStatus 之外的第三组共享枚举：
 * 被 models/change、models/sync、api/syncApi、stores/syncStore、
 * utils/syncReducer、pages/SyncCenter 及 components/sync/* 共同引用。
 */

/** 一条离线改动的操作类型：写入（新增/编辑）或删除 */
export enum ChangeOp {
  UPSERT = 'upsert',
  REMOVE = 'remove',
}

/** 改动作用对象：整段旅行信息（预算/成员/日期）或某天某景点安排 */
export enum ChangeTarget {
  TRIP = 'trip',
  ITEM = 'item',
}

/** 批次状态：待处理 / 中断（部分已重放）/ 已完整重放 */
export enum BatchStatus {
  PENDING = 'pending',
  PARTIAL = 'partial',
  COMPLETED = 'completed',
}

/** 并列结果的处置状态：待队长选定 / 已选定 / 已弃用 */
export enum VariantStatus {
  PENDING = 'pending',
  SELECTED = 'selected',
  DISCARDED = 'discarded',
}

/** 景点侧发生的变化：停业 / 价格调整 */
export enum SpotChangeKind {
  CLOSED = 'closed',
  PRICE = 'price',
}

/** 出发前基线版本号：还没有任何完整批次时使用 */
export const BASE_VERSION_INIT = 'v0';
