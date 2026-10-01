import { InvalidationState, InvalidationReason, VariantState } from '../constants/sync';
import type { PlanProjection } from '../models/sync';
import type { Spot } from '../models/spot';
import { transportText } from '../utils/formatters';
import { formatCurrency } from '../utils/formatters';

/** 预算口径：只统计队长已选定、且相关日期未失效的安排 */
export function effectiveBudget(projection: PlanProjection): {
  spent: number;
  remaining: number;
  pendingCount: number;
} {
  const pendingVariants = projection.variants.filter((v) => v.state === VariantState.PENDING).length;
  const pendingInvalidations = projection.invalidations.filter(
    (i) => i.state === InvalidationState.PENDING,
  ).length;
  return {
    spent: projection.included_cost,
    remaining: projection.budget - projection.included_cost,
    pendingCount: pendingVariants + pendingInvalidations,
  };
}

/** 分享口径：有任何待裁决并列项或待确认失效，都不允许分享（队长选定前不计入分享） */
export function canShare(projection: PlanProjection): boolean {
  return projection.ready_to_share;
}

export interface ShareContext {
  projection: PlanProjection;
  spots: Spot[];
  currency?: string;
}

/** 生成分享文本：只包含已计入的安排，并列项/失效日期不会漏进分享稿 */
export function buildShareText({ projection, spots, currency = 'CNY' }: ShareContext): string {
  if (!canShare(projection)) {
    return `【${projection.title}】仍有待队长处理的并列安排或景点失效确认，暂不计入分享。`;
  }
  const spotName = (id: string) => spots.find((s) => s.id === id)?.name ?? '未知景点';
  const lines: string[] = [`【${projection.title}】行程单`, `同行人：${projection.members.join('、')}`];
  projection.days.forEach((day) => {
    lines.push(`第 ${day.day_index} 天 · ${day.date}`);
    day.items.forEach((item) => {
      lines.push(
        `  ${item.start_time}-${item.end_time} ${spotName(item.spot_id)}（${transportText[item.transport] ?? item.transport}）· ${item.member} 安排`,
      );
    });
  });
  lines.push(`预计花费 ${formatCurrency(projection.included_cost, currency)} / 预算 ${formatCurrency(projection.budget, currency)}`);
  return lines.join('\n');
}

export const invalidationSpotText = (projection: PlanProjection, spot: Spot) => {
  const inv = projection.invalidations.find((item) => item.spot_id === spot.id);
  if (!inv) return '';
  const reason = inv.reason === InvalidationReason.CLOSED ? '停业' : `价格变为 ${inv.new_price ?? spot.price}`;
  const state = inv.state === InvalidationState.CONFIRMED ? '已确认' : '待队长确认';
  return `${spot.name} ${reason}（${state}），受影响日期：${inv.affected_dates.join('、') || '无'}`;
};
