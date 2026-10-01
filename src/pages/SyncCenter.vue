<template>
  <main class="page sync-center">
    <h1>离线分段批次合并台</h1>
    <p class="muted">
      队员分头离线改同一行程：每条改动带<b>成员、时刻、出发前版本</b>；不同分段直接接上；
      同一天同一景点两人都动过则<b>并列保留</b>，队长选定前不计入预算和分享；
      批次中断后从上次完整结果续传，重放同批不多出安排。
    </p>

    <div class="toolbar">
      <el-select v-model="tripId" placeholder="选择旅行" style="width: 240px">
        <el-option v-for="trip in tripStore.trips" :key="trip.id" :label="trip.title" :value="trip.id" />
      </el-select>
      <el-button type="primary" :disabled="!tripId" @click="showCreate = true">新建分段批次</el-button>
      <el-button :disabled="!tripId" @click="seedScenario">载入"两人离线改同一行程"演示</el-button>
    </div>

    <template v-if="tripId">
      <!-- 当前生效结果 -->
      <section class="band">
        <h2>当前合并结果（{{ plan?.version }}）</h2>
        <p class="muted" v-if="!plan">投影中…</p>
        <template v-else>
          <p>
            目的地 {{ plan.trip.destination }} ·
            预算 <b>¥{{ plan.trip.budget }}</b> ·
            同行人 {{ plan.trip.members.join('、') || '（空）' }}
          </p>
          <el-alert v-if="budget.warning" :title="budget.warning" type="warning" :closable="false" show-icon style="margin: 8px 0" />
          <p>
            已计入花费 <b>¥{{ budget.spent }}</b>，剩余 ¥{{ budget.remaining }}
            （并列待选定 {{ budget.pendingCount }} 项 / 待确认 {{ budget.invalidCount }} 项均不计入）
          </p>

          <!-- trip 级字段并列（预算 / 同行人 / 日期被两人动过） -->
          <div v-for="conflict in plan.fieldConflicts" :key="conflict.conflictKey" class="field-conflict">
            <strong>{{ fieldLabel(conflict.field) }}：</strong>
            <el-radio-group
              :model-value="conflict.resolved ? conflict.selectedChangeId : ''"
              size="small"
              @change="(value) => syncStore.decide(tripId!, conflict.conflictKey, String(value), '队长')"
            >
              <el-radio v-for="variant in conflict.variants" :key="variant.changeId" :value="variant.changeId">
                {{ variant.member }}：{{ variant.value || '（空）' }} <span class="muted">({{ variant.baseVersion }})</span>
              </el-radio>
            </el-radio-group>
            <el-tag v-if="!conflict.resolved" type="warning" size="small">两人改动并列，待队长选定</el-tag>
          </div>

          <MergedDayTimeline
            v-for="day in plan.days"
            :key="day.day_index"
            :trip-id="tripId"
            :day="day"
            :spots="spotStore.spots"
          />
        </template>
      </section>

      <!-- 分段批次 -->
      <section class="band">
        <h2>分段批次与重放水位</h2>
        <el-table :data="syncStore.batchesOfTrip(tripId)" size="small" empty-text="还没有批次">
          <el-table-column prop="label" label="批次" min-width="140" />
          <el-table-column label="分段（天）" min-width="110">
            <template #default="{ row }">{{ row.segmentDays.join('、') }}</template>
          </el-table-column>
          <el-table-column prop="member" label="记录成员" min-width="90" />
          <el-table-column prop="baseVersion" label="基于版本" width="90" />
          <el-table-column label="状态 / 水位" min-width="170">
            <template #default="{ row }">
              <el-tag :type="batchTagType(row.status)" size="small">{{ batchStatusText[row.status as BatchStatus] }}</el-tag>
              {{ row.appliedCount }}/{{ eventCount(row.id) }}
            </template>
          </el-table-column>
          <el-table-column label="操作" min-width="250">
            <template #default="{ row }">
              <el-button size="small" :disabled="row.status === BatchStatus.COMPLETED" @click="syncStore.processBatch(row.id, 1)">
                重放 1 条（模拟中断）
              </el-button>
              <el-button size="small" type="primary" :disabled="row.status === BatchStatus.COMPLETED" @click="syncStore.processBatch(row.id)">
                续传至完整
              </el-button>
            </template>
          </el-table-column>
        </el-table>
        <p class="muted">中断后再次"续传"从 appliedCount 水位继续；对已完成批次再次重放不会多出安排或快照。</p>
      </section>

      <!-- 离线改动录入 -->
      <section class="band">
        <h2>记录一条离线改动</h2>
        <div class="toolbar">
          <el-select v-model="form.batchId" placeholder="批次" style="width: 200px">
            <el-option v-for="batch in pendingBatches" :key="batch.id" :label="`${batch.label}（${batch.baseVersion}）`" :value="batch.id" />
          </el-select>
          <el-input v-model="form.member" placeholder="成员，如 阿山" style="width: 130px" />
          <el-select v-model="form.kind" style="width: 150px">
            <el-option label="改某天景点安排" value="item" />
            <el-option label="改预算/同行人/日期" value="field" />
          </el-select>
        </div>
        <div v-if="form.kind === 'item'" class="toolbar">
          <el-input-number v-model="form.dayIndex" :min="1" :max="9" />
          <el-select v-model="form.spotId" placeholder="景点" style="width: 200px">
            <el-option v-for="spot in spotStore.spots" :key="spot.id" :label="spot.name" :value="spot.id" />
          </el-select>
          <el-time-picker v-model="form.startAt" format="HH:mm" value-format="HH:mm" placeholder="开始" style="width: 110px" />
          <el-time-picker v-model="form.endAt" format="HH:mm" value-format="HH:mm" placeholder="结束" style="width: 110px" />
          <el-input v-model="form.note" placeholder="备注" style="width: 160px" />
          <el-select v-model="form.transport" style="width: 100px">
            <el-option v-for="(text, value) in transportText" :key="value" :label="text" :value="value" />
          </el-select>
          <el-button type="primary" @click="recordItem">记录安排改动</el-button>
          <el-button @click="recordRemove">记录删除该安排</el-button>
        </div>
        <div v-else class="toolbar">
          <el-select v-model="form.field" style="width: 130px">
            <el-option label="预算" value="budget" />
            <el-option label="同行人" value="members" />
            <el-option label="出发日期" value="start_date" />
            <el-option label="返程日期" value="end_date" />
          </el-select>
          <el-input v-model="form.value" :placeholder="form.field === 'members' ? '逗号分隔，如 我,阿山,小溪' : '新值'" style="width: 240px" />
          <el-button type="primary" @click="recordField">记录字段改动</el-button>
        </div>
      </section>

      <!-- 景点停业 / 价格变化 -->
      <section class="band">
        <h2>景点变化登记（停业 / 价格）</h2>
        <div class="toolbar">
          <el-select v-model="revision.spotId" placeholder="景点" style="width: 200px">
            <el-option v-for="spot in spotStore.spots" :key="spot.id" :label="spot.name" :value="spot.id" />
          </el-select>
          <el-select v-model="revision.kind" style="width: 130px">
            <el-option label="景点停业" :value="SpotChangeKind.CLOSED" />
            <el-option label="价格变化" :value="SpotChangeKind.PRICE" />
          </el-select>
          <el-input-number v-if="revision.kind === SpotChangeKind.PRICE" v-model="revision.newPrice" :min="0" />
          <el-select v-model="revision.days" multiple placeholder="受影响的天" style="min-width: 180px">
            <el-option v-for="day in 4" :key="day" :label="`第 ${day} 天`" :value="day" />
          </el-select>
          <el-button type="warning" @click="registerRevision">登记</el-button>
        </div>
        <el-table :data="tripRevisions" size="small" empty-text="暂无景点变化">
          <el-table-column label="景点" min-width="140">
            <template #default="{ row }">{{ spotName(row.spotId) }}</template>
          </el-table-column>
          <el-table-column label="变化" width="100">
            <template #default="{ row }">{{ spotChangeKindText[row.kind as SpotChangeKind] }}{{ row.kind === 'price' ? ' ¥' + row.newPrice : '' }}</template>
          </el-table-column>
          <el-table-column label="失效日期" min-width="110">
            <template #default="{ row }">第 {{ row.affectedDayIndexes.join('、') }} 天</template>
          </el-table-column>
          <el-table-column label="已确认" min-width="120">
            <template #default="{ row }">{{ row.acknowledgedDayIndexes.length ? '第 ' + row.acknowledgedDayIndexes.join('、') + ' 天' : '未确认' }}</template>
          </el-table-column>
          <el-table-column label="操作" min-width="200">
            <template #default="{ row }">
              <el-button
                v-for="dayIndex in row.affectedDayIndexes"
                :key="dayIndex"
                size="small"
                :disabled="row.acknowledgedDayIndexes.includes(String(dayIndex))"
                @click="syncStore.acknowledgeDay(row.id, dayIndex)"
              >确认第 {{ dayIndex }} 天</el-button>
            </template>
          </el-table-column>
        </el-table>
      </section>

      <!-- 事件流 -->
      <section class="band">
        <h2>事件流（{{ changes.length }} 条，只追加）</h2>
        <el-table :data="changes" size="small" max-height="320" empty-text="还没有离线改动">
          <el-table-column label="成员" width="80"><template #default="{ row }">{{ row.member }}</template></el-table-column>
          <el-table-column label="对象" min-width="150">
            <template #default="{ row }">
              {{ row.target === 'trip' ? '行程·' + fieldLabel(row.field) : `第 ${row.dayIndex} 天·${spotName(row.spotId)}` }}
            </template>
          </el-table-column>
          <el-table-column label="操作" width="80">
            <template #default="{ row }">{{ row.op === 'upsert' ? '写入' : '删除' }}</template>
          </el-table-column>
          <el-table-column prop="baseVersion" label="版本" width="70" />
          <el-table-column label="时刻" width="120">
            <template #default="{ row }">{{ formatDateTime(row.happenedAt) }}</template>
          </el-table-column>
          <el-table-column label="批次" min-width="120">
            <template #default="{ row }">{{ batchLabel(row.batchId) }}</template>
          </el-table-column>
        </el-table>
      </section>

      <!-- 历史快照 -->
      <section class="band">
        <h2>历史合并结果（旧结果仍可查看）</h2>
        <div v-for="snapshot in snapshots" :key="snapshot.id" class="snapshot-row">
          <el-tag size="small">{{ snapshot.version }}</el-tag>
          <span>{{ snapshot.batchLabel }}</span>
          <span class="muted">{{ formatDateTime(snapshot.createdAt) }}</span>
          <el-button size="small" @click="viewSnapshot(snapshot.id)">查看旧结果</el-button>
        </div>
        <p v-if="!snapshots.length" class="muted">批次完整重放后才会生成快照。</p>
      </section>
    </template>

    <!-- 新建批次对话框 -->
    <el-dialog v-model="showCreate" title="新建分段批次" width="420px">
      <div class="dialog-row">
        <span>批次名</span>
        <el-input v-model="createForm.label" style="width: 220px" />
      </div>
      <div class="dialog-row">
        <span>记录成员</span>
        <el-input v-model="createForm.member" style="width: 220px" />
      </div>
      <div class="dialog-row">
        <span>负责分段</span>
        <el-select v-model="createForm.days" multiple style="width: 220px">
          <el-option v-for="day in 4" :key="day" :label="`第 ${day} 天`" :value="day" />
        </el-select>
      </div>
      <div class="dialog-row muted">不指定基于版本时自动取当前最新完整版本（{{ tripId ? syncStore.currentVersion(tripId) : 'v0' }}）</div>
      <template #footer>
        <el-button @click="showCreate = false">取消</el-button>
        <el-button type="primary" @click="createBatch">建立批次</el-button>
      </template>
    </el-dialog>
  </main>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  ElSelect, ElOption, ElButton, ElInput, ElInputNumber, ElTimePicker, ElTable, ElTableColumn,
  ElTag, ElRadioGroup, ElRadio, ElAlert, ElDialog,
} from 'element-plus';
import { BatchStatus, ChangeOp, SpotChangeKind } from '../constants/sync';
import { batchStatusText, formatDateTime, spotChangeKindText, transportText } from '../utils/formatters';
import { useTripStore } from '../stores/tripStore';
import { useSpotStore } from '../stores/spotStore';
import { useDayPlanStore } from '../stores/dayPlanStore';
import { useSyncStore } from '../stores/syncStore';
import { useMergedPlan } from '../hooks/useMergedPlan';
import MergedDayTimeline from '../components/common/MergedDayTimeline.vue';
import { fieldLabel } from '../utils/syncReducer';

