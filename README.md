# TripWeaver 旅游行程规划助手

## 快速启动

```bash
pnpm install
pnpm dev
```

访问地址：http://localhost:18417

逻辑自检（无需浏览器）：

```bash
pnpm test          # 归约逻辑用例 + Pinia store 端到端冒烟
pnpm test:logic    # 仅事件溯源/分段合并纯函数用例
pnpm test:smoke    # 仅 store 冒烟（localStorage 打桩）
```

## 离线分段合并设计（`/sync`）

面向「山区徒步队分头行动、回信号再合并」的离线协同场景，采用事件溯源（event sourcing）：

| 需求 | 实现 |
| --- | --- |
| 旅行计划/每日安排/景点拆成分段批次，不同段直接接上 | `SegmentType` 固定顺序（计划 → 每日安排 → 景点反馈），`orderEvents` 段间接续、段内按时刻排序 |
| 改动带成员、时刻和出发前版本 | `ChangeEvent` 的 `member` / `happened_at` / `base_version` |
| 同天同景点两人动过并列保留，队长选定前不计入预算/分享 | 同一 `base_version` 分叉生成 `PlanVariant`（多 `VariantOption`）；`project` 在 `CHOSEN` 前将其排除 |
| 基于更新版本的改动直接接续 | `base_version` 更高时旧分支被取代，不产生并列 |
| 批次中断后从上次完整结果继续 | `applyBatch` 在段边界中断，`processed_count` 记录完整段；已完整段立即固化快照 |
| 重放同批不能多出安排 | 已提交事件 id 去重；`digestOf` 稳定摘要，`replayBatch` 自检幂等 |
| 景点停业/价格变化后相关日期失效待确认 | `SPOT_CLOSED` / `SPOT_PRICE_CHANGED` 生成 `Invalidation`，确认前不计入；停业确认移出预算，价格确认按新价计入 |
| 旧结果仍可查看 | 每次完整合入生成不可变 `PlanSnapshot`，历史时间线可展开 |
| 队长选定/确认的在线裁决重放不乱序 | store 用单调逻辑时钟 `nextHappenedAt()`，保证裁决事件永远晚于被裁决事件 |

涉及文件：

```
src/
├── constants/sync.ts              # 分段/事件/批次/并列/失效枚举
├── models/sync.ts                 # ChangeEvent / ChangeBatch / PlanVariant / Invalidation / PlanSnapshot
├── api/syncApi.ts                 # 同步状态 localStorage 持久化
├── sync/
│   ├── reducer.ts                 # 事件归约、冲突并列、投影、快照、摘要（纯函数）
│   ├── engine.ts                  # 分段批次接入/中断恢复/重放去重（纯函数）
│   └── projection.ts              # 预算口径与分享文本（未选定/未确认一律排除）
├── stores/syncStore.ts            # setup store：记录事件、合批、裁决、确认、种子演示
├── components/common/
│   ├── BatchPanel.vue             # 批次段进度、继续、重放
│   ├── VariantPanel.vue           # 同天同景点并列项与队长选定
│   ├── InvalidationPanel.vue      # 停业/涨价失效列表与队长确认
│   └── HistoryTimeline.vue        # 历史结果快照
└── pages/SyncCenter.vue           # /sync 离线合并中心
scripts/
├── sync-logic.test.ts             # 9 组归约逻辑用例
├── sync-store.smoke.ts            # store 端到端冒烟
└── run-sync-tests.mjs             # 用 esbuild 打包后在 node 运行
```

TripWeaver 是一款纯前端旅行规划应用，支持创建旅行、探索景点、编排每日行程、预算统计和分享预览。

## 主要功能

- 我的旅行：创建、筛选、删除旅行计划。
- 行程详情：查看每日行程、预算图表和共享时间线。
- 景点探索：按 SpotCategory 搜索和筛选，收藏并加入行程。
- 行程编排：SortableJS 拖拽排序，实时影响预算计算。
- 分享预览：生成可复制的行程文本。
- **离线分段合并（`/sync`）**：徒步队分头行动离线改同一行程时，把「旅行计划 / 每日安排 / 景点反馈」拆成分段批次逐段接入；每条改动带成员、时刻和出发前版本；同一天同一景点被两人动过则并列保留，队长选定前不计入预算和分享；批次中断后从上次完整结果继续，重放同批不多出安排；景点停业或价格变化后相关日期失效待确认，旧结果快照仍可查看。

## 技术栈

| 分类 | 技术 |
| --- | --- |
| 前端 | Vue 3 + TypeScript |
| 构建 | Vite |
| UI | Element Plus + ECharts |
| 状态 | Pinia |
| 路由 | Vue Router 4 |
| 持久化 | localStorage + Dexie.js |
| 交互 | sortablejs |

## 目录结构

```
src/
├── api/
├── stores/
├── models/
├── types/
├── components/common/
├── hooks/
├── pages/
├── router/
├── utils/
├── config/
└── constants/
```

## 数据持久化

本地数据通过 `utils/storage.ts` 统一写入 localStorage，并保留 Dexie 数据库对象用于后续 IndexedDB 扩展。版本键来自 `constants/storageVersion.ts`。

## 环境变量

`VITE_AMAP_KEY`：高德地图 key。未配置时使用 demo-key，地图主题配置同时出现在 `config/map.ts`、`SpotCard`、`DayTimeline`、`Planner` 相关逻辑中。

## 枚举出现位置清单

SpotCategory：
- `src/constants/spot.ts`
- `src/models/spot.ts`
- `src/stores/spotStore.ts`
- `src/components/common/CategoryFilter.vue`
- `src/components/common/SpotCard.vue`
- `src/pages/Spots.vue`
- `src/pages/TripDetail.vue`
- `src/utils/formatters.ts`
- `src/router/guards.ts`

TripStatus：
- `src/constants/trip.ts`
- `src/models/trip.ts`
- `src/stores/tripStore.ts`
- `src/components/common/TripCard.vue`
- `src/pages/Trips.vue`
- `src/utils/formatters.ts`
- `src/router/guards.ts`

## License

MIT

