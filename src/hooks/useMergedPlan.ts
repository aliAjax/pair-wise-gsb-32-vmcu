import { computed, toValue, type ComputedRef, type MaybeRef } from 'vue';
import { useTripStore } from '../stores/tripStore';
import { useSpotStore } from '../stores/spotStore';
import { useSyncStore } from '../stores/syncStore';
import { effectiveBudgetStatus } from '../utils/budgetCalculator';
import type { EffectivePlan } from '../utils/syncReducer';

/**
 * 把事件流投影成"当前生效行程"。
 * 组件层只读这份投影：并列项、失效日期、预算口径全部由它决定。
 */
export function useMergedPlan(tripId: MaybeRef<string>): {
  plan: ComputedRef<EffectivePlan | null>;
  budget: ComputedRef<{ spent: number; remaining: number; warning: string; pendingCount: number; invalidCount: number }>;
} {
  const tripStore = useTripStore();
  const spotStore = useSpotStore();
  const syncStore = useSyncStore();

  const plan = computed<EffectivePlan | null>(() => {
    const id = toValue(tripId);
    const trip = tripStore.trips.find((item) => item.id === id);
    if (!trip) return null;
    // 在 computed 内同步读取各 store 状态，trip/dayPlan/spot/sync 任一变化都会触发重新投影
    return syncStore.projectTrip(id);
  });

  const budget = computed(() => {
    if (!plan.value) return { spent: 0, remaining: 0, warning: '', pendingCount: 0, invalidCount: 0 };
    return effectiveBudgetStatus(plan.value.trip, plan.value.days, spotStore.spots);
  });

  return { plan, budget };
}
