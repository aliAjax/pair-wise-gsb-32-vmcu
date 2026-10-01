import dayjs from 'dayjs';
import { ChangeOp, SpotChangeKind, VariantStatus } from '../constants/sync';
import type { FieldVariant, TripChange } from '../models/change';
import type { LeaderDecision, SpotRevision, SyncBatch } from '../models/sync';
import type { DayPlan, DayPlanItem } from '../models/dayPlan';
import type { Spot } from '../models/spot';
import type { Trip } from '../models/trip';

/** 出发前原版在并列候选中的虚拟 changeId */
export const BASE_CHANGE_ID = '__base__';

/** 投影后的单个安排：带来源成员、版本、并列状态与失效标记 */
export interface EffectiveItem extends DayPlanItem {
  changeId: string;
  member: string;
  baseVersion: string;
  happenedAt: string;
  /** base=出发前原版；selected=单人编辑或队长已选定；pending=并列待选定；invalid=停业/调价待确认 */
  status: 'base' | 'selected' | 'pending' | 'invalid';
  op: ChangeOp;
  conflictKey: string;
  staleReason: string;
}

export interface EffectiveDay {
  day_index: number;
  date: string;
  items: EffectiveItem[];
  /** 当天存在景点停业/调价且队长尚未确认 */
  stale: boolean;
  staleReasons: string[];
}

export interface FieldConflict {
  field: string;
  conflictKey: string;
  variants: FieldVariant[];
  resolved: boolean;
  selectedChangeId: string;
}

export interface EffectivePlan {
  version: string;
  trip: Trip;
  days: EffectiveDay[];
  fieldConflicts: FieldConflict[];
  /** 尚未选定的冲突键（选定前不计入预算和分享） */
  pendingConflictKeys: string[];
  completedBatches: SyncBatch[];
}

interface ProjectArgs {
  trip: Trip;
  baseDays: DayPlan[];
  spots: Spot[];
  changes: TripChange[];
  batches: SyncBatch[];
  decisions: LeaderDecision[];
  revisions: SpotRevision[];
}

/** 取所有"已重放"的事件：中断批次截断到恢复点，保证重放同批不会多出安排 */
export function selectLiveChanges(changes: TripChange[], batches: SyncBatch[]): TripChange[] {
  const live: TripChange[] = [];
  const orderedBatches = [...batches].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const batch of orderedBatches) {
    const batchChanges = changes
      .filter((change) => change.batchId === batch.id)
      .sort((a, b) => a.happenedAt.localeCompare(b.happenedAt) || a.id.localeCompare(b.id));
    if (batch.status === 'completed') {
      live.push(...batchChanges);
    } else if (batch.status === 'partial') {
      const count = Math.min(batch.appliedCount, batchChanges.length);
      live.push(...batchChanges.slice(0, count));
    }
    // pending 批次的事件尚未重放，不进入投影
  }
  return live;
}

/** 同一冲突键下，每个成员只保留最新一条（离线多次编辑以最后一次为准） */
function latestByMember(changes: TripChange[]): Map<string, TripChange> {
  const map = new Map<string, TripChange>();
  for (const change of changes) {
    const prev = map.get(change.member);
    if (!prev || prev.happenedAt <= change.happenedAt) map.set(change.member, change);
  }
  return map;
}

function deriveDate(trip: Trip, dayIndex: number): string {
  return dayjs(trip.start_date).add(dayIndex - 1, 'day').format('YYYY-MM-DD');
}

function applyFieldValue(trip: Trip, field: string, value: string): Trip {
  const next = { ...trip };
  if (field === 'budget') next.budget = Number(value) || 0;
  else if (field === 'members') next.members = value.split(/[,，]/).map((item) => item.trim()).filter(Boolean);
  else if (field === 'start_date' || field === 'end_date') (next as unknown as Record<string, unknown>)[field] = value;
  return next;
}

const FIELD_LABELS: Record<string, string> = {
  budget: '预算',
  members: '同行人',
  start_date: '出发日期',
  end_date: '返程日期',
};

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] || field;
}

