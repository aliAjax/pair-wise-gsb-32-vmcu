<template>
  <section class="band merged-day" :class="{ 'stale-day': day.stale }">
    <h3>
      第 {{ day.day_index }} 天 · {{ day.date }}
      <el-tag v-if="day.stale" type="warning" size="small">日期失效待确认</el-tag>
      <span class="muted day-cost">当天计入 ¥{{ dayCost }}</span>
    </h3>
    <ul class="reasons" v-if="day.staleReasons.length">
      <li v-for="reason in day.staleReasons" :key="reason" class="muted">⚠️ {{ reason }}</li>
    </ul>

    <table class="variants">
      <thead>
        <tr>
          <th>状态</th>
          <th>景点 / 时刻</th>
          <th>改动成员</th>
          <th>基于版本</th>
          <th v-if="selectable">队长选定</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="group in groups" :key="group.key" :class="rowClass(group)">
          <td class="col-status">
            <el-tag v-for="tag in groupTags(group)" :key="tag.text" :type="tag.type" size="small" class="status-tag">{{ tag.text }}</el-tag>
          </td>
          <td>
            <div v-for="item in group.items" :key="item.changeId" class="variant-line" :class="dimmed(item)">
              <strong>{{ spotName(item.spot_id) }}</strong>
              <span class="muted">{{ item.start_time }}-{{ item.end_time }} · {{ transportText[item.transport] }} · {{ item.note }}</span>
            </div>
          </td>
          <td>
            <div v-for="item in group.items" :key="item.changeId" class="variant-line">{{ item.member }}</div>
          </td>
          <td>
            <div v-for="item in group.items" :key="item.changeId" class="variant-line muted">{{ item.baseVersion }}</div>
          </td>
          <td v-if="selectable">
            <el-radio-group :model-value="selectedId(group)" size="small" @change="(value) => choose(group.key, String(value))">
              <el-radio v-for="item in group.items" :key="item.changeId" :value="item.changeId">
                {{ shortLabel(item.member) }}
              </el-radio>
            </el-radio-group>
            <el-button
              v-if="activeRevision(group)"
              link
              type="primary"
              size="small"
              @click="acknowledge(activeRevision(group)!.id)"
            >确认该日期</el-button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-if="!day.items.length" class="muted">这一天还没有安排。</p>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { ElTag, ElRadioGroup, ElRadio, ElButton } from 'element-plus';
import type { EffectiveDay, EffectiveItem } from '../../utils/syncReducer';
import type { Spot } from '../../models/spot';
import type { SpotRevision } from '../../models/sync';
import { transportText } from '../../utils/formatters';
import { calcEffectiveDayCost } from '../../utils/budgetCalculator';
import { useSyncStore } from '../../stores/syncStore';

const props = withDefaults(defineProps<{
  tripId: string;
  day: EffectiveDay;
  spots: Spot[];
  /** 是否显示队长选定控件（历史快照只读视图传 false） */
  selectable?: boolean;
  /** 只读快照视图使用历史价格表复现旧金额 */
  priceMap?: Record<string, number>;
}>(), { selectable: true });

const syncStore = useSyncStore();
const spotMap = computed(() => new Map(props.spots.map((spot) => [spot.id, spot])));
const spotName = (id: string) => spotMap.value.get(id)?.name || id;

const dayCost = computed(() => calcEffectiveDayCost(props.day, props.spots, props.priceMap));

interface ItemGroup { key: string; items: EffectiveItem[] }

/** 同一天同一景点的多个候选按冲突键聚成一组（并列保留） */
const groups = computed<ItemGroup[]>(() => {
  const map = new Map<string, EffectiveItem[]>();
  for (const item of props.day.items) {
    map.set(item.conflictKey, [...(map.get(item.conflictKey) || []), item]);
  }
  return [...map.entries()].map(([key, items]) => ({ key, items }));
});

const selectedId = (group: ItemGroup) => {
  const picked = group.items.find((item) => item.status === 'selected');
  if (picked) return picked.changeId;
  if (group.items.length === 1 && group.items[0].status === 'base') return group.items[0].changeId;
  return '';
};

const rowClass = (group: ItemGroup) => ({
  'row-pending': group.items.some((item) => item.status === 'pending'),
  'row-invalid': group.items.some((item) => item.status === 'invalid'),
});

const dimmed = (item: EffectiveItem) => ({
  'is-dimmed': item.status === 'pending' || item.status === 'invalid',
});

const shortLabel = (member: string) => (member === '出发前原版' ? '原版' : member);

interface TagView { text: string; type: 'success' | 'warning' | 'info' | 'danger' }
function groupTags(group: ItemGroup): TagView[] {
  const tags: TagView[] = [];
  if (group.items.some((item) => item.status === 'pending')) tags.push({ text: '并列待选定', type: 'warning' });
  if (group.items.some((item) => item.status === 'invalid')) tags.push({ text: '待确认', type: 'danger' });
  if (group.items.some((item) => item.status === 'selected')) tags.push({ text: '已选定', type: 'success' });
  if (group.items.length === 1 && group.items[0].status === 'base') tags.push({ text: '原版', type: 'info' });
  return tags;
}

const activeRevision = (group: ItemGroup): SpotRevision | null => {
  const first = group.items[0];
  if (!first) return null;
  return syncStore.activeRevision(first.spot_id, props.day.day_index);
};

function choose(key: string, changeId: string) {
  syncStore.decide(props.tripId, key, changeId, '队长');
}

function acknowledge(revisionId: string) {
  syncStore.acknowledgeDay(revisionId, props.day.day_index);
}
</script>

<style scoped>
.merged-day { margin-bottom: 14px; }
.stale-day { border-color: #e6a23c; background: #fff8ec; }
.day-cost { margin-left: 10px; font-size: 12px; }
.reasons { margin: 6px 0; padding-left: 18px; }
.status-tag { margin-right: 4px; }
.variants { width: 100%; border-collapse: collapse; margin-top: 8px; }
.variants th, .variants td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #eef0e6; vertical-align: top; font-size: 13px; }
.variants th { color: #61706b; font-weight: 600; }
.variant-line { padding: 2px 0; }
.is-dimmed { opacity: 0.62; }
.row-pending { background: #fdf6ec55; }
.row-invalid { background: #fef0f055; }
</style>
