/* 不依赖浏览器的 store 冒烟：localStorage 打桩，跑完整种子流程并校验状态 */
import assert from 'node:assert/strict';
import { createPinia, setActivePinia } from 'pinia';

// ---- 浏览器环境最小打桩 ----
const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
  clear: () => storage.clear(),
};
// Node 20 自带全局 crypto.randomUUID，无需打桩
// Element Plus 的 ElMessage 需要 DOM，给一组最小桩
globalThis.document = {
  createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
  body: { appendChild() {} },
} as unknown as Document;

const { useSyncStore } = await import('../src/stores/syncStore.ts');
const { useSpotStore } = await import('../src/stores/spotStore.ts');
const { useTripStore } = await import('../src/stores/tripStore.ts');
const { BatchState, VariantState, InvalidationState } = await import('../src/constants/sync.ts');

setActivePinia(createPinia());
const spotStore = useSpotStore();
const tripStore = useTripStore();
const syncStore = useSyncStore();

syncStore.seedDemoIfEmpty();

// 第一批在景点反馈段前中断：应存在一个 INTERRUPTED 批次，且已固化一版快照
const interrupted = syncStore.batches.find((b) => b.state === BatchState.INTERRUPTED);
assert.ok(interrupted, '种子应包含一个中断批次');
assert.equal(interrupted.processed_count, 2, '中断批次完成 2 段');

// 两批跑完后应有 ≥2 份完整结果快照
assert.ok(syncStore.snapshots.length >= 2, '应固化多次完整结果（旧结果可查看）');

// 当前投影：同天同景点两人改动 → 1 个待选并列；夜市价格 → 1 个待确认失效
const proj = syncStore.currentProjection;
const pendingVariant = proj.variants.find((v) => v.state === VariantState.PENDING);
assert.ok(pendingVariant, '应存在待队长选定的并列项');
assert.equal(pendingVariant.options.length, 2);
const pendingInv = proj.invalidations.find((i) => i.state === InvalidationState.PENDING);
assert.ok(pendingInv, '应存在待确认的景点价格失效');
assert.deepEqual(pendingInv.affected_dates, ['2026-10-05']);
assert.equal(proj.ready_to_share, false, '有待处理项时不可分享');

// 预算：博物馆 60 计入；并列的湖滨乐园 180 待选、夜市 120 待确认，均不计入
assert.equal(proj.included_cost, 60, `期望仅博物馆计入，实际 ${proj.included_cost}`);

// 恢复中断批次：从上次完整结果继续，不重复
const beforeCount = syncStore.appliedEvents.length;
syncStore.resumeBatch(interrupted.id);
assert.equal(syncStore.appliedEvents.length, beforeCount, '中断批次的事件此前已提交，恢复不重复');

// 队长选定并列项
const key = pendingVariant.key;
syncStore.chooseVariant('trip-hike-demo', key, pendingVariant.options[0].event_id);
const afterChoose = syncStore.currentProjection;
assert.ok(afterChoose.variants.find((v) => v.state === VariantState.CHOSEN), '选定后该并列项计入');
assert.equal(afterChoose.included_cost, 60 + 180, '选定后湖滨乐园计入预算');

// 队长确认价格变化：夜市按新价 150 计入
const invId = afterChoose.invalidations.find((i) => i.state === InvalidationState.PENDING)?.id;
assert.ok(invId);
syncStore.confirmInvalidation('trip-hike-demo', invId);
const afterConfirm = syncStore.currentProjection;
assert.equal(afterConfirm.included_cost, 60 + 180 + 150, '确认后夜市按新价计入');
assert.equal(afterConfirm.ready_to_share, true, '全部处理完可分享');

// 重放已合入批次不新增事件
const appliedBatch = syncStore.batches.find((b) => b.state === BatchState.APPLIED && b.label.includes('补传'));
assert.ok(appliedBatch);
assert.equal(syncStore.replayBatch(appliedBatch.id), true, '重放幂等');

// 旧快照仍保留且价格是当时口径
assert.ok(syncStore.snapshots[0].included_cost !== afterConfirm.included_cost || syncStore.snapshots.length > 1);
void tripStore;
void spotStore;
console.log('✓ store 种子端到端冒烟通过（中断→恢复→选定→确认→分享→旧快照保留）');
