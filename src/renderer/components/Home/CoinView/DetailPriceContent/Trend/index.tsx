import React, { useState } from 'react';
import dayjs from 'dayjs';
import { useRequest } from 'ahooks';

import TypeSelection from '@/components/TypeSelection';
import ChartCard from '@/components/Card/ChartCard';
import { useResizeEchart, useRenderEcharts } from '@/utils/hooks';
import * as CONST from '@/constants';
import * as Services from '@/services';
import styles from './index.module.css';

export interface PriceTrendProps {
  code: string;
}

const dateTypeList = [
  { name: '1月', type: 1, code: '30' },
  { name: '3月', type: 2, code: '90' },
  { name: '半年', type: 3, code: '180' },
  { name: '1年', type: 4, code: '365' },
  { name: '最大', type: 5, code: 'max' },
];

/** 现价条目历史日线：数据源见 services/price.ts，已统一折人民币 */
const Trend: React.FC<PriceTrendProps> = ({ code }) => {
  const { ref: chartRef, chartInstance } = useResizeEchart(CONST.DEFAULT.ECHARTS_SCALE);
  const [date, setDateType] = useState(dateTypeList[0]);
  const { data = { prices: [], unit: '元' }, loading, run } = useRequest(
    () => Services.Price.GetPriceHistory(code, date.code),
    { refreshDeps: [code, date.code], ready: !!chartInstance }
  );

  useRenderEcharts(
    () => {
      chartInstance?.setOption(
        {
          tooltip: {
            trigger: 'axis',
            formatter: (params: any) => {
              const point = params?.[0];
              if (!point) return '';
              const [time, price] = point.value;
              return `${dayjs(time).format('YYYY-MM-DD')}<br/>${data.unit} ${Number(price).toLocaleString('zh-CN', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}`;
            },
          },
          grid: { left: 8, right: 12, top: 16, bottom: 6, containLabel: true },
          xAxis: {
            type: 'time',
            boundaryGap: false,
            axisLabel: { fontSize: 10, color: 'var(--secondary-main-text-color)' },
            axisLine: { lineStyle: { color: 'var(--border-color)' } },
          },
          yAxis: {
            type: 'value',
            scale: true,
            name: data.unit,
            nameTextStyle: { fontSize: 10, color: 'var(--secondary-main-text-color)' },
            axisLabel: { fontSize: 10, color: 'var(--secondary-main-text-color)' },
            splitLine: { lineStyle: { color: 'var(--border-color)' } },
          },
          series: [
            {
              name: data.unit,
              type: 'line',
              data: data.prices.map(({ time, price }) => [time, price]),
              showSymbol: false,
              smooth: true,
              lineStyle: { color: 'var(--primary-color)', width: 2 },
              areaStyle: { color: 'var(--primary-color)', opacity: 0.08 },
              markPoint: {
                symbol: 'pin',
                symbolSize: 28,
                label: { fontSize: 9 },
                data: [
                  { type: 'max', name: '最高' },
                  { type: 'min', name: '最低' },
                ],
              },
            },
          ],
        },
        true
      );
    },
    chartInstance,
    [data]
  );

  return (
    <ChartCard
      onFresh={run}
      describe="美元计价品种按当日美元兑人民币汇率折算；黄金白银为元/克，其余金属为元/千克"
      TitleBar={<span className={styles.title}>日线 · {data.unit}</span>}
    >
      <div className={styles.content}>
        <div ref={chartRef} style={{ width: '100%' }} />
        {!loading && !data.prices.length && <div className={styles.empty}>暂无历史数据，点击右上角刷新重试</div>}
        <TypeSelection types={dateTypeList} activeType={date.type} onSelected={setDateType} flex />
      </div>
    </ChartCard>
  );
};

export default Trend;