/**
 * 事件溯源投影：出发前基线 + 已重放事件 => 当前生效行程。
 * 纯函数，同样的输入永远得到同样的输出（重放幂等的基础）。
 */
export function projectEffectivePlan(args: ProjectArgs): EffectivePlan {
  const { trip, baseDays, spots, changes, batches, decisions, revisions } = args;
  const decisionMap = new Map(decisions.filter((item) => item.tripId === trip.id).map((item) => [item.conflictKey, item]));
  const liveChanges = selectLiveChanges(changes.filter((change) => change.tripId === trip.id), batches);

  const completedBatches = batches
    .filter((batch) => batch.tripId === trip.id && batch.status === 'completed')
    .sort((a, b) => (a.completedAt || '').localeCompare(b.completedAt || ''));
  const version = completedBatches.length ? `v${completedBatches.length}` : 'v0';

  // ---- 1. trip 级字段（预算/成员/日期）：按成员并列，队长选定前保留出发前值 ----
  const fieldConflicts: FieldConflict[] = [];
  let effectiveTrip = trip;
  const fieldEvents = liveChanges.filter((change) => change.target === 'trip' && change.field);
  const fieldGroups = new Map<string, TripChange[]>();
  for (const change of fieldEvents) {
    const key = change.field as string;
    fieldGroups.set(key, [...(fieldGroups.get(key) || []), change]);
  }
  for (const [field, group] of fieldGroups) {
    const latest = latestByMember(group);
    const variants: FieldVariant[] = [...latest.values()]
      .filter((change) => change.op === ChangeOp.UPSERT)
      .map((change) => ({
        changeId: change.id,
        member: change.member,
        op: change.op,
        value: change.value || '',
        baseVersion: change.baseVersion,
        happenedAt: change.happenedAt,
      }));
    const baseValue = field === 'members' ? trip.members.join(',') : String((trip as unknown as Record<string, unknown>)[field] ?? '');
    variants.unshift({
      changeId: BASE_CHANGE_ID,
      member: '出发前原版',
      op: ChangeOp.UPSERT,
      value: baseValue,
      baseVersion: 'v0',
      happenedAt: trip.created_at,
    });
    const conflictKey = `field:${field}`;
    const decision = decisionMap.get(conflictKey);
    const memberIds = new Set([...latest.keys()]);
    let resolved = false;
    let selectedChangeId = '';
    if (decision) {
      resolved = true;
      selectedChangeId = decision.selectedChangeId;
      if (selectedChangeId !== BASE_CHANGE_ID) {
        const picked = variants.find((item) => item.changeId === selectedChangeId);
        if (picked) effectiveTrip = applyFieldValue(effectiveTrip, field, picked.value);
      }
    } else if (memberIds.size === 1) {
      // 只有一个人动过：直接生效（基线候选仍在，队长可改选回退）
      const only = [...latest.values()][0];
      if (only.op === ChangeOp.UPSERT) {
        resolved = true;
        selectedChangeId = only.id;
        effectiveTrip = applyFieldValue(effectiveTrip, field, only.value || '');
      }
    }
    fieldConflicts.push({ field, conflictKey, variants, resolved, selectedChangeId });
  }

  // ---- 2. 天/景点安排：按 `${day}:${spot}` 归并，两人同动 => 并列保留 ----
  const tripDays = baseDays.filter((day) => day.trip_id === trip.id);
  const dayMap = new Map<number, DayPlan>();
  for (const day of tripDays) dayMap.set(day.day_index, day);
  // 分段直接接上：任何事件提到的天、任何已重放分段覆盖的天都进入行程
  const dayIndexes = new Set<number>(dayMap.keys());
  for (const change of liveChanges) {
    if (change.target === 'item' && change.dayIndex !== null) dayIndexes.add(change.dayIndex);
  }
  for (const batch of completedBatches) batch.segmentDays.forEach((index) => dayIndexes.add(index));

  const itemGroups = new Map<string, TripChange[]>();
  for (const change of liveChanges.filter((item) => item.target === 'item' && item.dayIndex !== null && item.spotId)) {
    const key = `${change.dayIndex}:${change.spotId}`;
    itemGroups.set(key, [...(itemGroups.get(key) || []), change]);
  }

  const staleRevisions = revisions.filter((revision) => revision.changedAt);
  const isDayAcked = (revision: SpotRevision, dayIndex: number) => revision.acknowledgedDayIndexes.includes(String(dayIndex));

  const days: EffectiveDay[] = [...dayIndexes].sort((a, b) => a - b).map((dayIndex) => {
    const baseDay = dayMap.get(dayIndex);
    const baseItems = new Map<string, DayPlanItem>();
    for (const item of baseDay?.items || []) {
      if (!baseItems.has(item.spot_id)) baseItems.set(item.spot_id, item);
    }

    const rendered: EffectiveItem[] = [];
    const dayStaleReasons = new Set<string>();

    const keysForDay = [...itemGroups.keys()].filter((key) => key.startsWith(`${dayIndex}:`));
    for (const key of keysForDay) {
      const spotId = key.slice(key.indexOf(':') + 1);
      const group = itemGroups.get(key) || [];
      const latest = latestByMember(group);
      const members = [...latest.keys()];
      const decision = decisionMap.get(key);
      const baseItem = baseItems.get(spotId);

      // 失效判定：停业 / 调价，相关日期失效待确认
      const revision = staleRevisions
        .filter((item) => item.spotId === spotId && item.affectedDayIndexes.includes(dayIndex))
        .sort((a, b) => a.changedAt.localeCompare(b.changedAt))[0];
      const acked = revision ? isDayAcked(revision, dayIndex) : false;
      const closedAndAcked = revision?.kind === SpotChangeKind.CLOSED && acked;
      const staleReason = !revision || acked
        ? ''
        : revision.kind === SpotChangeKind.CLOSED ? '景点已停业，日期待队长确认' : '票价已调整，日期待队长确认';

      const pushItem = (source: DayPlanItem, meta: { changeId: string; member: string; baseVersion: string; happenedAt: string; status: EffectiveItem['status']; op: ChangeOp }) => {
        if (closedAndAcked) return; // 队长已确认停业：该景点从当天撤下，其余安排继续生效
        const status: EffectiveItem['status'] = staleReason ? 'invalid' : meta.status;
        if (staleReason) dayStaleReasons.add(staleReason);
        rendered.push({ ...source, conflictKey: key, staleReason, ...meta, status });
      };

      if (decision) {
        const pickedId = decision.selectedChangeId;
        if (pickedId === BASE_CHANGE_ID) {
          if (baseItem) {
            pushItem(baseItem, { changeId: BASE_CHANGE_ID, member: '出发前原版', baseVersion: 'v0', happenedAt: trip.created_at, status: 'base', op: ChangeOp.UPSERT });
          }
        } else {
          const picked = latest.get(
            [...latest.entries()].find(([, change]) => change.id === pickedId)?.[0] || '',
          );
          if (picked && picked.op === ChangeOp.UPSERT && picked.item) {
            pushItem(picked.item, { changeId: picked.id, member: picked.member, baseVersion: picked.baseVersion, happenedAt: picked.happenedAt, status: 'selected', op: ChangeOp.UPSERT });
          }
          // 选定的是"删除"候选 => 当天不再渲染该景点
        }
      } else if (members.length === 0) {
        if (baseItem) {
          pushItem(baseItem, { changeId: BASE_CHANGE_ID, member: '出发前原版', baseVersion: 'v0', happenedAt: trip.created_at, status: 'base', op: ChangeOp.UPSERT });
        }
      } else if (members.length === 1) {
        const only = [...latest.values()][0];
        if (only.op === ChangeOp.UPSERT && only.item) {
          pushItem(only.item, { changeId: only.id, member: only.member, baseVersion: only.baseVersion, happenedAt: only.happenedAt, status: 'selected', op: ChangeOp.UPSERT });
        }
        // 单人删除：直接撤下（没有第二个人动过，不存在覆盖同伴的问题）
      } else {
        // 同一天同一景点被两人（或以上）动过：出发前原版 + 每人版本并列保留，选定前均为 pending
        if (baseItem) {
          pushItem(baseItem, { changeId: BASE_CHANGE_ID, member: '出发前原版', baseVersion: 'v0', happenedAt: trip.created_at, status: 'pending', op: ChangeOp.UPSERT });
        }
        for (const member of members) {
          const change = latest.get(member) as TripChange;
          if (change.op === ChangeOp.REMOVE) {
            // 删除也是一种并列候选，供队长选择
            pushItem(
              { spot_id: spotId, start_time: '--:--', end_time: '--:--', note: `${member} 离线删除了该安排`, transport: 'walk' },
              { changeId: change.id, member, baseVersion: change.baseVersion, happenedAt: change.happenedAt, status: 'pending', op: ChangeOp.REMOVE },
            );
          } else if (change.item) {
            pushItem(change.item, { changeId: change.id, member, baseVersion: change.baseVersion, happenedAt: change.happenedAt, status: 'pending', op: ChangeOp.UPSERT });
          }
        }
      }
    }

    // 完全没人动过、也没归并到上面循环的基线景点
    for (const [spotId, item] of baseItems) {
      const key = `${dayIndex}:${spotId}`;
      if (!keysForDay.includes(key)) {
        const revision = staleRevisions.find((rev) => rev.spotId === spotId && rev.affectedDayIndexes.includes(dayIndex));
        const acked = revision ? isDayAcked(revision, dayIndex) : false;
        if (revision?.kind === SpotChangeKind.CLOSED && acked) continue;
        const reason = revision && !acked
          ? (revision.kind === SpotChangeKind.CLOSED ? '景点已停业，日期待队长确认' : '票价已调整，日期待队长确认')
          : '';
        if (reason) dayStaleReasons.add(reason);
        rendered.push({
          ...item,
          changeId: BASE_CHANGE_ID,
          member: '出发前原版',
          baseVersion: 'v0',
          happenedAt: trip.created_at,
          status: reason ? 'invalid' : 'base',
          op: ChangeOp.UPSERT,
          conflictKey: key,
          staleReason: reason,
        });
      }
    }

    return {
      day_index: dayIndex,
      date: baseDay?.date || deriveDate(effectiveTrip, dayIndex),
      items: rendered.sort((a, b) => a.start_time.localeCompare(b.start_time)),
      stale: dayStaleReasons.size > 0,
      staleReasons: [...dayStaleReasons],
    };
  });

  const pendingConflictKeys = [
    ...new Set(days.flatMap((day) => day.items.filter((item) => item.status === 'pending').map((item) => item.conflictKey))),
    ...fieldConflicts.filter((conflict) => !conflict.resolved).map((conflict) => conflict.conflictKey),
  ];

  return { version, trip: effectiveTrip, days, fieldConflicts, pendingConflictKeys, completedBatches };
}

