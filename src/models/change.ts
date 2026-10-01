import { ChangeOp, ChangeTarget } from '../constants/sync';

/**
 * 离线改动（事件流里的一条事件）。
 *
 * 每条改动都带：
 * - member：改的人（同行人），合并时用来区分"谁动过"
 * - baseVersion：出发前/上次合并时看到的版本
 * - segmentDays：改动覆盖的行程天（分段批次：不同段直接接上）
 * - happenedAt：离线发生时间，同键冲突时按成员各保留一份并列结果
 */
export interface TripChange {
  id: string;
  tripId: string;
  batchId: string;
  member: string;
  op: ChangeOp;
  target: ChangeTarget;
  /** 出行项目：作用于某天某景点；trip 级改动时为 null */
  dayIndex: number | null;
  /** target=item 时冲突键：spot_id；同一天同一景点两人都动过 => 并列 */
  spotId: string | null;
  /** 写入后的项目内容（op=upsert 时有效） */
  item: {
    spot_id: string;
    start_time: string;
    end_time: string;
    note: string;
    transport: 'walk' | 'metro' | 'taxi' | 'train';
  } | null;
  /** target=trip 时改的字段名：budget / members / start_date / end_date */
  field: string | null;
  /** target=trip 且 op=upsert 时的新值（统一字符串存，投影时按字段解释） */
  value: string | null;
  /** 该成员改动时所基于的版本（出发前版本或上一完整批次版本） */
  baseVersion: string;
  /** 所属分段覆盖的天序号，不同分段直接拼接 */
  segmentDays: number[];
  happenedAt: string;
}

/** 同一天同一景点的一份并列候选，保留成员、时刻与来源版本 */
export interface ChangeVariant {
  changeId: string;
  member: string;
  op: ChangeOp;
  start_time: string;
  end_time: string;
  note: string;
  transport: 'walk' | 'metro' | 'taxi' | 'train';
  baseVersion: string;
  happenedAt: string;
}

/** 旅行级字段冲突的并列候选（如两人改了不同预算/成员） */
export interface FieldVariant {
  changeId: string;
  member: string;
  op: ChangeOp;
  value: string;
  baseVersion: string;
  happenedAt: string;
}
