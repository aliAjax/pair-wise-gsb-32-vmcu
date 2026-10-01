<template>
  <main class="page">
    <div class="head">
      <div>
        <h2>离线分段合并中心</h2>
        <p class="muted">
          山区徒步分头行动离线改同一行程：改动带成员、时刻和出发前版本；旅行计划 / 每日安排 / 景点反馈分段接入；
          同天同景点两人改动并列保留，队长选定前不计入预算和分享；批次中断从上次完整结果继续；景点停业或涨价相关日期失效待确认。
        </p>
      </div>
      <div class="head-actions">
        <el-button size="small" @click="reseed">重置演示数据</el-button>
      </div>
    </div>

    <div class="grid">
      <BatchPanel :batches="syncStore.batches" @resume="syncStore.resumeBatch" @replay="onReplay" />

      <section class="band">
        <h3>当前预算 / 分享口径</h3>
        <p>
          计入花费 <strong>¥{{ budget.spent }}</strong> · 预算 ¥{{ projection.budget }} ·
          剩余 <strong :class="budget.remaining < 0 ? 'over' : ''">¥{{ budget.remaining }}</strong>
        </p>
        <p class="muted" v-if="budget.pendingCount">
          有 {{ budget.pendingCount }} 项待队长选定/确认，当前不计入预算和分享。
        </p>
        <el-tag :type="projection.ready_to_share ? 'success' : 'warning'">
          {{ projection.ready_to_share ? '可以分享' : '队长处理完才可分享' }}
        </el-tag>
        <el-input
          type="textarea"
          :rows="6"
          class="share"
          :model-value="shareText"
          readonly
        />
      </section>
    </div>

    <VariantPanel
      :variants="projection.variants"
      :spots="spotStore.spots"
      @choose="onChoose"
    />

    <InvalidationPanel
      :invalidations="projection.invalidations"
      :spots="spotStore.spots"
      @confirm="onConfirm"
    />

    <section class="band">
      <h3>离线改动录入（模拟一名成员）</h3>
      <div class="form">
        <el-select v-model="form.member" placeholder="成员" style="width: 120px">
          <el-option v-for="member in members" :key="member" :label="member" :value="member" />
        </el-select>
        <el-select v-model="form.spot_id" placeholder="景点" style="width: 160px">
          <el-option v-for="spot in spotStore.spots" :key="spot.id" :label="spot.name" :value="spot.id" />
        </el-select>
        <el-input-number v-model="form.day_index" :min="1" :max="9" controls-position="right" style="width: 110px" />
        <el-input v-model="form.start_time" placeholder="开始 HH:mm" style="width: 120px" />
        <el-input v-model="form.end_time" placeholder="结束 HH:mm" style="width: 120px" />
        <el-button type="primary" @click="onLogOffline">记录离线改动</el-button>
        <el-button @click="onCloseSpot">上报该景点停业</el-button>
        <el-button @click="onPriceChange">上报该景点涨价</el-button>
      </div>
      <p class="muted">改动先记录为事件（带着当前出发前版本 v{{ syncStore.head_version }}），再用下面的批次合入。</p>
      <div v-if="pendingEvents.length" class="pending">
        <el-tag v-for="event in pendingEvents" :key="event.id" closable type="info" @close="removePending(event.id)">
          {{ event.member }} · {{ eventLabel(event) }}
        </el-tag>
        <el-button type="success" size="small" @click="onCommitPending">作为新批次合入</el-button>
        <el-button size="small" @click="onCommitPendingInterrupted">合入但在景点反馈段前中断</el-button>
      </div>
    </section>

    <HistoryTimeline :snapshots="syncStore.snapshots" :spots="spotStore.spots" />
  </main>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { SegmentType, SyncEventType } from '../constants/sync';
import { useSyncStore } from '../stores/syncStore';
import { useSpotStore } from '../stores/spotStore';
import { effectiveBudget, buildShareText } from '../sync/projection';
import BatchPanel from '../components/common/BatchPanel.vue';
import VariantPanel from '../components/common/VariantPanel.vue';
import InvalidationPanel from '../components/common/InvalidationPanel.vue';
import HistoryTimeline from '../components/common/HistoryTimeline.vue';
import type { ChangeEvent, DayItemKey } from '../models/sync';

