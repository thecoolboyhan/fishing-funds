/**
 * CSS 变量白名单 —— GetVariblesColor() 会逐个 getComputedStyle 读值。
 * ★ 键必须是 ThemeProvider 里真实声明的变量名（读不到会返回空串，进而让涨跌色失效）。
 * 2026-11-19：修掉 --base-font-size 映射到 '--base-font-color' 的笔误，补齐此前漏登记的 7 个变量。
 */
export default {
  '--background-color': '--background-color',
  '--primary-color': '--primary-color',
  '--increase-color': '--increase-color',
  '--increase-bg-color': '--increase-bg-color',
  '--reduce-color': '--reduce-color',
  '--reduce-bg-color': '--reduce-bg-color',
  '--cancel-color': '--cancel-color',
  '--cancel-text-color': '--cancel-text-color',
  '--main-text-color': '--main-text-color',
  '--secondary-main-text-color': '--secondary-main-text-color',
  '--reverse-text-color': '--reverse-text-color',
  '--border-color': '--border-color',
  '--inner-color': '--inner-color',
  '--inner-text-color': '--inner-text-color',
  '--hover-color': '--hover-color',
  '--selected-color': '--selected-color',
  '--alipay-color': '--alipay-color',
  '--wechat-color': '--wechat-color',
  '--svg-icon-color': '--svg-icon-color',
  '--blur-color': '--blur-color',
  '--tag-text-color': '--tag-text-color',
  '--warn-color': '--warn-color',
  '--warn-bg-color': '--warn-bg-color',
  '--block-border-color': '--block-border-color',
  '--base-font-size': '--base-font-size',
  '--base-padding': '--base-padding',
  '--base-radius': '--base-radius',
};
