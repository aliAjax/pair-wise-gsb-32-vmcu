<template>
  <section class="band">
    <h3>分段批次（{{ batches.length }}）</h3>
    <p class="muted">每个批次把“旅行计划 → 每日安排 → 景点反馈”三段直接接上，逐段接入；中断后从上次完整结果继续；重放同批不会多出安排。</p>
    <div v-for="batch in reversedBatches" :key="batch.id" class="batch">
      <header>
        <strong>{{ batch.label }}</strong>
        <el-tag :type="stateTag(batch.state)" size="small">{{ stateText[batch.state] }}</el-tag>
      </header>
      <p class="muted">已完整接入 {{ batch.processed_count }}/{{ 3 }} 段 · {{ fmt(batch.created_at) }}</p>
      <div class="segments">
        <el-tag
          v-for="(segment, index) in SEGMENT_ORDER"
          :key="segment"
          :type="index < batch.processed_count ? 'success' : 'info'"
          size="small"
        >
          {{ index + 1 }}. {{ segmentTypeText[segment] }}
        </el-tag>
      </div>
      <div class="actions">
        <el-button
          v-if="batch.state === BatchState.INTERRUPTED"
          type="primary"
          size="small"
          @click="emit('resume', batch.id)"
        >
          从上次完整结果继续
        </el-button>
        <el-button
          v-if="batch.state === BatchState.APPLIED"
          size="small"
          @click="emit('replay', batch.id)"
        >
          重放同批（自检不多出安排）
        </el-button>
      </div>
    </div>
  </section>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import {
  BatchState,
  SEGMENT_ORDER,
  SegmentType,
  segmentTypeText,
} from '../../constants/sync';
import type { ChangeBatch } from '../../models/sync';
import dayjs from 'dayjs';

const props = defineProps<{ batches: ChangeBatch[] }>();
const emit = defineEmits<{ resume: [batchId: string]; replay: [batchId: string] }>();

const reversedBatches = computed(() => [...props.batches].reverse());
const fmt = (value: string) => dayjs(value).format('MM-DD HH:mm');

const stateText: Record<BatchState, string> = {
  [BatchState.OPEN]: '待合入',
  [BatchState.PROCESSING]: '合入中',
  [BatchState.INTERRUPTED]: '已中断',
  [BatchState.APPLIED]: '已完整合入',
};
const stateTag = (state: BatchState) =>
  state === BatchState.APPLIED ? 'success' : state === BatchState.INTERRUPTED ? 'warning' : 'info';
</script>
<style scoped>
.batch { border: 1px solid #e3e8e3; border-radius: 10px; padding: 10px 12px; margin: 10px 0; }
.batch header { display: flex; justify-content: space-between; align-items: center; }
.segments { display: flex; gap: 6px; flex-wrap: wrap; margin: 8px 0; }
.actions { display: flex; gap: 8px; }
.muted { color: #7a877a; font-size: 13px; }
</style>