const route = useRoute();
const router = useRouter();
const tripStore = useTripStore();
const spotStore = useSpotStore();
const dayPlanStore = useDayPlanStore();
const syncStore = useSyncStore();

const tripId = ref<string>(String(route.params.tripId || tripStore.trips[0]?.id || ''));
watch(tripId, (value) => { if (value) router.replace(`/sync/${value}`); });

const { plan, budget } = useMergedPlan(tripId);

const changes = computed(() => (tripId.value ? syncStore.changesOfTrip(tripId.value) : []));
const snapshots = computed(() => (tripId.value ? syncStore.snapshotsOfTrip(tripId.value) : []));
const tripRevisions = computed(() => syncStore.revisions.filter((revision) => relevantSpots(revision.spotId)));
function relevantSpots(spotId: string) {
  return [...new Set(changes.value.map((change) => change.spotId).filter(Boolean))].includes(spotId)
    || dayPlanStore.dayPlans.some((day) => day.trip_id === tripId.value && day.items.some((item) => item.spot_id === spotId));
}

const pendingBatches = computed(() => syncStore.batches.filter((batch) => batch.tripId === tripId.value && batch.status !== BatchStatus.COMPLETED));
const eventCount = (batchId: string) => changes.value.filter((change) => change.batchId === batchId).length;
const batchLabel = (batchId: string) => syncStore.batches.find((batch) => batch.id === batchId)?.label || batchId;
const spotName = (id: string | null) => (id ? spotStore.spots.find((spot) => spot.id === id)?.name || id : '');

