import { SEGMENT_ORDER } from '../constants/sync';
import {
  BatchState,
  InvalidationReason,
  InvalidationState,
  ProjectionGate,
  SyncEventType,
  VariantState,
} from '../constants/sync';
import type {
  ChangeEvent,
  ChangeBatch,
  DayItemKey,
  Invalidation,
  PlanProjection,
  PlanSnapshot,
  ProjectionDay,
  SnapshotDay,
  SpotOverride,
  UpsertDayItemPayload,
  VariantOption,
} from '../models/sync';
import type { Spot } from '../models/spot';

/** 归约起点：出发前的旅行计划（version 0） */
export interface BasePlan {
  title: string;
  budget: number;
  members: string[];
}

interface InternalOption extends VariantOption {
  alive: boolean;
}

interface Acc {
  title: string;
  budget: number;
  members: string[];
  /** mapKey -> 同天同景点的各成员改动 */
  groups: Map<string, { key: DayItemKey; options: InternalOption[] }>;
  /** mapKey -> 队长选定的 event_id */
  chosen: Map<string, string>;
  /** spot_id -> 失效记录 */
  invalidations: Map<string, Invalidation>;
  overrides: Map<string, SpotOverride>;
}

export const mapKey = (key: DayItemKey) => `${key.day_index}§${key.date}§${key.spot_id}`;

/** 段与段之间直接接上：先旅行计划，再每日安排，最后景点反馈；段内按时刻排序 */
export function orderEvents(events: ChangeEvent[]): ChangeEvent[] {
  return [...events].sort((a, b) => {
    const seg = SEGMENT_ORDER.indexOf(a.segment) - SEGMENT_ORDER.indexOf(b.segment);
    if (seg !== 0) return seg;
    const time = a.happened_at.localeCompare(b.happened_at);
    if (time !== 0) return time;
    return a.id.localeCompare(b.id);
  });
}

function newAcc(base: BasePlan): Acc {
  return {
    title: base.title,
    budget: base.budget,
    members: [...base.members],
    groups: new Map(),
    chosen: new Map(),
    invalidations: new Map(),
    overrides: new Map(),
  };
}

function toOption(event: ChangeEvent): InternalOption {
  const p = event.payload as UpsertDayItemPayload;
  return {
    event_id: event.id,
    member: event.member,
    happened_at: event.happened_at,
    base_version: event.base_version,
    start_time: p.start_time,
    end_time: p.end_time,
    note: p.note,
    transport: p.transport,
    alive: true,
  };
}

/** 收集当前安排里出现某景点的日期 */
function datesUsingSpot(acc: Acc, spotId: string): string[] {
  const dates = new Set<string>();
  acc.groups.forEach((group) => {
    if (group.key.spot_id !== spotId) return;
    if (group.options.some((o) => o.alive)) dates.add(group.key.date);
  });
  return [...dates].sort();
}

function refreshInvalidation(acc: Acc, event: ChangeEvent, reason: InvalidationReason, newPrice?: number) {
  const p = event.payload as { spot_id: string };
  const spotId = p.spot_id;
  const affected = datesUsingSpot(acc, spotId);
  const prev = acc.invalidations.get(spotId);
  if (prev) {
    // 停业优先于价格变化；新的反馈进来需要队长重新确认
    const upgraded = reason === InvalidationReason.CLOSED && prev.reason !== InvalidationReason.CLOSED;
    const priceMoved =
      reason === InvalidationReason.PRICE_CHANGED && newPrice !== undefined && prev.new_price !== newPrice;
    prev.reason = reason === InvalidationReason.CLOSED ? InvalidationReason.CLOSED : prev.reason;
    prev.affected_dates = Array.from(new Set([...prev.affected_dates, ...affected])).sort();
    prev.new_price = prev.reason === InvalidationReason.PRICE_CHANGED ? (newPrice ?? prev.new_price) : undefined;
    prev.reported_by = event.member;
    prev.happened_at = event.happened_at;
    if (upgraded || priceMoved) {
      prev.state = InvalidationState.PENDING;
      prev.confirmed_at = undefined;
    }
  } else {
    acc.invalidations.set(spotId, {
      id: `inv-${spotId}`,
      spot_id: spotId,
      reason,
      state: InvalidationState.PENDING,
      affected_dates: affected,
      new_price: reason === InvalidationReason.PRICE_CHANGED ? newPrice : undefined,
      reported_by: event.member,
      happened_at: event.happened_at,
    });
  }
}

