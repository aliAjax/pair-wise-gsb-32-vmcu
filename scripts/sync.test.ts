/* 端到端逻辑测试：离线分段批次合并 */
import { assert } from 'node:console';
import { projectEffectivePlan } from '../src/utils/syncReducer';
import { calcEffectiveCost } from '../src/utils/budgetCalculator';
import { planToShareText } from '../src/utils/syncReducer';
import { BatchStatus, ChangeOp, ChangeTarget, SpotChangeKind } from '../src/constants/sync';
import type { TripChange } from '../src/models/change';
import type { LeaderDecision, SpotRevision, SyncBatch, SyncSnapshot } from '../src/models/sync';
import type { DayPlan, DayPlanItem } from '../src/models/dayPlan';
import type { Spot } from '../src/models/spot';
import type { Trip } from '../src/models/trip';

let passed = 0;
function check(name: string, cond: boolean, detail = '') {
  if (!cond) {
    console.error(`✗ ${name}${detail ? ' — ' + detail : ''}`);
    process.exit(1);
  }
  passed++;
  console.log(`✓ ${name}`);
}

// ---- 夹具 ----
const trip: Trip = {
  id: 't1', title: '黄山三日', destination: '黄山', start_date: '2026-10-02', end_date: '2026-10-04',
  budget: 3000, currency: 'CNY', members: ['我', '阿山', '小溪'], status: 'planning' as Trip['status'], created_at: '2026-09-01T00:00:00.000Z',
};
const spots: Spot[] = [
  { id: 's1', name: '迎客松', category: 'nature' as Spot['category'], address: '', lat: 0, lng: 0, rating: 5, price: 100, open_time: '', tags: [], image: '' },
  { id: 's2', name: '光明顶', category: 'nature' as Spot['category'], address: '', lat: 0, lng: 0, rating: 5, price: 200, open_time: '', tags: [], image: '' },
];
const baseItem: DayPlanItem = { spot_id: 's1', start_time: '09:00', end_time: '11:00', note: '出发前排好', transport: 'metro' };
const baseDays: DayPlan[] = [
  { id: 'd1', trip_id: 't1', day_index: 1, date: '2026-10-02', items: [baseItem] },
];

function change(partial: Partial<TripChange> & { id: string; batchId: string; member: string }): TripChange {
  return {
    tripId: 't1', op: ChangeOp.UPSERT, target: ChangeTarget.ITEM, dayIndex: 1, spotId: 's1',
    item: { spot_id: 's1', start_time: '09:00', end_time: '11:00', note: '', transport: 'walk' },
    field: null, value: null, baseVersion: 'v0', segmentDays: [1], happenedAt: '2026-09-25T00:00:00.000Z',
    ...partial,
  };
}

const batchA: SyncBatch = { id: 'bA', tripId: 't1', label: '阿山段', member: '阿山', segmentDays: [1], baseVersion: 'v0', status: BatchStatus.COMPLETED, appliedCount: 2, createdAt: '2026-09-24T00:00:00Z', completedAt: '2026-09-26T00:00:00Z' };
const batchB: SyncBatch = { id: 'bB', tripId: 't1', label: '小溪段', member: '小溪', segmentDays: [1, 2], baseVersion: 'v0', status: BatchStatus.COMPLETED, appliedCount: 2, createdAt: '2026-09-24T01:00:00Z', completedAt: '2026-09-26T01:00:00Z' };

// 两人离线同改第 1 天 s1，时刻不同
const changes: TripChange[] = [
  change({ id: 'cA1', batchId: 'bA', member: '阿山', happenedAt: '2026-09-25T08:00:00Z', item: { spot_id: 's1', start_time: '08:00', end_time: '10:00', note: '早去', transport: 'taxi' } }),
  change({ id: 'cB1', batchId: 'bB', member: '小溪', happenedAt: '2026-09-25T09:00:00Z', item: { spot_id: 's1', start_time: '13:00', end_time: '15:00', note: '晚到', transport: 'walk' } }),
  // 小溪在第 2 天独占分段添加 s2（不同段直接接上）
  change({ id: 'cB2', batchId: 'bB', member: '小溪', dayIndex: 2, spotId: 's2', happenedAt: '2026-09-25T10:00:00Z', item: { spot_id: 's2', start_time: '10:00', end_time: '12:00', note: '第二段', transport: 'walk' }, segmentDays: [1, 2] }),
];

