import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface PriceState {
  items: Price.Item[];
  loading: boolean;
  /** 最近一次成功刷新时间 MM-DD HH:mm:ss */
  updateTime: string;
  /** 上一轮是否整板无数据（用于空态提示区分「加载中」与「取数失败」） */
  empty: boolean;
}

const initialState: PriceState = {
  items: [],
  loading: false,
  updateTime: '',
  empty: true,
};

const priceSlice = createSlice({
  name: 'price',
  initialState,
  reducers: {
    setPricesLoadingAction(state, action: PayloadAction<boolean>) {
      state.loading = action.payload;
    },
    syncPricesAction(state, action: PayloadAction<{ items: Price.Item[]; updateTime: string }>) {
      state.items = action.payload.items;
      state.updateTime = action.payload.updateTime;
      state.empty = !action.payload.items.length;
    },
  },
});

export const { setPricesLoadingAction, syncPricesAction } = priceSlice.actions;

export default priceSlice.reducer;
