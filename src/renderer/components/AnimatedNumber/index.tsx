import React, { useEffect, useRef } from 'react';

/**
 * 数字平滑滚动（2026-11-20）
 *
 * 数据刷新时数字从旧值补间到新值，而不是「啪」地跳一下 —— 这是 Material 动效里
 * 最容易感知、也最容易被忽视的一环。
 *
 * 实现要点：
 * 1. **不用 setState**：每帧 setState 会让 28 张现价卡片在 300ms 内重渲染 ~500 次。
 *    这里拿 ref 直接改 textContent，补间期间零 React 渲染。
 * 2. **首次不动画**：初始渲染直接显示目标值，否则从 0 滚上来会闪一下。
 * 3. **尊重 reduced-motion**：系统开了减少动态效果就直接跳到终值。
 * 4. **中途被打断**：新的 value 到来时从「当前显示值」继续补间，不回退到上一个目标值。
 */

const DURATION = 380;
const CUBIC_BEZIER_APPROX = (t: number) => 1 - Math.pow(1 - t, 3); // decelerate 近似

export interface AnimatedNumberProps {
  value: number;
  /** 小数位数 */
  digits?: number;
  /** 千分位分隔 */
  thousand?: boolean;
  className?: string;
  /** 自定义格式化（如加 + 号），优先级高于 digits/thousand */
  format?: (value: number) => string;
}

const AnimatedNumber: React.FC<AnimatedNumberProps> = ({ value, digits = 0, thousand = true, className, format }) => {
  const ref = useRef<HTMLSpanElement>(null);
  const displayedRef = useRef(value);
  const rafRef = useRef<number | null>(null);
  // format 常以内联箭头函数传入，每次 render 引用都变。放进 ref 后动画 effect 不再因
  // 父组件重渲染而误重启；动画帧读取的仍是最新 format（如 digits 依赖的闭包）。
  const formatRef = useRef(format);
  formatRef.current = format;

  // 首帧与动画帧共用同一格式化逻辑，避免 thousand=false / format 场景首帧闪一下不同格式
  const formatValue = (v: number) => {
    const fmt = formatRef.current;
    if (fmt) return fmt(v);
    if (!thousand) return v.toFixed(digits);
    return v.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  };

  const render = (v: number) => {
    const node = ref.current;
    if (!node) return;
    node.textContent = formatValue(v);
  };

  useEffect(() => {
    const from = displayedRef.current;
    if (from === value) {
      render(value);
      return;
    }

    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (reduce || !Number.isFinite(value) || !Number.isFinite(from)) {
      displayedRef.current = value;
      render(value);
      return;
    }

    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min((now - start) / DURATION, 1);
      const current = from + (value - from) * CUBIC_BEZIER_APPROX(progress);
      displayedRef.current = current;
      render(current);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        displayedRef.current = value;
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
    // format 走 ref，内联函数引用变化不再触发重启动画
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, digits, thousand]);

  // 首帧用目标值，避免从 0 滚上来（格式与动画帧一致）
  return <span ref={ref} className={className}>{formatValue(value)}</span>;
};

export default AnimatedNumber;
