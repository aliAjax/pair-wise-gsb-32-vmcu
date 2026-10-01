/* eslint-disable no-console */
import assert from 'node:assert/strict';
import {
  BatchState,
  InvalidationReason,
  InvalidationState,
  SegmentType,
  SyncEventType,
  VariantState,
} from '../src/constants/sync';
import type { ChangeEvent, ChangeBatch, UpsertDayItemPayload } from '../src/models/sync';
import { project, reduceEvents, digestOf, buildSnapshot, mapKey, type BasePlan } from '../src/sync/reducer';
import { applyBatch } from '../src/sync/engine';
import { seedSpots } from '../src/api/spotApi';
import { effectiveBudget, canShare } from '../src/sync/projection';

const spots = seedSpots;
const spot = (id: string) => spots.find((s) => s.id === id)!;
const base: BasePlan = { title: '山区徒步三日', budget: 3000, members: ['我', '队长'] };
const TRIP = 'trip-1';
let seq = 0;
const ev = (
  type: SyncEventType,
  segment: SegmentType,
  member: string,
  happened_at: string,
  payload: unknown,
  base_version = 0,
): ChangeEvent => ({
  id: `e${++seq}`,
  trip_id: TRIP,
  type,
  segment,
  member,
  happened_at,
  base_version,
  payload: payload as never,
});

const dayItem = (
  member: string,
  at: string,
  time: [string, string],
  base_version = 0,
): ChangeEvent => {
  const payload: UpsertDayItemPayload = {
    day_index: 1,
    date: '2026-10-03',
    spot_id: 'spot-park',
    start_time: time[0],
    end_time: time[1],
    note: `${member}的版本`,
    transport: 'walk',
  };
  return ev(SyncEventType.UPSERT_DAY_ITEM, SegmentType.DAY_ITEMS, member, at, payload, base_version);
};

const results: string[] = [];
const test = (name: string, fn: () => void) => {
  try {
    fn();
    results.push(`  ✓ ${name}`);
  } catch (error) {
    results.push(`  ✗ ${name}\n    ${(error as Error).message}`);
    process.exitCode = 1;
  }
};

// 1. 同一出发前版本，两人改同天同景点 → 并列保留，队长选定前不计入预算/分享
test('同天同景点两人改动并列保留，选定前排除出预算和分享', () => {
  const events = [dayItem('队长', '2026-10-03T01:10:00Z', ['09:00', '11:00']), dayItem('阿岭', '2026-10-03T01:40:00Z', ['10:30', '12:30'])];
  const acc = reduceEvents(events, base);
  const p = project(acc, spots);
  assert.equal(p.variants.length, 1, '应有 1 个并列项');
  assert.equal(p.variants[0].state, VariantState.PENDING);
  assert.equal(p.variants[0].options.length, 2, '两个成员版本并列');
  assert.equal(p.included_cost, 0, '选定前该景点不计入预算');
  assert.equal(p.excluded_items, 2);
  assert.equal(canShare(p), false, '选定前不可分享');
});

// 2. 队长选定后 → 唯一安排计入预算/分享
test('队长选定后计入预算且可分享', () => {
  const leader = dayItem('队长', '2026-10-03T01:10:00Z', ['09:00', '11:00']);
  const mate = dayItem('阿岭', '2026-10-03T01:40:00Z', ['10:30', '12:30']);
  const resolve = ev(
    SyncEventType.RESOLVE_VARIANT,
    SegmentType.DAY_ITEMS,
    '队长',
    '2026-10-03T05:00:00Z',
    {
      key: { day_index: 1, date: '2026-10-03', spot_id: 'spot-park' },
      chosen_event_id: mate.id,
    },
  );
  const acc = reduceEvents([leader, mate, resolve], base);
  const p = project(acc, spots);
  assert.equal(p.variants[0].state, VariantState.CHOSEN);
  assert.equal(p.days[0].items.length, 1, '只保留选定的一条，不多出安排');
  assert.equal(p.days[0].items[0].member, '阿岭');
  assert.equal(p.included_cost, spot('spot-park').price, '选定景点价格计入预算');
  assert.equal(canShare(p), true);
});