export function applyEvent(acc: Acc, event: ChangeEvent): Acc {
  switch (event.type) {
    case SyncEventType.SET_BUDGET:
      acc.budget = (event.payload as { budget: number }).budget;
      break;
    case SyncEventType.SET_TITLE:
      acc.title = (event.payload as { title: string }).title;
      break;
    case SyncEventType.ADD_MEMBER: {
      const member = (event.payload as { member: string }).member;
      if (!acc.members.includes(member)) acc.members.push(member);
      break;
    }
    case SyncEventType.UPSERT_DAY_ITEM: {
      const p = event.payload as UpsertDayItemPayload;
      const key: DayItemKey = { day_index: p.day_index, date: p.date, spot_id: p.spot_id };
      const mk = mapKey(key);
      const group = acc.groups.get(mk);
      const incoming = toOption(event);
      if (!group) {
        acc.groups.set(mk, { key, options: [incoming] });
        break;
      }
      const own = group.options.find((o) => o.alive && o.member === event.member);
      const alive = group.options.filter((o) => o.alive);
      if (own) {
        // 同一成员再次编辑：覆盖自己之前的版本
        Object.assign(own, incoming);
        own.alive = true;
      } else if (alive.length && event.base_version > Math.max(...alive.map((o) => o.base_version))) {
        // 基于更新版本合入：直接接续，旧分支被取代（不同段直接接上）
        group.options.forEach((o) => (o.alive = false));
        group.options.push(incoming);
      } else {
        // 两个成员从同一出发前版本分叉，或拿着旧版本来合：同天同景点并列保留
        group.options.push(incoming);
      }
      break;
    }
    case SyncEventType.DELETE_DAY_ITEM: {
      const p = event.payload as DayItemKey;
      const group = acc.groups.get(mapKey(p));
      group?.options.forEach((o) => {
        if (o.alive && o.member === event.member) o.alive = false;
      });
      break;
    }
    case SyncEventType.SPOT_CLOSED: {
      const p = event.payload as { spot_id: string };
      acc.overrides.set(p.spot_id, { kind: 'closed', at: event.happened_at });
      refreshInvalidation(acc, event, InvalidationReason.CLOSED);
      break;
    }
    case SyncEventType.SPOT_PRICE_CHANGED: {
      const p = event.payload as { spot_id: string; new_price: number };
      acc.overrides.set(p.spot_id, { kind: 'price', new_price: p.new_price, at: event.happened_at });
      refreshInvalidation(acc, event, InvalidationReason.PRICE_CHANGED, p.new_price);
      break;
    }
    case SyncEventType.RESOLVE_VARIANT: {
      const p = event.payload as import('../models/sync').ResolveVariantPayload;
      acc.chosen.set(mapKey(p.key), p.chosen_event_id);
      break;
    }
    case SyncEventType.CONFIRM_INVALIDATION: {
      const p = event.payload as import('../models/sync').ConfirmInvalidationPayload;
      const inv = [...acc.invalidations.values()].find((item) => item.id === p.invalidation_id);
      if (inv) {
        inv.state = InvalidationState.CONFIRMED;
        inv.confirmed_at = event.happened_at;
      }
      break;
    }
  }
  return acc;
}

/** 把已排序的一批事件重放到出发前计划上（幂等：同一批事件重放结果一致） */
export function reduceEvents(events: ChangeEvent[], base: BasePlan): Acc {
  return orderEvents(events).reduce<Acc>((acc, event) => applyEvent(acc, event), newAcc(base));
}

function effectivePrice(spotId: string, catalogPrice: number, acc: Acc): number {
  const inv = acc.invalidations.get(spotId);
  const override = acc.overrides.get(spotId);
  // 价格变化已确认 → 用新价计入预算；否则仍用出发前价格（待确认不生效）
  if (inv && inv.state === InvalidationState.CONFIRMED && override?.kind === 'price') {
    return override.new_price;
  }
  return catalogPrice;
}

function buildVariant(key: DayItemKey, alive: InternalOption[], chosenId: string | undefined) {
  return {
    key,
    state: chosenId ? VariantState.CHOSEN : VariantState.PENDING,
    gate: chosenId ? ProjectionGate.INCLUDED : ProjectionGate.EXCLUDED,
    options: alive.map(({ event_id, member, happened_at, base_version, start_time, end_time, note, transport }) => ({
      event_id,
      member,
      happened_at,
      base_version,
      start_time,
      end_time,
      note,
      transport,
    })),
    chosen_event_id: chosenId,
  };
}

