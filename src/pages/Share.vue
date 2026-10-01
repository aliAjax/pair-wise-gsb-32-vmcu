<template>
  <main class="page" v-if="view">
    <div class="toolbar">
      <el-select v-model="tripId" placeholder="选择旅行" style="width: 240px" @change="onTripChange">
        <el-option v-for="trip in tripStore.trips" :key="trip.id" :label="trip.title" :value="trip.id" />
      </el-select>
      <el-select v-model="snapshotId" placeholder="当前结果" clearable style="width: 260px" @change="onSnapshotChange">
        <el-option v-for="snapshot in snapshots" :key="snapshot.id" :label="`历史结果 ${snapshot.version} · ${snapshot.batchLabel}`" :value="snapshot.id" />
      </el-select>
      <el-tag v-if="snapshotId" type="info">只读历史结果，金额按当时价格复现</el-tag>
    </div>

    <TripHeader :trip="view.trip" />
    <el-alert v-if="!snapshotId && budget.warning" :title="budget.warning" type="warning" :closable="false" show-icon style="margin: 10px 0" />
    <p class="muted">
      分享口径：并列待队长选定、景点停业/调价待确认的安排<b>不计入分享</b>，
      直到队长在<a @click="router.push('/sync/' + tripId)">离线合并台</a>选定/确认。
    </p>

    <MergedDayTimeline
      v-for="day in view.days"
      :key="day.day_index"
      :trip-id="tripId"
      :day="day"
      :spots="spotStore.spots"
      :selectable="!snapshotId"
      :price-map="priceMap"
    />

    <div class="toolbar">
      <el-button type="primary" @click="copyText">复制行程文本</el-button>
      <span class="muted">当前分享花费（不含待选定/待确认）：¥{{ shareCost }}</span>
    </div>
  </main>
  <main v-else class="page"><EmptyState title="请选择旅行" /></main>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElSelect, ElOption, ElButton, ElTag, ElAlert } from 'element-plus';
import { useTripStore } from '../stores/tripStore';
import { useSpotStore } from '../stores/spotStore';
import { useSyncStore } from '../stores/syncStore';
import { useMergedPlan } from '../hooks/useMergedPlan';
import { calcEffectiveCost } from '../utils/budgetCalculator';
import { planToShareText, type EffectivePlan } from '../utils/syncReducer';
import TripHeader from '../components/common/TripHeader.vue';
import MergedDayTimeline from '../components/common/MergedDayTimeline.vue';
import EmptyState from '../components/common/EmptyState.vue';
import type { SyncSnapshot } from '../models/sync';

const route = useRoute();
const router = useRouter();
const tripStore = useTripStore();
const spotStore = useSpotStore();
const syncStore = useSyncStore();

const tripId = ref<string>(String(route.params.tripId || tripStore.trips[0]?.id || ''));
const snapshotId = ref<string>(String(route.query.snapshot || ''));
const { plan, budget } = useMergedPlan(tripId);

const snapshots = computed(() => (tripId.value ? syncStore.snapshotsOfTrip(tripId.value) : []));
const snapshot = computed<SyncSnapshot | null>(() => snapshots.value.find((item) => item.id === snapshotId.value) || null);

watch(() => route.query.snapshot, (value) => { snapshotId.value = String(value || ''); });

/** 分享页视图：默认当前合并结果；选择快照后只读查看旧结果（价格表也是当时的） */
const view = computed<EffectivePlan | null>(() => {
  if (!tripId.value) return null;
  if (snapshot.value) {
    return {
      version: snapshot.value.version,
      trip: snapshot.value.trip as EffectivePlan['trip'],
      days: snapshot.value.days as EffectivePlan['days'],
      fieldConflicts: [],
      pendingConflictKeys: snapshot.value.pendingConflictKeys,
      completedBatches: [],
    };
  }
  return plan.value;
});

const priceMap = computed<Record<string, number> | undefined>(() => snapshot.value?.priceMap);
const shareCost = computed(() => (view.value ? calcEffectiveCost(view.value.days, spotStore.spots, priceMap.value) : 0));

function onTripChange(value: string) {
  snapshotId.value = '';
  router.push(`/share/${value}`);
}
function onSnapshotChange(value: string | undefined) {
  router.replace(value ? `/share/${tripId.value}?snapshot=${value}` : `/share/${tripId.value}`);
}
function copyText() {
  if (!view.value) return;
  const text = planToShareText(view.value, spotStore.spots, priceMap.value);
  navigator.clipboard?.writeText(text);
}
</script>
