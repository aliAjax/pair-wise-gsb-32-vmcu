import { createRouter, createWebHistory } from 'vue-router';
import Trips from '../pages/Trips.vue';
import TripDetail from '../pages/TripDetail.vue';
import Spots from '../pages/Spots.vue';
import Planner from '../pages/Planner.vue';
import Share from '../pages/Share.vue';
import SyncCenter from '../pages/SyncCenter.vue';
import { installGuards } from './guards';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/trips' },
    { path: '/trips', component: Trips },
    { path: '/trip/:id', component: TripDetail },
    { path: '/spots', component: Spots },
    { path: '/planner/:tripId/:dayIndex', component: Planner },
    { path: '/share/:tripId?', component: Share, meta: { title: '分享预览' } },
    // 离线分段批次合并台：冲突选定、中断续传、景点变化登记、历史快照
    { path: '/sync/:tripId?', component: SyncCenter, meta: { title: '离线合并' } },
  ],
});
installGuards(router);
export default router;