/** 归约结果 → 对外投影：区分“已计入预算/分享”和“待裁决/待确认” */
export function project(acc: Acc, spots: Spot[]): PlanProjection {
  const spotMap = new Map(spots.map((s) => [s.id, s]));
  const daysMap = new Map<string, ProjectionDay>();
  const variants: PlanProjection['variants'] = [];
  let includedCost = 0;
  let excludedItems = 0;

  const ensureDay = (key: DayItemKey): ProjectionDay => {
    const dk = mapKey(key);
    let day = daysMap.get(dk);
    if (!day) {
      day = { day_index: key.day_index, date: key.date, items: [] };
      daysMap.set(dk, day);
    }
    return day;
  };

  const pushItem = (day: ProjectionDay, spotId: string, option: InternalOption, include: boolean) => {
    day.items.push({
      spot_id: spotId,
      start_time: option.start_time,
      end_time: option.end_time,
      note: option.note,
      transport: option.transport,
      source_event_id: option.event_id,
      member: option.member,
    });
    if (include) includedCost += effectivePrice(spotId, spotMap.get(spotId)?.price ?? 0, acc);
  };

  acc.groups.forEach((group) => {
    const key = group.key;
    const alive = group.options.filter((o) => o.alive);
    if (!alive.length) return;
    const chosenId = acc.chosen.get(mapKey(key));
    const chosen = chosenId ? alive.find((o) => o.event_id === chosenId) : undefined;
    const inv = acc.invalidations.get(key.spot_id);
    // 相关日期失效：待确认、或景点已停业，都不计入预算/分享（旧结果仍可在快照查看）
    const blocked = !!inv && (inv.state === InvalidationState.PENDING || inv.reason === InvalidationReason.CLOSED);
    const day = ensureDay(key);

    if (chosen) {
      pushItem(day, key.spot_id, chosen, !blocked);
      variants.push(buildVariant(key, alive, chosenId));
      if (blocked) excludedItems += 1;
      return;
    }

    if (alive.length >= 2) {
      // 同天同景点两人动过：并列保留，队长选定前不计入预算和分享
      variants.push(buildVariant(key, alive, undefined));
      excludedItems += alive.length;
      return;
    }

    pushItem(day, key.spot_id, alive[0], !blocked);
    if (blocked) excludedItems += 1;
  });

  const invalidations = [...acc.invalidations.values()];
  const days = [...daysMap.values()].sort((a, b) => a.day_index - b.day_index || a.date.localeCompare(b.date));

  return {
    title: acc.title,
    budget: acc.budget,
    members: acc.members,
    days,
    variants,
    invalidations,
    included_cost: includedCost,
    excluded_items: excludedItems,
    ready_to_share:
      variants.every((v) => v.state === VariantState.CHOSEN) &&
      invalidations.every((i) => i.state === InvalidationState.CONFIRMED),
  };
}

/** 稳定摘要：重放同批事件，摘要必须一致（不多出安排） */
export function digestOf(events: ChangeEvent[]): string {
  const canonical = orderEvents(events)
    .map((e) => `${e.id}|${e.type}|${e.segment}|${e.member}|${e.happened_at}|${e.base_version}|${JSON.stringify(e.payload)}`)
    .join(';;');
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i += 1) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export interface SnapshotInput {
  version: number;
  events: ChangeEvent[];
  base: BasePlan;
  spots: Spot[];
}

/** 生成不可变旧结果快照（旧结果仍可查看） */
export function buildSnapshot({ version, events, base, spots }: SnapshotInput): PlanSnapshot {
  const acc = reduceEvents(events, base);
  const projection = project(acc, spots);
  const days: SnapshotDay[] = projection.days.map((day) => ({
    day_index: day.day_index,
    date: day.date,
    items: day.items,
  }));
  return {
    version,
    digest: digestOf(events),
    created_at: new Date().toISOString(),
    event_ids: orderEvents(events).map((e) => e.id),
    title: projection.title,
    budget: projection.budget,
    members: projection.members,
    days,
    pending_variants: projection.variants.filter((v) => v.state === VariantState.PENDING).length,
    pending_invalidations: projection.invalidations.filter((i) => i.state === InvalidationState.PENDING).length,
    included_cost: projection.included_cost,
  };
}

/** 批次是否已完整合入（中断恢复时据此判断从哪一段继续） */
export function isBatchApplied(batch: ChangeBatch): boolean {
  return batch.state === BatchState.APPLIED && batch.processed_count >= SEGMENT_ORDER.length;
}