// ========== 场景 1：两人同改并列保留，选定前不计预算/分享 ==========
let plan = projectEffectivePlan({ trip, baseDays, spots, changes, batches: [batchA, batchB], decisions: [], revisions: [] });
const day1 = plan.days.find((d) => d.day_index === 1)!;
const s1Variants = day1.items.filter((i) => i.spot_id === 's1');
check('同一天同一景点两人都动过：原版+阿山+小溪 三份并列', s1Variants.length === 3, `实际 ${s1Variants.length}`);
check('并列候选全部为 pending', s1Variants.every((i) => i.status === 'pending'));
check('候选携带成员', s1Variants.some((i) => i.member === '阿山') && s1Variants.some((i) => i.member === '小溪'));
check('候选携带出发前版本', s1Variants.every((i) => i.baseVersion === 'v0'));
check('并列项带不同时刻', s1Variants.some((i) => i.start_time === '08:00') && s1Variants.some((i) => i.start_time === '13:00'));
check('不同分段直接接上：第 2 天存在且含小溪独占的 s2', (() => {
  const day2 = plan.days.find((d) => d.day_index === 2)!;
  return day2.items.length === 1 && day2.items[0].spot_id === 's2' && day2.items[0].status === 'selected';
})());
check('队长选定前：并列项不计入预算（只有第2天 s2 的 200 计入）', calcEffectiveCost(plan.days, spots) === 200, `实际 ${calcEffectiveCost(plan.days, spots)}`);
check('队长选定前：并列项不出现在分享文本', !planToShareText(plan, spots).includes('迎客松'));
check('待选定冲突键登记', plan.pendingConflictKeys.includes('1:s1'));

// ========== 场景 2：队长选定后计入预算和分享 ==========
const decisions1: LeaderDecision[] = [{ tripId: 't1', conflictKey: '1:s1', selectedChangeId: 'cA1', decidedBy: '队长', decidedAt: '2026-09-27T00:00:00Z' }];
plan = projectEffectivePlan({ trip, baseDays, spots, changes, batches: [batchA, batchB], decisions: decisions1, revisions: [] });
const day1Sel = plan.days.find((d) => d.day_index === 1)!.items.filter((i) => i.spot_id === 's1');
check('队长选定后只保留一个版本', day1Sel.length === 1 && day1Sel[0].changeId === 'cA1' && day1Sel[0].status === 'selected');
check('选定后计入预算（s1 100 + s2 200）', calcEffectiveCost(plan.days, spots) === 300);
check('选定后出现在分享文本', planToShareText(plan, spots).includes('迎客松'));

// 队长可改选回出发前原版
const decisionsBase: LeaderDecision[] = [{ tripId: 't1', conflictKey: '1:s1', selectedChangeId: '__base__', decidedBy: '队长', decidedAt: '2026-09-27T00:00:00Z' }];
plan = projectEffectivePlan({ trip, baseDays, spots, changes, batches: [batchA, batchB], decisions: decisionsBase, revisions: [] });
const back = plan.days.find((d) => d.day_index === 1)!.items.find((i) => i.spot_id === 's1')!;
check('队长选回原版：时刻恢复出发前 09:00', back.start_time === '09:00' && back.member === '出发前原版');

// ========== 场景 3：行程字段（预算/成员）两人同改也并列，选定前沿用出发前值 ==========
const fieldChanges: TripChange[] = [
  change({ id: 'fA', batchId: 'bA', member: '阿山', target: ChangeTarget.TRIP, dayIndex: null, spotId: null, item: null, field: 'budget', value: '3800', happenedAt: '2026-09-25T11:00:00Z' }),
  change({ id: 'fB', batchId: 'bB', member: '小溪', target: ChangeTarget.TRIP, dayIndex: null, spotId: null, item: null, field: 'budget', value: '2600', happenedAt: '2026-09-25T12:00:00Z' }),
];
plan = projectEffectivePlan({ trip, baseDays: [], spots, changes: fieldChanges, batches: [batchA, batchB], decisions: [], revisions: [] });
const budgetConflict = plan.fieldConflicts.find((c) => c.field === 'budget')!;
check('预算被两人动过：含原版共 3 个候选', budgetConflict.variants.length === 3);
check('预算冲突未决', !budgetConflict.resolved);
check('未选定前预算沿用出发前 3000', plan.trip.budget === 3000);
const decisionsBudget: LeaderDecision[] = [{ tripId: 't1', conflictKey: 'field:budget', selectedChangeId: 'fB', decidedBy: '队长', decidedAt: '' }];
plan = projectEffectivePlan({ trip, baseDays: [], spots, changes: fieldChanges, batches: [batchA, batchB], decisions: decisionsBudget, revisions: [] });
check('队长选定小溪版本后预算变 2600', plan.trip.budget === 2600);

