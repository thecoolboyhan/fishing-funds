import { createListenerMiddleware } from '@reduxjs/toolkit';
import { StoreState, AppDispatch } from '@/store';
import startListeningConfig from '@/store/listeners/config.listener';
import startListeningState from '@/store/listeners/state.listener';
import startListeningCache from '@/store/listeners/cache.listener';
import startListeningShare from '@/store/listeners/share.listener';
import startListeningSync from '@/store/listeners/sync.listener';

const listenerMiddleware = createListenerMiddleware<StoreState, AppDispatch>();

// 幂等：允许多处调用（应用启动早期 + 各页面 mount），只真正注册一次，
// 避免重复注册导致同一次 dispatch 触发多遍落盘写入。
let started = false;

export function startListening() {
  if (started) return;
  started = true;
  startListeningConfig();
  startListeningState();
  startListeningCache();
  startListeningShare();
  startListeningSync();
}

export default listenerMiddleware;
