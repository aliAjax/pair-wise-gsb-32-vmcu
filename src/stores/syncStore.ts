import { defineStore } from 'pinia';
import { BatchStatus, ChangeOp, ChangeTarget, SpotChangeKind } from '../constants/sync';
import type { TripChange } from '../models/change';
import type { LeaderDecision, SpotRevision, SyncBatch, SyncSnapshot } from '../models/sync';
import type { DayPlanItem } from '../models/dayPlan';
import { syncApi } from '../api/syncApi';
import { messages } from '../constants/messages';
import { toast } from '../utils/message';
import { projectEffectivePlan } from '../utils/syncReducer';
import { buildSnapshot } from '../utils/syncSnapshot';
// 与 trip/dayPlan/spot store 为环引用；ESM 导入提升，真正取值发生在动作调用时，安全
import { useTripStore } from './tripStore';
import { useDayPlanStore } from './dayPlanStore';
import { useSpotStore } from './spotStore';

interface RecordItemInput {
  tripId: string;
  batchId: string;
  member: string;
  dayIndex: number;
  spotId: string;
  item?: DayPlanItem;
  op?: ChangeOp.UPSERT | ChangeOp.REMOVE;
  happenedAt?: string;
}

interface RecordFieldInput {
  tripId: string;
  batchId: string;
  member: string;
  field: 'budget' | 'members' | 'start_date' | 'end_date';
  value: string;
  happenedAt?: string;
}

interface CreateBatchInput {
  tripId: string;
  label: string;
  member: string;
  segmentDays: number[];
  baseVersion?: string;
}

/**
 * 离线分段批次同步 store。
 * 事件流（changes）只追加；批次的 appliedCount 是中断恢复水位；
 * 真正的"合并结果"由 utils/syncReducer 在投影时现算，保证重放幂等。
 */