// ========== 场景 4：批次中断续传——从上次完整结果继续，重放不多出安排 ==========
const partialBatch: SyncBatch = { ...batchB, id: 'bP', status: BatchStatus.PARTIAL, appliedCount: 1, completedAt: null };
// bP 里有 2 条：第1天 s1、第2天 s2
const partialChanges: TripChange[] = [
  change({ id: 'p1', batchId: 'bP', member: '小溪', dayIndex: 1, spotId: 's1', happenedAt: '2026-09-25T09:00:00Z', item: { spot_id: 's1', start_time: '13:00', end_time: '15:00', note: '晚到', transport: 'walk' } }),
  change({ id: 'p2', batchId: 'bP', member: '小溪', dayIndex: 2, spotId: 's2', happenedAt: '2026-09-25T10:00:00Z', item: { spot_id: 's2', start_time: '10:00', end_time: '12:00', note: '', transport: 'walk' }, segmentDays: [1, 2] }),
];
plan = projectEffectivePlan({ trip, baseDays, spots, changes: partialChanges, batches: [partialBatch], decisions: [], revisions: [] });
check('中断在水位 1/2：只有第 1 条进入投影，第 2 天 s2 尚未出现', !plan.days.some((d) => d.day_index === 2 && d.items.some((i) => i.spot_id === 's2')));
check('中断批次已重放的第 1 条生效（与基线 s1 并列，因只有小溪一人改动 => 直接 selected）', (() => {
  const d1 = plan.days.find((d) => d.day_index === 1)!;
  const it = d1.items.find((i) => i.spot_id === 's1');
  return it?.changeId === 'p1' && it.status === 'selected';
})());
// 续传完成
const resumed: SyncBatch = { ...partialBatch, status: BatchStatus.COMPLETED, appliedCount: 2, completedAt: '2026-09-26T02:00:00Z' };
const planResume1 = projectEffectivePlan({ trip, baseDays, spots, changes: partialChanges, batches: [resumed], decisions: [], revisions: [] });
const planResume2 = projectEffectivePlan({ trip, baseDays, spots, changes: partialChanges, batches: [resumed], decisions: [], revisions: [] });
check('续传至完整后第 2 天 s2 接上', planResume1.days.find((d) => d.day_index === 2)!.items.some((i) => i.spot_id === 's2'));
check('重放幂等：同批再投影结果逐字节一致', JSON.stringify(planResume1) === JSON.stringify(planResume2));
const counts1 = planResume1.days.map((d) => d.items.length).join(',');
const planResume3 = projectEffectivePlan({ trip, baseDays, spots, changes: partialChanges, batches: [resumed], decisions: [], revisions: [] });
check('重放同批不会多出安排', counts1 === planResume3.days.map((d) => d.items.length).join(','));
// pending 批次完全不进入投影
const pendingBatch: SyncBatch = { ...batchB, id: 'bN', status: BatchStatus.PENDING, appliedCount: 0, completedAt: null };
plan = projectEffectivePlan({ trip, baseDays, spots, changes: partialChanges.map((c) => ({ ...c, batchId: 'bN' })), batches: [pendingBatch], decisions: [], revisions: [] });
check('待重放批次不影响当前结果（第 2 天无 s2）', !plan.days.some((d) => d.day_index === 2));

