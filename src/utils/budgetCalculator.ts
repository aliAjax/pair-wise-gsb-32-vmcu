import type { DayPlan } from '../models/dayPlan';
import type { EffectiveDay, EffectiveItem } from './syncReducer';
import type { Spot } from '../models/spot';
import type { Trip } from '../models/trip';
import { messages } from '../constants/messages';

export function calcTripCost(dayPlans: DayPlan[], spots: Spot[]) {
  const spotMap = new Map(spots.map((spot) => [spot.id, spot]));
  return dayPlans.reduce((sum, day) => {
    return sum + day.items.reduce((inner, item) => inner + (spotMap.get(item.spot_id)?.price || 0), 0);
  }, 0);
}

/** 并列待选定（pending）与停业/调价待确认（invalid）的安排不计入预算 */
export function isItemBudgetable(item: EffectiveItem): boolean {
  return item.status !== 'pending' && item.status !== 'invalid';
}

/** 投影后生效行程的花费：只算已定版本；可传入历史快照价格表复现旧结果 */
export function calcEffectiveCost(days: EffectiveDay[], spots: Spot[], priceMap?: Record<string, number>) {
  const spotMap = new Map(spots.map((spot) => [spot.id, spot]));
  return days.reduce((sum, day) => {
    return sum + day.items
      .filter(isItemBudgetable)
      .reduce((inner, item) => inner + (priceMap?.[item.spot_id] ?? spotMap.get(item.spot_id)?.price ?? 0), 0);
  }, 0);
}

/** 当天预算（供 DayTimeline / BudgetChart 共用） */
export function calcEffectiveDayCost(day: EffectiveDay, spots: Spot[], priceMap?: Record<string, number>) {
  const spotMap = new Map(spots.map((spot) => [spot.id, spot]));
  return day.items
    .filter(isItemBudgetable)
    .reduce((sum, item) => sum + (priceMap?.[item.spot_id] ?? spotMap.get(item.spot_id)?.price ?? 0), 0);
}

export function budgetStatus(trip: Trip, dayPlans: DayPlan[], spots: Spot[]) {
  const spent = calcTripCost(dayPlans, spots);
  return { spent, remaining: trip.budget - spent, warning: spent > trip.budget ? messages.budgetExceeded : '' };
}

/** 合并后预算状态：未定并列项与失效日期都不计入 */
export function effectiveBudgetStatus(trip: Trip, days: EffectiveDay[], spots: Spot[]) {
  const spent = calcEffectiveCost(days, spots);
  const pendingCount = days.reduce((sum, day) => sum + day.items.filter((item) => item.status === 'pending').length, 0);
  const invalidCount = days.reduce((sum, day) => sum + day.items.filter((item) => item.status === 'invalid').length, 0);
  let warning = spent > trip.budget ? messages.budgetExceeded : '';
  if (pendingCount) warning += (warning ? '；' : '') + messages.pendingNotCounted(pendingCount);
  if (invalidCount) warning += (warning ? '；' : '') + messages.invalidNotCounted(invalidCount);
  return { spent, remaining: trip.budget - spent, warning, pendingCount, invalidCount };
}
