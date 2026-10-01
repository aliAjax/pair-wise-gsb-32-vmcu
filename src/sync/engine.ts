import { BatchState, SEGMENT_ORDER } from '../constants/sync';
import type { ChangeBatch, ChangeEvent } from '../models/sync';

/** 一次分段接入的结果 */
export interface ApplyResult {
  batch: ChangeBatch;
  /** 本次真正新合入的事件（重放同批时为空，保证不多出安排） */
  newlyApplied: ChangeEvent[];
  /** 已经在历史结果里的事件 id，重放时直接跳过 */
  duplicates: string[];
  /** 是否在某个段边界被打断；打断后 processed_count 停在已完整段 */
  interrupted: boolean;
  snapshotCreated: boolean;
}

export interface ApplyOptions {
  /** 在处理到该段（按 SEGMENT_ORDER 的下标）之前模拟信号中断；不传表示一路合完 */
  interruptBeforeSegmentIndex?: number;
  now?: () => string;
}

/**
 * 从上次完整结果继续：按段顺序逐段接入。
 * - 已经 APPLIED 的批次重放：newlyApplied 必为空；
 * - INTERRUPTED 的批次：processed_count 指向最后一个完整段，从下一段继续；
 * - 断点设在“段边界”，因此每一段要么完整接入，要么完全不接入。
 */
export function applyBatch(
  batch: ChangeBatch,
  events: ChangeEvent[],
  committedEventIds: ReadonlySet<string>,
  options: ApplyOptions = {},
): ApplyResult {
  if (batch.state === BatchState.APPLIED) {
    return { batch, newlyApplied: [], duplicates: [...batch.event_ids], interrupted: false, snapshotCreated: false };
  }

  const now = options.now ?? (() => new Date().toISOString());
  const working: ChangeBatch = { ...batch, state: BatchState.PROCESSING };
  const batchEvents = new Map(events.map((e) => [e.id, e]));
  const committed = new Set(committedEventIds);
  const newlyApplied: ChangeEvent[] = [];
  const duplicates: string[] = [];
  let interrupted = false;

  for (let index = working.processed_count; index < SEGMENT_ORDER.length; index += 1) {
    if (options.interruptBeforeSegmentIndex === index) {
      interrupted = true;
      break;
    }
    const segment = SEGMENT_ORDER[index];
    // 段内仍按规范顺序（时刻）接入，保证重放确定性
    const segmentEvents = batch.event_ids
      .map((id) => batchEvents.get(id))
      .filter((e): e is ChangeEvent => !!e && e.segment === segment)
      .sort((a, b) => a.happened_at.localeCompare(b.happened_at) || a.id.localeCompare(b.id));

    segmentEvents.forEach((event) => {
      if (committed.has(event.id)) {
        duplicates.push(event.id);
        return;
      }
      committed.add(event.id);
      newlyApplied.push(event);
    });
    working.processed_count = index + 1;
  }

  if (interrupted) {
    working.state = BatchState.INTERRUPTED;
  } else {
    working.state = BatchState.APPLIED;
    working.applied_at = now();
  }

  // 只有整批（三段都完整接入）合完，才落一份新的完整结果快照
  const snapshotCreated = working.state === BatchState.APPLIED;
  return { batch: working, newlyApplied, duplicates, interrupted, snapshotCreated };
}

/** 重放同批的自检：两次合入得到的已提交事件集合必须一致 */
export function replayProducesNoNewEvents(first: ApplyResult, replay: ApplyResult): boolean {
  return replay.newlyApplied.length === 0 && first.batch.id === replay.batch.id;
}
