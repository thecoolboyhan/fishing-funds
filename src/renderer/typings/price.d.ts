declare namespace Price {
  /** 现价看板分类（2026-11-19 增 black/energy/agri） */
  export type Category = 'currency' | 'precious' | 'base' | 'black' | 'energy' | 'agri' | 'crypto';

  /** 计价币种 */
  export type Currency = 'USD' | 'CNY';

  /** 统一口径：g=元/克、kg=元/千克、bbl=元/桶、cny=元、usd=美元（不折人民币，如 BTC） */
  export type TargetUnit = 'g' | 'kg' | 'bbl' | 'cny' | 'usd';

  /** 历史走势点（time 为毫秒时间戳，price 已按统一口径折人民币） */
  export interface HistoryPoint {
    time: number;
    price: number;
  }

  export interface HistoryResult {
    prices: HistoryPoint[];
    /** 图表 Y 轴单位文案，如「元/克」 */
    unit: string;
  }

  /**
   * 统一行情条目。
   * 外汇/外盘（美元计价）与内盘（人民币计价）字段口径一致，
   * 差异只体现在 currency 与 unit 文案上，UI 无需分支。
   */
  export interface Item {
    /** 唯一键，如 fx_susdcny / hf_XAU / nf_AU0 / bitcoin */
    code: string;
    name: string;
    category: Category;
    /** 市场归属：在岸 / 离岸 / 伦敦 / 纽约 / 上海 / 大连 / 数字 */
    market: string;
    price: number;
    change: number;
    changePercent: number;
    /** 原始单位文案，如「美元/盎司」「元/克」 */
    unit: string;
    /** 价格保留小数位，由数据源品种决定（汇率 4 位、元/吨 0 位） */
    digits: number;
    currency: Currency;
    high?: number;
    low?: number;
    open?: number;
    prevClose?: number;
    /** 振幅 % =（高 − 低）/ 昨收 × 100，由 SelectFromParsed 统一计算 */
    amplitude?: number;
    /** MM-DD HH:mm */
    updateTime: string;
    /** 原始美元报价文案，人民币化后作副标题，如「$3885.65 美元/盎司」 */
    originText?: string;
    /** 组内排序权重，小的在前 */
    sort: number;
  }
}
