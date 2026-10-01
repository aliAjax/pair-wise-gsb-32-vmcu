<template>
  <main class="page" v-if="trip && plan">
    <TripHeader :trip="plan.trip" />
    <div class="toolbar">
      <el-button type="primary" @click="router.push('/spots')">添加景点</el-button>
      <el-button @click="router.push('/planner/' + trip.id + '/1')">编排第 1 天</el-button>
      <el-button type="warning" @click="router.push('/sync/' + trip.id)">离线分段合并</el-button>
      <el-button @click="router.push('/share/' + trip.id)">分享预览</el-button>
    </div>
    <section class="grid">
      <BudgetChart :spent="budget.spent" :remaining="budget.remaining" />
      <div class="band">
        <strong>统计（合并版本 {{ plan.version }}）</strong>
        <p>天数 {{ plan.days.length }} · 已定景点 {{ confirmedCount }}</p>
        <p class="muted">{{ budget.warning }}</p>
      </div>
    </section>
    <MergedDayTimeline
      v-for="day in plan.days"
      :key="day.day_index"
      :trip-id="trip.id"
      :day="day"
      :spots="spotStore.spots"
    />
  </main>
  <main v-else class="page"><EmptyState title="旅行不存在" /></main>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useTripStore } from '../stores/tripStore';
import { useSpotStore } from '../stores/spotStore';
import { useMergedPlan } from '../hooks/useMergedPlan';
import TripHeader from '../components/common/TripHeader.vue';
import MergedDayTimeline from '../components/common/MergedDayTimeline.vue';
import BudgetChart from '../components/common/BudgetChart.vue';
import EmptyState from '../components/common/EmptyState.vue';
const route = useRoute();
const router = useRouter();
const tripStore = useTripStore();
const spotStore = useSpotStore();
const tripId = String(route.params.id);
const trip = computed(() => tripStore.trips.find((item) => item.id === route.params.id));
const { plan, budget } = useMergedPlan(tripId);
const confirmedCount = computed(() =>
  (plan.value?.days || []).reduce((sum, day) => sum + day.items.filter((item) => item.status !== 'pending' && item.status !== 'invalid').length, 0),
);
</script>
