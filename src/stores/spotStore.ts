import { defineStore } from 'pinia';
import type { Spot } from '../models/spot';
import { SpotCategory } from '../constants/spot';
import { spotApi } from '../api/spotApi';

export const useSpotStore = defineStore('spot', {
  state: () => ({ spots: spotApi.list() as Spot[], keyword: '', category: 'all' as SpotCategory | 'all', favorites: [] as string[] }),
  getters: {
    filteredSpots: (state) => state.spots.filter((spot) => {
      const matchKeyword = !state.keyword || spot.name.includes(state.keyword) || spot.tags.some((tag) => tag.includes(state.keyword));
      const matchCategory = state.category === 'all' || spot.category === state.category;
      return matchKeyword && matchCategory;
    }),
  },
  actions: {
    toggleFavorite(id: string) {
      this.favorites = this.favorites.includes(id) ? this.favorites.filter((item) => item !== id) : [...this.favorites, id];
    },
    /** 景点价格变化后更新目录价；历史合并快照自带 priceMap，旧结果金额不受影响 */
    updatePrice(id: string, price: number) {
      const spot = this.spots.find((item) => item.id === id);
      if (spot) {
        spot.price = price;
        spotApi.save(this.spots);
      }
    },
  },
});