const batchTagType = (status: BatchStatus) => (status === BatchStatus.COMPLETED ? 'success' : status === BatchStatus.PARTIAL ? 'warning' : 'info');

// ---- 新建批次 ----
const showCreate = ref(false);
const createForm = reactive({ label: '', member: '', days: [1] as number[] });
function createBatch() {
  if (!tripId.value || !createForm.label || !createForm.member || !createForm.days.length) return;
  const id = syncStore.createBatch({
    tripId: tripId.value,
    label: createForm.label,
    member: createForm.member,
    segmentDays: createForm.days,
  });
  form.batchId = id;
  form.member = createForm.member;
  showCreate.value = false;
}

// ---- 离线改动表单 ----
const form = reactive({
  batchId: '',
  member: '',
  kind: 'item' as 'item' | 'field',
  dayIndex: 1,
  spotId: spotStore.spots[0]?.id || '',
  startAt: '09:00',
  endAt: '11:00',
  note: '离线调整',
  transport: 'metro' as 'walk' | 'metro' | 'taxi' | 'train',
  field: 'budget' as 'budget' | 'members' | 'start_date' | 'end_date',
  value: '',
});

function ensureBatchFor(member: string, days: number[], label: string): string {
  const existing = pendingBatches.value.find((batch) => batch.member === member && batch.segmentDays.join(',') === days.join(','));
  if (existing) return existing.id;
  return syncStore.createBatch({ tripId: tripId.value, label, member, segmentDays: days });
}

