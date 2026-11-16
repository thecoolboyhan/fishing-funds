import React from 'react';
import clsx from 'clsx';
import Empty from '@/components/Empty';
import LoadingBar from '@/components/LoadingBar';
import { useAppSelector } from '@/utils/hooks';
import * as Services from '@/services';
import * as Utils from '@/utils';
import styles from './index.module.css';

/**
 * 现价看板（原「货币」tab）
 * 2026-11-16 改造：由加密币自选列表改为只看现价 —— 汇率 / 贵金属 / 工业金属 / 数字货币。
 * 数据来源见 services/price.ts（新浪外盘 + 内盘 + 外汇、CoinGecko）。
 */

interface PriceViewProps {
  /** 分类筛选，默认全部；可传多个分类 */
  category?: Price.Category | 'all' | Price.Category[];
}

/** 千分位 + 固定小数位（沪铜 103,890 / 汇率 6.6711） */
const formatValue = (value: number, digits: number) =>
  value.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** 带正负号的数值，负数用真减号，避免「-1,150」和「+-」混排 */
const formatSigned = (value: number, digits: number) => {
  const text = formatValue(Math.abs(value), digits);
  return value > 0 ? `+${text}` : value < 0 ? `-${text}` : text;
};

const PriceCard: React.FC<{ item: Price.Item }> = ({ item }) => {
  const color = Utils.GetValueColor(item.changePercent);

  return (
    <div className={clsx(styles.card, color.bgClass)}>
      <div className={styles.cardHead}>
        <span className={styles.cardName}>{item.name}</span>
        <span className={styles.cardMarket}>{item.market}</span>
      </div>
      <div className={clsx(styles.cardPrice, color.textClass)}>{formatValue(item.price, item.digits)}</div>
      <div className={styles.cardChange}>
        <span className={color.textClass}>{formatSigned(item.changePercent, 2)}%</span>
        <span className={color.textClass}>{formatSigned(item.change, item.digits)}</span>
      </div>
      <div className={styles.cardFooter}>
        <span>{item.unit}</span>
        {item.originText && <span className={styles.cardOrigin}>{item.originText}</span>}
      </div>
      <div className={styles.cardTime}>{item.updateTime}</div>
    </div>
  );
};

const PriceView: React.FC<PriceViewProps> = (props) => {
  const { category = 'all' } = props;
  const items = useAppSelector((state) => state.price.items);
  const loading = useAppSelector((state) => state.price.loading);

  const groups = Services.Price.GroupPrices(items).filter(({ category: groupCategory }) => {
    if (category === 'all') return true;
    return Array.isArray(category) ? category.includes(groupCategory) : category === groupCategory;
  });

  return (
    <div className={styles.container}>
      <LoadingBar show={loading} />
      {groups.length ? (
        <div className={styles.groups}>
          {groups.map((group) => (
            <section key={group.category} className={styles.group}>
              <div className={styles.groupTitle}>
                <span>{group.title}</span>
                <span className={styles.groupCount}>{group.items.length}</span>
              </div>
              <div className={styles.grid}>
                {group.items.map((item) => (
                  <PriceCard key={item.code} item={item} />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <Empty text={loading ? '正在获取行情...' : '暂无行情数据，点击刷新重试'} />
      )}
    </div>
  );
};

export default PriceView;