// 3. 不同段直接接上：先预算，再安排，最后景点反馈；顺序与事件加入顺序无关
test('分段按固定顺序接入（旅行计划→每日安排→景点反馈）', () => {
  const item = dayItem('队长', '2026-10-03T01:10:00Z', ['09:00', '11:00']);
  const budgetEv = ev(SyncEventType.SET_BUDGET, SegmentType.TRIP_META, '队长', '2026-10-02T20:00:00Z', { budget: 2500 });
  const acc = reduceEvents([item, budgetEv], base);
  const p = project(acc, spots);
  assert.equal(p.budget, 2500);
  assert.equal(p.days.length, 1);
});

// 4. 批次在景点反馈段前中断 → 前两段完整，第三段不接入；快照停在上次完整结果
test('批次中断后从上次完整结果继续', () => {
  const item = dayItem('队长', '2026-10-03T01:10:00Z', ['09:00', '11:00']);
  const price = ev(
    SyncEventType.SPOT_PRICE_CHANGED,
    SegmentType.SPOT_FEED,
    '阿岭',
    '2026-10-03T03:00:00Z',
    { spot_id: 'spot-park', new_price: 999 },
  );
  const all = [item, price];
  const batch: ChangeBatch = {
    id: 'b1',
    trip_id: TRIP,
    label: '中断批',
    state: BatchState.OPEN,
    event_ids: all.map((e) => e.id),
    processed_count: 0,
    created_at: '2026-10-03T04:00:00Z',
  };

  const interrupted = applyBatch(batch, all, new Set(), { interruptBeforeSegmentIndex: 2 });
  assert.equal(interrupted.interrupted, true);
  assert.equal(interrupted.batch.state, BatchState.INTERRUPTED);
  assert.equal(interrupted.batch.processed_count, 2, '前两段完整');
  assert.deepEqual(interrupted.newlyApplied.map((e) => e.id), [item.id], '价格反馈未接入');

  const resumed = applyBatch(interrupted.batch, all, new Set([item.id]));
  assert.equal(resumed.batch.state, BatchState.APPLIED);
  assert.equal(resumed.batch.processed_count, 3);
  assert.deepEqual(resumed.newlyApplied.map((e) => e.id), [price.id], '从中断点继续补上价格反馈');
});

// 5. 重放同批：已合入事件全部去重，不多出安排；摘要一致
test('重放同批幂等，摘要稳定', () => {
  const events = [dayItem('队长', '2026-10-03T01:10:00Z', ['09:00', '11:00'])];
  const batch: ChangeBatch = {
    id: 'b2',
    trip_id: TRIP,
    label: '已合入批',
    state: BatchState.APPLIED,
    event_ids: events.map((e) => e.id),
    processed_count: 3,
    created_at: '2026-10-03T04:00:00Z',
    applied_at: '2026-10-03T04:01:00Z',
  };
  const committed = new Set(events.map((e) => e.id));
  const replay = applyBatch(batch, events, committed);
  assert.equal(replay.newlyApplied.length, 0, '重放不产生新安排');
  assert.equal(replay.duplicates.length, 1);
  assert.equal(digestOf(events), digestOf([...events].reverse()), '摘要与输入顺序无关');
});