export const useSyncStore = defineStore('sync', {
  state: () => ({
    changes: syncApi.listChanges() as TripChange[],
    batches: syncApi.listBatches() as SyncBatch[],
    decisions: syncApi.listDecisions() as LeaderDecision[],
    revisions: syncApi.listRevisions() as SpotRevision[],
    snapshots: syncApi.listSnapshots() as SyncSnapshot[],
  }),
  getters: {
    changesOfTrip: (state) => (tripId: string) => state.changes.filter((change) => change.tripId === tripId),
    batchesOfTrip: (state) => (tripId: string) =>
      [...state.batches.filter((batch) => batch.tripId === tripId)].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    snapshotsOfTrip: (state) => (tripId: string) =>
      [...state.snapshots.filter((snapshot) => snapshot.tripId === tripId)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    /** 当前可基于的版本：出发前 v0 或最近一个完整批次后的版本 */
    currentVersion: (state) => (tripId: string) => {
      const completed = state.batches.filter((batch) => batch.tripId === tripId && batch.status === BatchStatus.COMPLETED).length;
      return `v${completed}`;
    },
    revisionOfSpot: (state) => (spotId: string) => state.revisions.filter((revision) => revision.spotId === spotId),
    /** 某天某景点最近一条尚未确认到该天的景点变化（停业/调价） */
    activeRevision: (state) => (spotId: string, dayIndex: number) =>
      state.revisions
        .filter((revision) => revision.spotId === spotId && revision.affectedDayIndexes.includes(dayIndex) && !revision.acknowledgedDayIndexes.includes(String(dayIndex)))
        .sort((a, b) => b.changedAt.localeCompare(a.changedAt))[0] || null,
  },
  actions: {
    persist() {
      syncApi.saveChanges(this.changes);
      syncApi.saveBatches(this.batches);
      syncApi.saveDecisions(this.decisions);
      syncApi.saveRevisions(this.revisions);
      syncApi.saveSnapshots(this.snapshots);
    },

    createBatch(input: CreateBatchInput): string {
      const version = input.baseVersion || this.currentVersion(input.tripId);
      const batch: SyncBatch = {
        id: crypto.randomUUID(),
        tripId: input.tripId,
        label: input.label,
        member: input.member,
        segmentDays: [...new Set(input.segmentDays)].sort((a, b) => a - b),
        baseVersion: version,
        status: BatchStatus.PENDING,
        appliedCount: 0,
        createdAt: new Date().toISOString(),
        completedAt: null,
      };
      this.batches.push(batch);
      this.persist();
      toast.ok(`${messages.batchCreated}（分段：第 ${batch.segmentDays.join('、')} 天 / 基于 ${version}）`);
      return batch.id;
    },

    /** 记录一条离线行程改动（新增景点、改时刻、删除安排） */
    recordItemChange(input: RecordItemInput) {
      const batch = this.batches.find((item) => item.id === input.batchId);
      if (!batch) throw new Error('批次不存在');
      const op = input.op || ChangeOp.UPSERT;
      const change: TripChange = {
        id: crypto.randomUUID(),
        tripId: input.tripId,
        batchId: input.batchId,
        member: input.member,
        op,
        target: ChangeTarget.ITEM,
        dayIndex: input.dayIndex,
        spotId: input.spotId,
        item: op === ChangeOp.UPSERT && input.item ? { ...input.item } : null,
        field: null,
        value: null,
        baseVersion: batch.baseVersion,
        segmentDays: [...batch.segmentDays],
        happenedAt: input.happenedAt || new Date().toISOString(),
      };
      this.changes.push(change);
      this.persist();
      toast.ok(messages.changeRecorded);
      return change.id;
    },

    /** 记录一条离线旅行级改动（预算、同行人、起止日期） */
    recordFieldChange(input: RecordFieldInput) {
      const batch = this.batches.find((item) => item.id === input.batchId);
      if (!batch) throw new Error('批次不存在');
      const change: TripChange = {
        id: crypto.randomUUID(),
        tripId: input.tripId,
        batchId: input.batchId,
        member: input.member,
        op: ChangeOp.UPSERT,
        target: ChangeTarget.TRIP,
        dayIndex: null,
        spotId: null,
        item: null,
        field: input.field,
        value: input.value,
        baseVersion: batch.baseVersion,
        segmentDays: [...batch.segmentDays],
        happenedAt: input.happenedAt || new Date().toISOString(),
      };
      this.changes.push(change);
      this.persist();
      toast.ok(messages.changeRecorded);
      return change.id;
    },

    /**
     * 重放批次。limit 表示本次最多重放多少条（模拟山区信号中断）：
     * - 到不了末尾：批次置 partial，appliedCount 作为"上次完整结果"水位
     * - 到达末尾：置 completed，并把当时投影固化为结果快照
     * - 对同一批次再次调用：水位不会回退也不会越过事件总数，不产生重复安排/重复快照
     */
    processBatch(batchId: string, limit?: number) {
      const batch = this.batches.find((item) => item.id === batchId);
      if (!batch) throw new Error('批次不存在');
      const batchChanges = this.changes
        .filter((change) => change.batchId === batchId)
        .sort((a, b) => a.happenedAt.localeCompare(b.happenedAt) || a.id.localeCompare(b.id));
      if (batch.status === BatchStatus.COMPLETED) {
        toast.ok(messages.batchResumeNoDup);
        return;
      }
      const start = batch.appliedCount;
      if (start >= batchChanges.length) {
        // 水位已到末尾（上次中断恰好在最后一条之后）：直接收尾，只生成一次快照
        this.completeBatch(batch);
        return;
      }
      if (batch.status === BatchStatus.PENDING) batch.status = BatchStatus.PARTIAL;
      const target = typeof limit === 'number' ? Math.min(start + limit, batchChanges.length) : batchChanges.length;
      // 逐条推进水位：每条之后都是可恢复的"上次完整结果"
      batch.appliedCount = target;
      if (target < batchChanges.length) {
        this.persist();
        toast.ok(messages.batchInterrupted + `（${target}/${batchChanges.length}）`);
        return;
      }
      this.completeBatch(batch);
    },

    completeBatch(batch: SyncBatch) {
      if (batch.status === BatchStatus.COMPLETED && this.snapshots.some((item) => item.batchId === batch.id)) {
        toast.ok(messages.batchResumeNoDup);
        return;
      }
      batch.status = BatchStatus.COMPLETED;
      batch.appliedCount = this.changes.filter((change) => change.batchId === batch.id).length;
      batch.completedAt = new Date().toISOString();
      const plan = this.projectTrip(batch.tripId);
      if (plan) {
        const snapshot = buildSnapshot(plan, this.currentSpots(batch.tripId), batch);
        this.snapshots.unshift(snapshot);
      }
      this.persist();
      toast.ok(`${messages.batchCompleted}（${this.currentVersion(batch.tripId)}）`);
    },

    resetBatchWatermark(batchId: string) {
      const batch = this.batches.find((item) => item.id === batchId);
      if (batch && batch.status !== BatchStatus.COMPLETED) {
        batch.status = BatchStatus.PENDING;
        batch.appliedCount = 0;
        this.persist();
      }
    },

    /** 队长在并列候选中选定；选定后该项才计入预算与分享 */
    decide(tripId: string, conflictKey: string, selectedChangeId: string, leader: string) {
      const existing = this.decisions.find((item) => item.tripId === tripId && item.conflictKey === conflictKey);
      if (existing) {
        existing.selectedChangeId = selectedChangeId;
        existing.decidedBy = leader;
        existing.decidedAt = new Date().toISOString();
      } else {
        this.decisions.push({ tripId, conflictKey, selectedChangeId, decidedBy: leader, decidedAt: new Date().toISOString() });
      }
      this.persist();
      toast.ok(messages.leaderSelected);
    },

    clearDecision(tripId: string, conflictKey: string) {
      this.decisions = this.decisions.filter((item) => !(item.tripId === tripId && item.conflictKey === conflictKey));
      this.persist();
      toast.ok(messages.leaderCleared);
    },

    /** 登记景点停业 / 价格变化；相关日期失效待确认，旧快照保留不删 */
    registerRevision(spotId: string, kind: SpotChangeKind, newPrice: number | null, affectedDayIndexes: number[]) {
      // 懒引入其余 store，避免文件顶层循环依赖
      const spotStore = useSpotStore();
      const revision: SpotRevision = {
        id: crypto.randomUUID(),
        spotId,
        kind,
        newPrice: kind === SpotChangeKind.PRICE ? newPrice : null,
        changedAt: new Date().toISOString(),
        affectedDayIndexes: [...new Set(affectedDayIndexes)].sort((a, b) => a - b),
        acknowledgedDayIndexes: [],
      };
      this.revisions.push(revision);
      if (kind === SpotChangeKind.PRICE && typeof newPrice === 'number') {
        // 当前景点目录更新价格；历史快照自带 priceMap，旧结果金额不变
        spotStore.updatePrice(spotId, newPrice);
      }
      this.persist();
      toast.ok(messages.revisionRegistered);
      return revision.id;
    },

    acknowledgeDay(revisionId: string, dayIndex: number) {
      const revision = this.revisions.find((item) => item.id === revisionId);
      if (!revision || revision.acknowledgedDayIndexes.includes(String(dayIndex))) return;
      revision.acknowledgedDayIndexes.push(String(dayIndex));
      revision.acknowledgedDayIndexes.sort((a, b) => Number(a) - Number(b));
      this.persist();
      toast.ok(messages.revisionAcknowledged);
    },

    /** 用当前全量状态投影某旅行（供快照生成与 hook 共用） */
    projectTrip(tripId: string) {
      const tripStore = useTripStore();
      const dayPlanStore = useDayPlanStore();
      const spotStore = useSpotStore();
      const trip = tripStore.trips.find((item) => item.id === tripId);
      if (!trip) return null;
      return projectEffectivePlan({
        trip,
        baseDays: dayPlanStore.dayPlans,
        spots: spotStore.spots,
        changes: this.changes,
        batches: this.batches,
        decisions: this.decisions,
        revisions: this.revisions,
      });
    },

    currentSpots(tripId: string) {
      return useSpotStore().spots;
    },
  },
});