/** 候选状态文案（供 UI 与分享文本共用） */
export function variantStatusOf(item: EffectiveItem): VariantStatus {
  if (item.status === 'pending') return VariantStatus.PENDING;
  return item.changeId === BASE_CHANGE_ID ? VariantStatus.DISCARDED : VariantStatus.SELECTED;
}

/** 把投影结果转成可分享文本；pending / invalid 项不计入分享 */
export function planToShareText(plan: EffectivePlan, spots: Spot[], priceMap?: Record<string, number>): string {
  const spotMap = new Map(spots.map((spot) => [spot.id, spot]));
  const lines: string[] = [`《${plan.trip.title}》行程单（合并版本 ${plan.version}）`];
  for (const day of plan.days) {
    const visible = day.items.filter((item) => item.status !== 'pending' && item.status !== 'invalid');
    lines.push(`第 ${day.day_index} 天 · ${day.date}${day.stale ? '（部分日期待确认）' : ''}`);
    if (!visible.length) {
      lines.push('  （无确定安排）');
      continue;
    }
    for (const item of visible) {
      const spot = spotMap.get(item.spot_id);
      const price = priceMap?.[item.spot_id] ?? spot?.price ?? 0;
      lines.push(`  ${item.start_time}-${item.end_time} ${spot?.name || item.spot_id}（${item.member || '原版'}）¥${price}`);
    }
  }
  return lines.join('\n');
}