const syncStore = useSyncStore();
const spotStore = useSpotStore();
syncStore.seedDemoIfEmpty();

const DEMO_TRIP_ID = 'trip-hike-demo';
const projection = computed(() => syncStore.currentProjection);
const budget = computed(() => effectiveBudget(projection.value));
const shareText = computed(() => buildShareText({ projection: projection.value, spots: spotStore.spots }));

const members = ['队长', '阿岭', '小鹿', '我'];
const form = reactive({
  member: '小鹿',
  spot_id: 'spot-westlake',
  day_index: 1,
  date: '2026-10-03',
  start_time: '08:30',
  end_time: '09:30',
});

const pendingEventIds = ref<string[]>([]);
const pendingEvents = computed(() =>
  pendingEventIds.value
    .map((id) => syncStore.eventById(id))
    .filter((e): e is ChangeEvent => !!e),
);

const eventLabel = (event: ChangeEvent) => {
  if (event.type === SyncEventType.SPOT_CLOSED) return '停业反馈';
  if (event.type === SyncEventType.SPOT_PRICE_CHANGED) return '涨价反馈';
  return `第${(event.payload as { day_index?: number }).day_index ?? ''}天安排`;
};

const removePending = (id: string) => {
  pendingEventIds.value = pendingEventIds.value.filter((item) => item !== id);
};

const onLogOffline = () => {
  const event = syncStore.logEvent({
    trip_id: DEMO_TRIP_ID,
    type: SyncEventType.UPSERT_DAY_ITEM,
    segment: SegmentType.DAY_ITEMS,
    member: form.member,
    happened_at: new Date().toISOString(),
    payload: {
      day_index: form.day_index,
      date: form.date,
      spot_id: form.spot_id,
      start_time: form.start_time,
      end_time: form.end_time,
      note: '离线补记',
      transport: 'walk',
    },
  });
  pendingEventIds.value.push(event.id);
};

const onCloseSpot = () => {
  const event = syncStore.logEvent({
    trip_id: DEMO_TRIP_ID,
    type: SyncEventType.SPOT_CLOSED,
    segment: SegmentType.SPOT_FEED,
    member: form.member,
    happened_at: new Date().toISOString(),
    payload: { spot_id: form.spot_id },
  });
  pendingEventIds.value.push(event.id);
};

const onPriceChange = () => {
  const current = spotStore.spots.find((s) => s.id === form.spot_id);
  const event = syncStore.logEvent({
    trip_id: DEMO_TRIP_ID,
    type: SyncEventType.SPOT_PRICE_CHANGED,
    segment: SegmentType.SPOT_FEED,
    member: form.member,
    happened_at: new Date().toISOString(),
    payload: { spot_id: form.spot_id, new_price: (current?.price ?? 0) + 30 },
  });
  pendingEventIds.value.push(event.id);
};

const onCommitPending = (interrupt = false) => {
  if (!pendingEvents.value.length) return;
  const batch = syncStore.openBatch(
    DEMO_TRIP_ID,
    interrupt ? '手动批次（模拟中断）' : `手动批次 @ ${new Date().toLocaleTimeString()}`,
    pendingEvents.value,
  );
  syncStore.commitBatch(batch.id, interrupt ? { interruptBeforeSegmentIndex: 2 } : {});
  pendingEventIds.value = [];
};
const onCommitPendingInterrupted = () => onCommitPending(true);

const onReplay = (batchId: string) => {
  syncStore.replayBatch(batchId);
};

const onChoose = (key: DayItemKey, chosenEventId: string) => {
  syncStore.chooseVariant(DEMO_TRIP_ID, key, chosenEventId);
};

const onConfirm = (invalidationId: string) => {
  syncStore.confirmInvalidation(DEMO_TRIP_ID, invalidationId);
};

const reseed = () => {
  syncStore.resetDemo();
  syncStore.seedDemoIfEmpty();
};
</script>

<style scoped>
.head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
.grid { display: grid; grid-template-columns: 1.4fr 1fr; gap: 16px; }
.form { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.share { margin-top: 12px; }
.pending { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; align-items: center; }
.over { color: #c45656; }
.muted { color: #7a877a; font-size: 13px; }
@media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
</style>
