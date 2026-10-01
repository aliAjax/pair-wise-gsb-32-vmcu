<template>
  <section class="band">
    <h3>历史结果快照（旧结果仍可查看）</h3>
    <p class="muted">每次完整合入固化一份不可变结果；景点价格/停业变化后，旧快照里保留的是当时计入的安排与价格。</p>
    <EmptyState v-if="!snapshots.length" title="还没有完整合入结果。" />
    <el-collapse v-else accordion>
      <el-collapse-item
        v-for="snap in reversed"
        :key="snap.version"
        :name="snap.version"
        :title="snapTitle(snap)"
      >
        <p class="muted">
          生成于 {{ fmt(snap.created_at) }} · 摘要 {{ snap.digest }} ·
          待选并列 {{ snap.pending_variants }} · 待确认失效 {{ snap.pending_invalidations }}
        </p>
        <p>同行人：{{ snap.members.join('、') }} · 预算 ¥{{ snap.budget }}</p>
        <div v-for="day in snap.days" :key="day.day_index + day.date" class="day">
          <strong>第 {{ day.day_index }} 天 · {{ day.date }}</strong>
          <ul>
            <li v-for="(item, i) in day.items" :key="item.source_event_id + i">
              {{ item.start_time }}-{{ item.end_time }} {{ spotName(item.spot_id) }} · {{ item.member }} 安排
            </li>
          </ul>
        </div>
      </el-collapse-item>
    </el-collapse>
  </section>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import EmptyState from './EmptyState.vue';
import type { PlanSnapshot } from '../../models/sync';
import type { Spot } from '../../models/spot';
import dayjs from 'dayjs';

const props = defineProps<{ snapshots: PlanSnapshot[]; spots: Spot[] }>();
const reversed = computed(() => [...props.snapshots].reverse());
const snapTitle = (snap: PlanSnapshot) => `v${snap.version} · ${snap.title} · 计入花费 ¥${snap.included_cost}`;
const spotName = (id: string) => props.spots.find((s) => s.id === id)?.name ?? '未知景点';
const fmt = (value: string) => dayjs(value).format('YYYY-MM-DD HH:mm');
</script>
<style scoped>
.day { margin: 8px 0; }
.muted { color: #7a877a; font-size: 13px; }
ul { margin: 4px 0; padding-left: 20px; }
</style>
