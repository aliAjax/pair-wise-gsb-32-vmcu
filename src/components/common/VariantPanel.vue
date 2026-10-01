<template>
  <section class="band">
    <h3>同天同景点 · 并列改动（{{ variants.length }}）</h3>
    <p class="muted">同一天同一景点被两名成员动过，下面并列保留；队长选定前不计入预算，也不计入分享。</p>
    <EmptyState v-if="!variants.length" title="没有并列冲突，所有安排都已唯一确定。" />
    <div v-for="variant in variants" :key="keyOf(variant.key)" class="variant">
      <header>
        <strong>第 {{ variant.key.day_index }} 天 · {{ variant.key.date }} · {{ spotName(variant.key.spot_id) }}</strong>        <el-tag :type="variant.state === VariantState.CHOSEN ? 'success' : 'warning'" size="small">
          {{ variant.state === VariantState.CHOSEN ? '队长已选定' : '待队长选定' }}
        </el-tag>
      </header>
      <el-radio-group
        :model-value="variant.chosen_event_id"
        :disabled="variant.state === VariantState.CHOSEN"
        @change="(id: string | number | boolean) => emit('choose', variant.key, String(id))"
      >
        <el-radio v-for="option in variant.options" :key="option.event_id" :value="option.event_id" border class="option">
          <div>
            <strong>{{ option.member }}</strong>
            <span class="muted"> · 改于 {{ fmt(option.happened_at) }} · 出发前版本 v{{ option.base_version }}</span>
          </div>
          <div>{{ option.start_time }}-{{ option.end_time }} · {{ transportText[option.transport] ?? option.transport }} · {{ option.note }}</div>
        </el-radio>
      </el-radio-group>
    </div>
  </section>
</template>
<script setup lang="ts">
import { VariantState } from '../../constants/sync';
import { mapKey } from '../../sync/reducer';
import { transportText } from '../../utils/formatters';
import EmptyState from './EmptyState.vue';
import type { DayItemKey, PlanVariant } from '../../models/sync';
import type { Spot } from '../../models/spot';
import dayjs from 'dayjs';

const props = defineProps<{ variants: PlanVariant[]; spots: Spot[] }>();
const emit = defineEmits<{ choose: [key: DayItemKey, chosenEventId: string] }>();
const keyOf = (key: DayItemKey) => mapKey(key);
const spotName = (id: string) => props.spots.find((s) => s.id === id)?.name ?? '未知景点';
const fmt = (value: string) => dayjs(value).format('MM-DD HH:mm');
</script>
<style scoped>
.variant { border: 1px solid #e3e8e3; border-radius: 10px; padding: 10px 12px; margin: 10px 0; }
.variant header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.option { display: flex; margin: 6px 0; width: 100%; }
.muted { color: #7a877a; font-size: 13px; }
</style>
