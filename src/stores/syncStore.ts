import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import {
  BASELINE_VERSION,
  BatchState,
  SEGMENT_ORDER,
  SegmentType,
  SyncEventType,
} from '../constants/sync';
import { TripStatus } from '../constants/trip';
import type {
  ChangeBatch,
  ChangeEvent,
  DayItemKey,
  SyncPayload,
  SyncState,
  UpsertDayItemPayload,
} from '../models/sync';
import { syncApi, emptySyncState } from '../api/syncApi';
import { applyBatch, replayProducesNoNewEvents, type ApplyOptions } from '../sync/engine';
import {
  buildSnapshot,
  mapKey,
  orderEvents,
  project,
  reduceEvents,
  type BasePlan,
} from '../sync/reducer';
import { messages } from '../constants/messages';
import { toast } from '../utils/message';
import { useTripStore } from './tripStore';
import { useSpotStore } from './spotStore';

const DEMO_TRIP_ID = 'trip-hike-demo';
export const DEMO_BASE: BasePlan = { title: '山区徒步三日', budget: 3200, members: ['我', '队长'] };

export const useSyncStore = defineStore('sync', () => {
  const initial = syncApi.load();
  const events = ref<ChangeEvent[]>(initial.events);
  const batches = ref<ChangeBatch[]>(initial.batches);
  const snapshots = ref(initial.snapshots);
  const headVersion = ref<number>(initial.head_version);
  const spotOverrides = ref<SyncState['spotOverrides']>(initial.spotOverrides);

  const latestSnapshot = computed(() => (snapshots.value.length ? snapshots.value[snapshots.value.length - 1] : undefined));

  const committedEventIds = computed<Set<string>>(
    () => new Set(latestSnapshot.value?.event_ids ?? []),
  );

  /** 已合入事件按规范顺序（不同段直接接上，段内按时刻） */
  const appliedEvents = computed<ChangeEvent[]>(() =>
    orderEvents(
      (latestSnapshot.value?.event_ids ?? [])
        .map((id) => events.value.find((e) => e.id === id))
        .filter((e): e is ChangeEvent => !!e),
    ),
  );

  const currentProjection = computed(() => {
    const spotStore = useSpotStore();
    const snap = latestSnapshot.value;
    const base: BasePlan = snap
      ? { title: snap.title, budget: snap.budget, members: snap.members }
      : DEMO_BASE;
    return project(reduceEvents(appliedEvents.value, base), spotStore.spots);
  });

  function persist() {
    syncApi.save({
      events: events.value,
      batches: batches.value,
      snapshots: snapshots.value,
      head_version: headVersion.value,
      spotOverrides: spotOverrides.value,
    });
  }

  function eventById(id: string) {
    return events.value.find((e) => e.id === id);
  }

  /**
   * 单调逻辑时钟：后发生的在线裁决（选定/确认）必须晚于当前所有已见事件，
   * 否则按 happened_at 重放时会出现“先确认、后收到反馈”的乱序，反馈又把确认冲掉。
   * 墙上时钟只用于展示，逻辑顺序由这个时钟保证，重放因此稳定。
   */
  function nextHappenedAt() {
    const latest = events.value.reduce((max, e) => (e.happened_at > max ? e.happened_at : max), '');
    const baseMs = latest ? Date.parse(latest) : Date.now();
    return new Date(baseMs + 1).toISOString();
  }

  function batchEvents(batch: ChangeBatch) {
    return batch.event_ids
      .map((id) => events.value.find((e) => e.id === id))
      .filter((e): e is ChangeEvent => !!e);
  }

  function logEvent<T extends SyncPayload>(input: {
    trip_id: string;
    type: ChangeEvent<T>['type'];
    segment: SegmentType;
    member: string;
    happened_at: string;
    base_version?: number;
    payload: T;
  }): ChangeEvent<T> {
    const full = {
      ...input,
      id: crypto.randomUUID(),
      base_version: input.base_version ?? headVersion.value,
    } as ChangeEvent<T>;
    events.value.push(full as ChangeEvent);
    persist();
    return full;
  }

  function openBatch(tripId: string, label: string, listed: ChangeEvent[]): ChangeBatch {
    const batch: ChangeBatch = {
      id: crypto.randomUUID(),
      trip_id: tripId,
      label,
      state: BatchState.OPEN,
      event_ids: listed.map((e) => e.id),
      processed_count: 0,
      created_at: new Date().toISOString(),
    };
    batches.value.push(batch);
    persist();
    return batch;
  }

  /**
   * 以固定出发前基线 + 当前已提交事件，重算出一份不可变快照。
   * 事件溯源下结果只由事件集合决定，因此重放确定性强、可随时重建旧结果。
   */
  function rebuildSnapshot(tripId: string, extra: ChangeEvent[] = []) {
    const spotStore = useSpotStore();
    const prevIds = latestSnapshot.value?.event_ids ?? [];
    const idList = [...new Set([...prevIds, ...extra.map((e) => e.id)])];
    const tripEvents = idList
      .map((id) => events.value.find((e) => e.id === id))
      .filter((e): e is ChangeEvent => !!e && e.trip_id === tripId);

    headVersion.value = tripEvents.length;
    const snapshot = buildSnapshot({
      version: headVersion.value,
      events: tripEvents,
      base: DEMO_BASE,
      spots: spotStore.spots,
    });
    snapshots.value.push(snapshot);
    spotOverrides.value = Object.fromEntries(reduceEvents(tripEvents, DEMO_BASE).overrides);
    persist();
    return snapshot;
  }

  /**
   * 分段接入一个批次。中断点在段边界：已完整接入的段立即固化一份完整结果快照；
   * 再次调用同批次即从上次完整结果继续。
   */
  function commitBatch(batchId: string, options: ApplyOptions = {}) {
    const batch = batches.value.find((b) => b.id === batchId);
    if (!batch) return;
    if (batch.state === BatchState.APPLIED) {
      toast.ok(messages.syncBatchReplayed);
      return;
    }
    const result = applyBatch(batch, events.value, committedEventIds.value, options);
    Object.assign(batch, result.batch);

    if (result.newlyApplied.length) rebuildSnapshot(batch.trip_id, result.newlyApplied);
    persist();

    if (result.interrupted) {
      toast.ok(`${messages.syncBatchInterrupted}（已完成 ${batch.processed_count}/${SEGMENT_ORDER.length} 段）`);
    } else {
      toast.ok(messages.syncBatchApplied);
    }
  }

  function resumeBatch(batchId: string) {
    commitBatch(batchId);
  }

  /** 显式重放同批：必须不产生任何新安排 */
  function replayBatch(batchId: string) {
    const batch = batches.value.find((b) => b.id === batchId);
    if (!batch || batch.state !== BatchState.APPLIED) return false;
    const first = applyBatch(batch, events.value, committedEventIds.value);
    const replay = applyBatch(batch, events.value, committedEventIds.value);
    const safe = replayProducesNoNewEvents(first, replay);
    toast.ok(safe ? messages.syncBatchReplayed : '重放异常：检测到重复安排');
    return safe;
  }

  /** 队长在并列项里选定一个成员的版本（选定后才计入预算/分享） */
  function chooseVariant(tripId: string, key: DayItemKey, chosenEventId: string, member = '队长') {
    const resolver = logEvent({
      trip_id: tripId,
      type: SyncEventType.RESOLVE_VARIANT,
      segment: SegmentType.DAY_ITEMS,
      member,
      happened_at: nextHappenedAt(),
      payload: { key, chosen_event_id: chosenEventId },
    });
    rebuildSnapshot(tripId, [resolver]);
    toast.ok(messages.syncVariantChosen);
  }

  /** 队长确认景点停业/价格变化带来的日期失效 */
  function confirmInvalidation(tripId: string, invalidationId: string, member = '队长') {
    const resolver = logEvent({
      trip_id: tripId,
      type: SyncEventType.CONFIRM_INVALIDATION,
      segment: SegmentType.SPOT_FEED,
      member,
      happened_at: nextHappenedAt(),
      payload: { invalidation_id: invalidationId },
    });
    rebuildSnapshot(tripId, [resolver]);
    toast.ok(messages.syncInvalidationConfirmed);
  }

  function snapshotVersion(version: number) {
    return snapshots.value.find((s) => s.version === version);
  }

  function variantFor(key: DayItemKey) {
    return currentProjection.value.variants.find((v) => mapKey(v.key) === mapKey(key));
  }

  /**
   * 造一段离线场景演示：队长和阿岭分头离线改同一行程，同一天同一景点各改时刻；
   * 第一批在“景点反馈段”前中断，第二批从上次完整结果继续补上价格反馈。
   */
  function seedDemoIfEmpty() {
    if (syncApi.isSeeded() || events.value.length) return;
    const tripStore = useTripStore();
    if (!tripStore.trips.some((t) => t.id === DEMO_TRIP_ID)) {
      tripStore.trips.unshift({
        id: DEMO_TRIP_ID,
        title: DEMO_BASE.title,
        destination: '莫干山',
        start_date: '2026-10-03',
        end_date: '2026-10-05',
        budget: DEMO_BASE.budget,
        currency: 'CNY',
        members: DEMO_BASE.members,
        status: TripStatus.PLANNING,
        created_at: new Date().toISOString(),
      });
    }

    const budgetEvent = logEvent({
      trip_id: DEMO_TRIP_ID,
      type: SyncEventType.SET_BUDGET,
      segment: SegmentType.TRIP_META,
      member: '队长',
      happened_at: '2026-10-02T20:00:00.000Z',
      payload: { budget: 3000 },
    });
    const addMember = logEvent({
      trip_id: DEMO_TRIP_ID,
      type: SyncEventType.ADD_MEMBER,
      segment: SegmentType.TRIP_META,
      member: '队长',
      happened_at: '2026-10-02T20:05:00.000Z',
      payload: { member: '阿岭' },
    });

    const day1Key = { day_index: 1, date: '2026-10-03', spot_id: 'spot-park' };
    const leaderItem = logEvent({
      trip_id: DEMO_TRIP_ID,
      type: SyncEventType.UPSERT_DAY_ITEM,
      segment: SegmentType.DAY_ITEMS,
      member: '队长',
      happened_at: '2026-10-03T01:10:00.000Z',
      payload: { ...day1Key, start_time: '09:00', end_time: '11:00', note: '趁凉快走', transport: 'walk' } satisfies UpsertDayItemPayload,
    });
    const mateItem = logEvent({
      trip_id: DEMO_TRIP_ID,
      type: SyncEventType.UPSERT_DAY_ITEM,
      segment: SegmentType.DAY_ITEMS,
      member: '阿岭',
      happened_at: '2026-10-03T01:40:00.000Z',
      payload: { ...day1Key, start_time: '10:30', end_time: '12:30', note: '先吃早饭', transport: 'taxi' } satisfies UpsertDayItemPayload,
    });
    const museumItem = logEvent({
      trip_id: DEMO_TRIP_ID,
      type: SyncEventType.UPSERT_DAY_ITEM,
      segment: SegmentType.DAY_ITEMS,
      member: '队长',
      happened_at: '2026-10-03T02:00:00.000Z',
      payload: {
        day_index: 2,
        date: '2026-10-04',
        spot_id: 'spot-museum',
        start_time: '13:00',
        end_time: '15:00',
        note: '室内避暑',
        transport: 'metro',
      } satisfies UpsertDayItemPayload,
    });
    const marketItem = logEvent({
      trip_id: DEMO_TRIP_ID,
      type: SyncEventType.UPSERT_DAY_ITEM,
      segment: SegmentType.DAY_ITEMS,
      member: '阿岭',
      happened_at: '2026-10-03T02:20:00.000Z',
      payload: {
        day_index: 3,
        date: '2026-10-05',
        spot_id: 'spot-market',
        start_time: '18:00',
        end_time: '20:00',
        note: '夜市收尾',
        transport: 'walk',
      } satisfies UpsertDayItemPayload,
    });
    const priceEvent = logEvent({
      trip_id: DEMO_TRIP_ID,
      type: SyncEventType.SPOT_PRICE_CHANGED,
      segment: SegmentType.SPOT_FEED,
      member: '阿岭',
      happened_at: '2026-10-03T03:00:00.000Z',
      payload: { spot_id: 'spot-market', new_price: 150 },
    });

    const firstBatch = openBatch(
      DEMO_TRIP_ID,
      '第一批：下山途中回传（在景点反馈段前中断）',
      [budgetEvent, addMember, leaderItem, mateItem, museumItem, marketItem],
    );
    commitBatch(firstBatch.id, {
      interruptBeforeSegmentIndex: SEGMENT_ORDER.indexOf(SegmentType.SPOT_FEED),
    });

    const secondBatch = openBatch(DEMO_TRIP_ID, '第二批：补传景点价格反馈', [priceEvent]);
    commitBatch(secondBatch.id);

    syncApi.markSeeded();
    persist();
  }

  function resetDemo() {
    const empty = emptySyncState();
    events.value = empty.events;
    batches.value = empty.batches;
    snapshots.value = empty.snapshots;
    headVersion.value = empty.head_version;
    spotOverrides.value = empty.spotOverrides;
    syncApi.save(empty);
    syncApi.clearSeeded();
    persist();
  }

  return {
    events,
    batches,
    snapshots,
    head_version: headVersion,
    spotOverrides,
    committedEventIds,
    appliedEvents,
    currentProjection,
    persist,
    eventById,
    batchEvents,
    logEvent,
    openBatch,
    commitBatch,
    resumeBatch,
    replayBatch,
    rebuildSnapshot,
    chooseVariant,
    confirmInvalidation,
    snapshotVersion,
    variantFor,
    seedDemoIfEmpty,
    resetDemo,
  };
});
