import React from 'react';
import clsx from 'clsx';
import { Tabs } from 'antd';

import CustomDrawerContent from '@/components/CustomDrawer/Content';
import AnimatedNumber from '@/components/AnimatedNumber';
import Recent from '@/components/Home/NewsList/Recent';
import Trend from '@/components/Home/CoinView/DetailPriceContent/Trend';
import { useAppSelector } from '@/utils/hooks';
import * as Services from '@/services';
import * as Utils from '@/utils';
import styles from './index.module.css';

export interface DetailPriceProps {
  item: Price.Item;
}

export interface DetailPriceContentProps extends DetailPriceProps {
  onEnter: () => void;
  onClose: () => void;
}

/** 各品种对应的新闻搜索词（东方财富资讯搜索），避免拿「伦铜」等代码搜不到内容 */
const NEWS_KEYWORD_BY_CODE: Record<string, string> = {
  fx_susdcny: '人民币汇率',
  fx_susdcnh: '人民币汇率',
  hf_XAU: '黄金',
  hf_XAG: '白银',
  hf_XPT: '铂金',
  hf_XPD: '钯金',
  hf_CAD: '伦铜',
  hf_ZSD: '伦锌',
  hf_NID: '伦镍',
  hf_SND: '伦锡',
  nf_AU0: '黄金',
  nf_AG0: '白银',
  nf_CU0: '沪铜',
  nf_I0: '铁矿石',
  nf_AL0: '沪铝',
  nf_ZN0: '沪锌',
  nf_NI0: '沪镍',
  nf_PB0: '沪铅',
  nf_RB0: '螺纹钢',
  nf_JM0: '焦煤',
  nf_SC0: '原油',
  nf_LH0: '生猪',
  nf_C0: '玉米',
  nf_A0: '大豆',
  hf_CL: '原油',
  hf_OIL: '原油',
  // 东方财富对「比特币」全文检索返回 0，用 BTC 才有结果（实测 60 条）
  bitcoin: 'BTC',
  ethereum: '以太坊',
};

const formatValue = (value: number, digits: number) =>
  value.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });

const formatSigned = (value: number, digits: number) => {
  const text = formatValue(Math.abs(value), digits);
  return value > 0 ? `+${text}` : value < 0 ? `-${text}` : text;
};

/** 现价详情：所有条目共用，展示统一人民币口径的历史日线与相关资讯 */
export const DetailPrice: React.FC<DetailPriceProps> = ({ item }) => {
  const color = Utils.GetValueColor(item.changePercent);
  const items = useAppSelector((state) => state.price.items);
  // 内外盘配对品种（沪金 vs 伦敦金等），无配对时为 null
  const spread = Services.Price.GetSpread(item.code, items);
  const spreadColor = spread ? Utils.GetValueColor(spread.percent) : null;

  return (
    <div className={clsx(styles.content, 'md-scale-in')}>
      <div className={clsx(styles.summary, color.bgClass)}>
        <div className={styles.titleRow}>
          <span className={styles.name}>{item.name}</span>
          <span className={styles.market}>{item.market}</span>
        </div>
        <div className={clsx(styles.price, color.textClass)}>
          <AnimatedNumber value={item.price} digits={item.digits} /> <small>{item.unit}</small>
        </div>
        <div className={styles.meta}>
          <AnimatedNumber className={color.textClass} value={item.changePercent} format={(v) => `${formatSigned(v, 2)}%`} />
          <AnimatedNumber className={color.textClass} value={item.change} format={(v) => formatSigned(v, item.digits)} />
          <span>{item.originText}</span>
        </div>
        {/* 2026-11-19：开高低昨收此前取到了但没展示，这里补齐日线全貌 */}
        <div className={styles.quote}>
          {(
            [
              ['开盘', item.open],
              ['最高', item.high],
              ['最低', item.low],
              ['昨收', item.prevClose],
            ] as [string, number | undefined][]
          ).map(([label, value]) => (
            <div key={label} className={styles.quoteItem}>
              <span className={styles.quoteLabel}>{label}</span>
              <span className={styles.quoteValue}>{value === undefined ? '--' : formatValue(value, item.digits)}</span>
            </div>
          ))}
          <div className={styles.quoteItem}>
            <span className={styles.quoteLabel}>振幅</span>
            <span className={styles.quoteValue}>
              {item.amplitude === undefined ? '--' : `${item.amplitude.toFixed(2)}%`}
            </span>
          </div>
        </div>
        {/* 内外盘价差：同一标的两个市场的溢价，两边均已折人民币同口径 */}
        {spread && spreadColor && (
          <div className={styles.spread}>
            <span className={styles.spreadLabel}>{spread.label}</span>
            {spread.note && <span className={styles.spreadNote}>{spread.note}</span>}
            <span className={clsx(styles.spreadValue, spreadColor.textClass)}>
              {formatSigned(spread.percent, 2)}%
            </span>
            <span className={styles.spreadPeer}>
              {spread.peer.name} {formatValue(spread.peer.price, spread.peer.digits)}
            </span>
          </div>
        )}
        <div className={styles.time}>更新：{item.updateTime || '--'}</div>
      </div>
      <Tabs
        animated={{ tabPane: true }}
        tabBarGutter={12}
        items={[
          { key: 'history', label: '历史走势', children: <Trend code={item.code} /> },
          {
            key: 'news',
            label: '相关资讯',
            children: <Recent keyword={NEWS_KEYWORD_BY_CODE[item.code] || item.name} />,
          },
        ]}
      />
    </div>
  );
};

const DetailPriceContent: React.FC<DetailPriceContentProps> = (props) => (
  <CustomDrawerContent title="现价详情" enterText="关闭" onEnter={props.onClose} onClose={props.onClose}>
    <DetailPrice item={props.item} />
  </CustomDrawerContent>
);

export default DetailPriceContent;