// 6. 景点价格变化 → 相关日期失效待确认；确认前不进预算，确认后按新价；旧快照保留
test('景点价格变化：失效待确认→确认后按新价，旧结果可查看', () => {
  const marketItem: UpsertDayItemPayload = {
    day_index: 3,
    date: '2026-10-05',
    spot_id: 'spot-market',
    start_time: '18:00',
    end_time: '20:00',
    note: '夜市',
    transport: 'walk',
  };
  const addMarket = ev(SyncEventType.UPSERT_DAY_ITEM, SegmentType.DAY_ITEMS, '阿岭', '2026-10-03T02:20:00Z', marketItem);

  // 旧结果：价格变化前，按原价计入
  const before = project(reduceEvents([addMarket], base), spots);
  assert.equal(before.included_cost, spot('spot-market').price);
  const oldSnapshot = buildSnapshot({ version: 1, events: [addMarket], base, spots });
  assert.equal(oldSnapshot.included_cost, spot('spot-market').price);

  const price = ev(SyncEventType.SPOT_PRICE_CHANGED, SegmentType.SPOT_FEED, '阿岭', '2026-10-03T03:00:00Z', {
    spot_id: 'spot-market',
    new_price: 150,
  });
  const pending = project(reduceEvents([addMarket, price], base), spots);
  const inv = pending.invalidations[0];
  assert.equal(inv.state, InvalidationState.PENDING);
  assert.deepEqual(inv.affected_dates, ['2026-10-05']);
  assert.equal(pending.included_cost, 0, '待确认期间相关日期不计入预算');
  assert.equal(canShare(pending), false);

  const confirm = ev(SyncEventType.CONFIRM_INVALIDATION, SegmentType.SPOT_FEED, '队长', '2026-10-03T06:00:00Z', {
    invalidation_id: inv.id,
  });
  const confirmed = project(reduceEvents([addMarket, price, confirm], base), spots);
  assert.equal(confirmed.invalidations[0].state, InvalidationState.CONFIRMED);
  assert.equal(confirmed.included_cost, 150, '确认价格变化后按新价计入');
  assert.equal(oldSnapshot.included_cost, spot('spot-market').price, '旧快照仍是原价，旧结果可查看');
  assert.equal(canShare(confirmed), true);
});

// 7. 景点停业 → 相关日期失效，即便确认也不回到预算/分享（旧快照仍在）
test('景点停业：确认后相关日期仍移出预算', () => {
  const marketItem: UpsertDayItemPayload = {
    day_index: 3,
    date: '2026-10-05',
    spot_id: 'spot-market',
    start_time: '18:00',
    end_time: '20:00',
    note: '夜市',
    transport: 'walk',
  };
  const addMarket = ev(SyncEventType.UPSERT_DAY_ITEM, SegmentType.DAY_ITEMS, '阿岭', '2026-10-03T02:20:00Z', marketItem);
  const closed = ev(SyncEventType.SPOT_CLOSED, SegmentType.SPOT_FEED, '阿岭', '2026-10-03T03:00:00Z', {
    spot_id: 'spot-market',
  });
  const acc0 = reduceEvents([addMarket, closed], base);
  const inv0 = project(acc0, spots).invalidations[0];
  assert.equal(inv0.reason, InvalidationReason.CLOSED);
  const confirm = ev(SyncEventType.CONFIRM_INVALIDATION, SegmentType.SPOT_FEED, '队长', '2026-10-03T06:00:00Z', {
    invalidation_id: inv0.id,
  });
  const confirmed = project(reduceEvents([addMarket, closed, confirm], base), spots);
  assert.equal(confirmed.included_cost, 0, '停业确认后不回预算');
  assert.equal(confirmed.days[0].items.length, 1, '安排仍在当天可查看，只是不计入');
});

// 8. 基于更新版本合入 → 直接接续，不产生并列
test('基于更新出发前版本的改动直接接续，不并列', () => {
  const leader = dayItem('队长', '2026-10-03T01:10:00Z', ['09:00', '11:00'], 0);
  const newer = dayItem('阿岭', '2026-10-03T02:10:00Z', ['07:00', '08:30'], 1);
  const acc = reduceEvents([leader, newer], base);
  const p = project(acc, spots);
  assert.equal(p.variants.length, 0, '高版本接续不产生并列');
  assert.equal(p.days[0].items.length, 1);
  assert.equal(p.days[0].items[0].member, '阿岭');
});

// 9. 预算口径辅助
test('effectiveBudget 统计待处理数', () => {
  const events = [dayItem('队长', '2026-10-03T01:10:00Z', ['09:00', '11:00']), dayItem('阿岭', '2026-10-03T01:40:00Z', ['10:30', '12:30'])];
  const p = project(reduceEvents(events, base), spots);
  const b = effectiveBudget(p);
  assert.equal(b.spent, 0);
  assert.equal(b.remaining, 3000);
  assert.equal(b.pendingCount, 1);
  void mapKey;
});

console.log(results.join('\n'));
if (process.exitCode) console.log('\n有失败用例');
else console.log(`\n全部 ${results.length} 组逻辑用例通过`);
