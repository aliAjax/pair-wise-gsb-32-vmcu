<template>
  <section class="band">
    <h3>景点失效 · 相关日期待确认（{{ invalidations.length }}）</h3>
    <p class="muted">景点停业或价格变化后，相关日期立即失效：待队长确认前不计入预算/分享；确认停业后移出预算，确认价格变化后按新价计入。旧结果仍可在下方历史查看。</p>
    <EmptyState v-if="!invalidations.length" title="暂无景点停业或价格变化反馈。" />
    <div v-for="inv in invalidations" :key="inv.id" class="invalid">
      <header>
        <strong>{{ spotName(inv.spot_id) }}</strong>
        <el-tag :type="inv.state === InvalidationState.CONFIRMED ? 'success' : 'danger'" size="small">
          {{ inv.state === InvalidationState.CONFIRMED ? '已确认' : '待确认' }}
        </el-tag>
      </header>
      <p>
        原因：{{ invalidationReasonText[inv.reason] }}
        <template v-if="inv.reason === InvalidationReason.PRICE_CHANGED">
          ，新价 ¥{{ inv.new_price }}（原 ¥{{ catalogPrice(inv.spot_id) }}）
        </template>
      </p>
      <p class="muted">受影响日期：{{ inv.affected_dates.join('、') || '当前无安排' }} · {{ inv.reported_by }} 上报于 {{ fmt(inv.happened_at) }}</p>
      <el-button
        v-if="inv.state === InvalidationState.PENDING"
        type="primary"
        size="small"
        @click="emit('confirm', inv.id)"
      >
        队长确认相关日期处理
      </el-button>
    </div>
  </section>
</template>
<script setup lang="ts">
import { InvalidationReason, InvalidationState, invalidationReasonText } from '../../constants/sync';
import EmptyState from './EmptyState.vue';
import type { Invalidation } from '../../models/sync';
import type { Spot } from '../../models/spot';
import dayjs from 'dayjs';

const props = defineProps<{ invalidations: Invalidation[]; spots: Spot[] }>();
const emit = defineEmits<{ confirm: [invalidationId: string] }>();
const spotName = (id: string) => props.spots.find((s) => s.id === id)?.name ?? '未知景点';
const catalogPrice = (id: string) => props.spots.find((s) => s.id === id)?.price ?? 0;
const fmt = (value: string) => dayjs(value).format('MM-DD HH:mm');
</script>
<style scoped>
.invalid { border: 1px solid #f0d9d9; border-radius: 10px; padding: 10px 12px; margin: 10px 0; }
.invalid header { display: flex; justify-content: space-between; align-items: center; }
.muted { color: #7a877a; font-size: 13px; }
</style>