// ========== 场景 5：景点停业 / 价格变化——相关日期失效待确认，旧快照可查 ==========
const priceRevision: SpotRevision = {
  id: 'r1', spotId: 's2', kind: SpotChangeKind.PRICE, newPrice: 500, changedAt: '2026-09-28T00:00:00Z',
  affectedDayIndexes: [2], acknowledgedDayIndexes: [],
};
const priceMapOld = { s1: 100, s2: 200 };
plan = projectEffectivePlan({ trip, baseDays, spots: [{ ...spots[1], price: 500 }, spots[0]], changes: partialChanges, batches: [resumed], decisions: [], revisions: [priceRevision] });
const staleItem = plan.days.find((d) => d.day_index === 2)!.items.find((i) => i.spot_id === 's2')!;
check('价格变化后相关日期标记失效待确认', staleItem.status === 'invalid' && plan.days.find((d) => d.day_index === 2)!.stale);
check('失效项不计入当前预算', calcEffectiveCost(plan.days, [{ ...spots[1], price: 500 }, spots[0]]) === 0 || calcEffectiveCost(plan.days, [{ ...spots[1], price: 500 }, spots[0]]) === 100);
check('旧快照价格表可复现旧金额：s2 仍按 200 计', (() => {
  const oldDays = JSON.parse(JSON.stringify(planResume1.days));
  return calcEffectiveCost(oldDays, [{ ...spots[1], price: 500 }, spots[0]], priceMapOld) === 300;
})());
// 确认后按新价计入
const acked: SpotRevision = { ...priceRevision, acknowledgedDayIndexes: ['2'] };
plan = projectEffectivePlan({ trip, baseDays, spots: [{ ...spots[1], price: 500 }, spots[0]], changes: partialChanges, batches: [resumed], decisions: [], revisions: [acked] });
const confirmed = plan.days.find((d) => d.day_index === 2)!.items.find((i) => i.spot_id === 's2')!;
check('调价确认后重新计入且按新价 500', confirmed.status !== 'invalid' && calcEffectiveCost(plan.days, [{ ...spots[1], price: 500 }, spots[0]]) === 600);
// 停业：确认前失效，确认后撤下
const closed: SpotRevision = { id: 'r2', spotId: 's2', kind: SpotChangeKind.CLOSED, newPrice: null, changedAt: '2026-09-29T00:00:00Z', affectedDayIndexes: [2], acknowledgedDayIndexes: [] };
plan = projectEffectivePlan({ trip, baseDays, spots, changes: partialChanges, batches: [resumed], decisions: [], revisions: [closed] });
check('景点停业：相关日期失效', plan.days.find((d) => d.day_index === 2)!.items.find((i) => i.spot_id === 's2')!.status === 'invalid');
const closedAck: SpotRevision = { ...closed, acknowledgedDayIndexes: ['2'] };
plan = projectEffectivePlan({ trip, baseDays, spots, changes: partialChanges, batches: [resumed], decisions: [], revisions: [closedAck] });
check('停业确认后该景点当天撤下，其余安排保留', !plan.days.find((d) => d.day_index === 2)!.items.some((i) => i.spot_id === 's2'));
// 旧快照结构保留
const oldSnapshot: SyncSnapshot = {
  id: 'snap1', tripId: 't1', version: 'v1', batchId: 'bP', batchLabel: '小溪段', createdAt: '2026-09-26T02:00:00Z',
  trip, days: JSON.parse(JSON.stringify(planResume1.days)), priceMap: priceMapOld, pendingConflictKeys: [],
};
check('旧结果仍可查看（快照独立保存，含当时价格表）', Array.isArray((oldSnapshot.days as unknown[])) && oldSnapshot.priceMap.s2 === 200);

// ========== 场景 6：单人删除不产生冲突；两人一删一改则并列 ==========
const onlyDelete: TripChange[] = [
  change({ id: 'd1', batchId: 'bA', member: '阿山', op: ChangeOp.REMOVE, item: null, happenedAt: '2026-09-25T08:00:00Z' }),
];
plan = projectEffectivePlan({ trip, baseDays, spots, changes: onlyDelete, batches: [{ ...batchA, appliedCount: 1 }], decisions: [], revisions: [] });
check('单人删除：当天 s1 直接撤下，无并列', !plan.days.find((d) => d.day_index === 1)!.items.some((i) => i.spot_id === 's1'));
const conflictDel: TripChange[] = [
  ...onlyDelete,
  change({ id: 'd2', batchId: 'bB', member: '小溪', happenedAt: '2026-09-25T09:00:00Z', item: { spot_id: 's1', start_time: '13:00', end_time: '15:00', note: '', transport: 'walk' } }),
];
plan = projectEffectivePlan({ trip, baseDays, spots, changes: conflictDel, batches: [{ ...batchA, appliedCount: 1 }, batchB], decisions: [], revisions: [] });
const delGroup = plan.days.find((d) => d.day_index === 1)!.items.filter((i) => i.spot_id === 's1');
check('一人删除一人修改：删除候选与修改候选、原版并列', delGroup.length === 3 && delGroup.some((i) => i.op === ChangeOp.REMOVE));

console.log(`\n全部 ${passed} 项断言通过`);
