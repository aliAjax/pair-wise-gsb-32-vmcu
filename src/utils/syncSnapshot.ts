import type { EffectivePlan } from './syncReducer';
import { planToShareText } from './syncReducer';
import type { SyncBatch, SyncSnapshot } from '../models/sync';
import type { Spot } from '../models/spot';

/**
 * 批次完整重放后的结果快照。
 * 景点价格表一并入镜：日后景点调价/停业，旧快照里的金额仍可复现（旧结果仍可查看）。
 */
export function buildSnapshot(plan: EffectivePlan, spots: Spot[], batch: SyncBatch): SyncSnapshot {
  const priceMap: Record<string, number> = {};
  for (const spot of spots) priceMap[spot.id] = spot.price;
  return {
    id: crypto.randomUUID(),
    tripId: batch.tripId,
    version: plan.version,
    batchId: batch.id,
    batchLabel: batch.label,
    createdAt: new Date().toISOString(),
    trip: structuredClone(plan.trip),
    days: structuredClone(plan.days),
    priceMap,
    pendingConflictKeys: [...plan.pendingConflictKeys],
  };
}

/** 快照转纯文本（旧结果查看 / 导出） */
export function snapshotToText(snapshot: SyncSnapshot, spots: Spot[]): string {
  const plan = {
    version: snapshot.version,
    trip: snapshot.trip,
    days: snapshot.days,
    pendingConflictKeys: snapshot.pendingConflictKeys,
  } as unknown as EffectivePlan;
  return `【历史结果 ${snapshot.version} · ${snapshot.batchLabel}】\n` + planToShareText(plan, spots, snapshot.priceMap as Record<string, number>);
}
