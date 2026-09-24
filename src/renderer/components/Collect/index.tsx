import React from 'react';

export interface CollectProps {
  title: string;
}

/**
 * 上游原实现会渲染一个 display:none 的 <webview>，把用户当前浏览的页面路径
 * 上报给 https://ff.1zilc.top/collect（上游的采集服务）。
 *
 * 本仓库是独立维护版，且对外承诺「不含任何第三方统计 SDK、不收集不上传数据」，
 * 因此这里**保留组件壳**（多处页面仍有 import，直接删文件会让构建失败），
 * 但不再渲染任何内容、也不发起任何网络请求。
 */
const Collect: React.FC<CollectProps> = () => {
  return null;
};
export default Collect;
