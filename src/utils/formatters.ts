import dayjs from 'dayjs';
import { SpotCategory } from '../constants/spot';
import { TripStatus } from '../constants/trip';
import { BatchStatus, SpotChangeKind, VariantStatus } from '../constants/sync';

export const spotCategoryText: Record<SpotCategory, string> = {
  [SpotCategory.NATURE]: '自然风光',
  [SpotCategory.CULTURE]: '人文历史',
  [SpotCategory.FOOD]: '美食购物',
  [SpotCategory.ENTERTAINMENT]: '娱乐休闲',
};
export const tripStatusText: Record<TripStatus, string> = {
  [TripStatus.PLANNING]: '规划中',
  [TripStatus.ONGOING]: '进行中',
  [TripStatus.FINISHED]: '已结束',
};
export const batchStatusText: Record<BatchStatus, string> = {
  [BatchStatus.PENDING]: '待重放',
  [BatchStatus.PARTIAL]: '中断续传中',
  [BatchStatus.COMPLETED]: '已完整合并',
};
export const variantStatusText: Record<VariantStatus, string> = {
  [VariantStatus.PENDING]: '待队长选定',
  [VariantStatus.SELECTED]: '已选定',
  [VariantStatus.DISCARDED]: '原版/已弃用',
};
export const spotChangeKindText: Record<SpotChangeKind, string> = {
  [SpotChangeKind.CLOSED]: '景点停业',
  [SpotChangeKind.PRICE]: '价格变化',
};
export const transportText: Record<string, string> = { walk: '步行', metro: '地铁', taxi: '出租', train: '火车' };
export const formatDate = (value: string) => dayjs(value).format('YYYY-MM-DD');
export const formatDateTime = (value: string) => dayjs(value).format('MM-DD HH:mm:ss');
export const formatCurrency = (value: number, currency = 'CNY') => new Intl.NumberFormat('zh-CN', { style: 'currency', currency }).format(value);