function recordItem() {
  if (!form.batchId) return;
  syncStore.recordItemChange({
    tripId: tripId.value,
    batchId: form.batchId,
    member: form.member,
    dayIndex: form.dayIndex,
    spotId: form.spotId,
    item: { spot_id: form.spotId, start_time: form.startAt, end_time: form.endAt, note: form.note, transport: form.transport },
  });
}
function recordRemove() {
  if (!form.batchId) return;
  syncStore.recordItemChange({
    tripId: tripId.value,
    batchId: form.batchId,
    member: form.member,
    dayIndex: form.dayIndex,
    spotId: form.spotId,
    op: ChangeOp.REMOVE,
  });
}
function recordField() {
  if (!form.batchId) return;
  syncStore.recordFieldChange({
    tripId: tripId.value,
    batchId: form.batchId,
    member: form.member,
    field: form.field,
    value: form.value,
  });
}

// ---- 景点变化 ----
const revision = reactive({ spotId: spotStore.spots[0]?.id || '', kind: SpotChangeKind.CLOSED, newPrice: 80, days: [1] as number[] });
function registerRevision() {
  if (!revision.spotId || !revision.days.length) return;
  syncStore.registerRevision(revision.spotId, revision.kind, revision.newPrice, revision.days);
}

// ---- 历史快照查看 ----
function viewSnapshot(snapshotId: string) {
  router.push(`/share/${tripId.value}?snapshot=${snapshotId}`);
}

// ---- 一键演示：两人离线同时改第 1 天同一景点与预算，分段分别覆盖第 1、2 天 ----
function seedScenario() {
  if (!tripId.value) return;
  const spot = spotStore.spots[1] || spotStore.spots[0];
  // 出发前基线：第 1 天上午该景点
  const dayOne = dayPlanStore.ensureDay(tripId.value, 1, '2026-10-02');
  if (!dayOne.items.some((item) => item.spot_id === spot.id)) {
    dayOne.items.push({
      spot_id: spot.id, start_time: '09:00', end_time: '11:00', note: '出发前排好', transport: 'metro',
    });
  }
  dayPlanStore.ensureDay(tripId.value, 2, '2026-10-03');
  dayPlanStore.persist();

  const batchA = syncStore.createBatch({ tripId: tripId.value, label: '阿山分段（第1天）', member: '阿山', segmentDays: [1] });
  const batchB = syncStore.createBatch({ tripId: tripId.value, label: '小溪分段（第1-2天）', member: '小溪', segmentDays: [1, 2] });

  const t0 = Date.UTC(2026, 8, 30, 2, 0, 0);
  const at = (offsetMin: number) => new Date(t0 + offsetMin * 60000).toISOString();

  // 同一天同一景点，两人都改了时刻 => 合并后并列
  syncStore.recordItemChange({
    tripId: tripId.value, batchId: batchA, member: '阿山', dayIndex: 1, spotId: spot.id,
    item: { spot_id: spot.id, start_time: '08:00', end_time: '10:00', note: '阿山想早去避人潮', transport: 'taxi' },
    happenedAt: at(10),
  });
  syncStore.recordItemChange({
    tripId: tripId.value, batchId: batchB, member: '小溪', dayIndex: 1, spotId: spot.id,
    item: { spot_id: spot.id, start_time: '13:00', end_time: '15:30', note: '小溪下午才到山脚', transport: 'walk' },
    happenedAt: at(20),
  });
  // 小溪在自己分段第 2 天独占添加，直接接上、不冲突
  const other = spotStore.spots[0];
  syncStore.recordItemChange({
    tripId: tripId.value, batchId: batchB, member: '小溪', dayIndex: 2, spotId: other.id,
    item: { spot_id: other.id, start_time: '10:00', end_time: '12:00', note: '第2段直接接上', transport: 'walk' },
    happenedAt: at(30),
  });
  // 两人又分别改了预算 => 行程字段并列，队长选定前预算沿用出发前
  syncStore.recordFieldChange({ tripId: tripId.value, batchId: batchA, member: '阿山', field: 'budget', value: '3800', happenedAt: at(40) });
  syncStore.recordFieldChange({ tripId: tripId.value, batchId: batchB, member: '小溪', field: 'budget', value: '2600', happenedAt: at(50) });

  form.batchId = batchA;
  form.member = '阿山';
  form.spotId = spot.id;
}
</script>

<style scoped>
.sync-center h2 { margin: 0 0 10px; font-size: 17px; }
.field-conflict { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 8px 0; }
.snapshot-row { display: flex; align-items: center; gap: 12px; padding: 6px 0; }
.dialog-row { display: flex; align-items: center; gap: 12px; margin: 12px 0; }
</style>
