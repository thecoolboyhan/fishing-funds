import request from '@/utils/request';
import * as CoinService from '@/services/coin';

// 现价看板数据源聚合（2026-11-16）
// 需求：把「货币」tab 从加密币自选列表改为只看现价的看板 —— 美元兑人民币、比特币、
// 金/银/铜/铁、主要贵金属。
// 数据源选型（均已实测可用）：
//   1. 新浪外盘 hf_*：伦敦金/银、纽约铂/钯、伦铜/锌/镍/锡，美元计价；
//   2. 新浪内盘 nf_*：沪金/沪银/沪铜、大商所铁矿石，人民币计价；
//   3. 新浪外汇 fx_s*：在岸/离岸美元兑人民币；
//   4. CoinGecko simple/price：BTC/ETH（复用 coin.ts，与货币原模块同域）。
// 新浪接口三要点，与 fund.ts 的 FromSina 保持一致：
//   必须带 Referer（否则 403）；返回 GBK 编码（arraybuffer + TextDecoder('gbk')）；
//   一次可请求多个代码，返回多行 `var hq_str_xxx="...";`。

const SINA_HEADERS = { Referer: 'https://finance.sina.com.cn' };

/** 金衡盎司 → 克 */
const OUNCE_IN_GRAM = 31.1034768;

type SinaRow = string[];

interface Spec {
  code: string;
  name: string;
  category: Price.Category;
  market: string;
  unit: string;
  /** 价格小数位 */
  digits: number;
  /** 组内排序权重 */
  sort: number;
  /** 美元计价的折人民币方式（仅外盘适用） */
  cny?: 'gram' | 'ton';
}

const FX_SPEC: Spec[] = [
  { code: 'fx_susdcny', name: '美元/人民币', category: 'currency', market: '在岸', unit: 'CNY', digits: 4, sort: 1 },
  { code: 'fx_susdcnh', name: '美元/离岸人民币', category: 'currency', market: '离岸', unit: 'CNH', digits: 4, sort: 2 },
];

// 外盘：字段序（实测核对）0=现价 1=买价 2=卖价 3=结算 4=最高 5=最低 6=时间 7=昨收 8=开盘 12=日期 13=名称
const HF_SPEC: Spec[] = [
  { code: 'hf_XAU', name: '伦敦金', category: 'precious', market: '伦敦', unit: '美元/盎司', digits: 2, sort: 1, cny: 'gram' },
  { code: 'hf_XAG', name: '伦敦银', category: 'precious', market: '伦敦', unit: '美元/盎司', digits: 2, sort: 2, cny: 'gram' },
  { code: 'hf_XPT', name: '铂金', category: 'precious', market: '纽约', unit: '美元/盎司', digits: 2, sort: 3, cny: 'gram' },
  { code: 'hf_XPD', name: '钯金', category: 'precious', market: '纽约', unit: '美元/盎司', digits: 2, sort: 4, cny: 'gram' },
  { code: 'hf_CAD', name: '伦铜', category: 'base', market: '伦敦', unit: '美元/吨', digits: 1, sort: 1, cny: 'ton' },
  { code: 'hf_ZSD', name: '伦锌', category: 'base', market: '伦敦', unit: '美元/吨', digits: 1, sort: 2, cny: 'ton' },
  { code: 'hf_NID', name: '伦镍', category: 'base', market: '伦敦', unit: '美元/吨', digits: 1, sort: 3, cny: 'ton' },
  { code: 'hf_SND', name: '伦锡', category: 'base', market: '伦敦', unit: '美元/吨', digits: 1, sort: 4, cny: 'ton' },
];

// 内盘：字段序（实测核对）0=名称 1=时间HHMMSS 2=开盘 3=最高 4=最低 5=昨收 6=买 7=卖
// 8=最新价 9=结算 10=昨结算 13=持仓 14=成交 15=交易所 16=品种 17=日期
const NF_SPEC: Spec[] = [
  { code: 'nf_AU0', name: '沪金', category: 'precious', market: '上海', unit: '元/克', digits: 2, sort: 5 },
  { code: 'nf_AG0', name: '沪银', category: 'precious', market: '上海', unit: '元/千克', digits: 0, sort: 6 },
  { code: 'nf_CU0', name: '沪铜', category: 'base', market: '上海', unit: '元/吨', digits: 0, sort: 5 },
  { code: 'nf_I0', name: '铁矿石', category: 'base', market: '大连', unit: '元/吨', digits: 1, sort: 6 },
];

const CRYPTO_SPEC: { code: string; name: string; digits: number; sort: number }[] = [
  { code: 'bitcoin', name: '比特币 BTC', digits: 2, sort: 1 },
  { code: 'ethereum', name: '以太坊 ETH', digits: 2, sort: 2 },
];

function ToNumber(value?: string | number | null) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

/** MM-DD HH:mm */
function ToTimeText(date?: string, time?: string) {
  const d = (date || '').slice(5);
  const t = (time || '').slice(0, 5);
  return [d, t].filter((_) => _).join(' ');
}

/**
 * 新浪行情：一次请求多个代码，解析成 code -> 字段数组。
 * 空串代表该品种当前无行情（停牌/已下线，如实测 hf_PB），直接跳过而非保留脏数据。
 */
async function FetchSinaRows(codes: string[]): Promise<Record<string, SinaRow>> {
  const rows: Record<string, SinaRow> = {};
  try {
    const { body } = await request(`https://hq.sinajs.cn/list=${codes.join(',')}`, {
      responseType: 'arraybuffer',
      headers: SINA_HEADERS,
    });
    if (!body) return rows;
    const text = new TextDecoder('gbk').decode(new Uint8Array(body as unknown as ArrayBuffer));
    const pattern = /var\s+hq_str_([A-Za-z0-9_]+)\s*=\s*"([^"]*)"/g;
    let matched: RegExpExecArray | null;
    while ((matched = pattern.exec(text))) {
      const [, code, raw] = matched;
      if (!raw) continue;
      rows[code] = raw.split(',');
    }
  } catch (error) {}
  return rows;
}

function ParseHf(row: SinaRow, spec: Spec): Price.Item | null {
  const price = ToNumber(row[0]);
  if (!price) return null;
  const prevClose = ToNumber(row[7]);
  return {
    code: spec.code,
    name: spec.name,
    category: spec.category,
    market: spec.market,
    price,
    change: prevClose ? price - prevClose : 0,
    changePercent: prevClose ? ((price - prevClose) / prevClose) * 100 : 0,
    unit: spec.unit,
    digits: spec.digits,
    currency: 'USD',
    high: ToNumber(row[4]) || undefined,
    low: ToNumber(row[5]) || undefined,
    open: ToNumber(row[8]) || undefined,
    prevClose: prevClose || undefined,
    updateTime: ToTimeText(row[12], row[6]),
    sort: spec.sort,
  };
}

function ParseNf(row: SinaRow, spec: Spec): Price.Item | null {
  const price = ToNumber(row[8]);
  if (!price) return null;
  // 内盘涨跌基准用「昨结算」（商品期货口径），缺失时退回昨收
  const prevClose = ToNumber(row[10]) || ToNumber(row[5]);
  const rawTime = (row[1] || '').padStart(6, '0');
  return {
    code: spec.code,
    name: spec.name,
    category: spec.category,
    market: spec.market,
    price,
    change: prevClose ? price - prevClose : 0,
    changePercent: prevClose ? ((price - prevClose) / prevClose) * 100 : 0,
    unit: spec.unit,
    digits: spec.digits,
    currency: 'CNY',
    high: ToNumber(row[3]) || undefined,
    low: ToNumber(row[4]) || undefined,
    open: ToNumber(row[2]) || undefined,
    prevClose: prevClose || undefined,
    updateTime: ToTimeText(row[17], `${rawTime.slice(0, 2)}:${rawTime.slice(2, 4)}`),
    sort: spec.sort,
  };
}

function ParseFx(row: SinaRow, spec: Spec): Price.Item | null {
  const price = ToNumber(row[8]);
  if (!price) return null;
  // 外汇字段序（实测核对）：3=昨收 5=开盘 6=最高 7=最低 8=现价 10=涨跌幅% 11=涨跌额 17=日期
  // 新浪已直接给涨跌幅/额，不必自行推算（与 3 号位昨收互为校验）
  return {
    code: spec.code,
    name: spec.name,
    category: spec.category,
    market: spec.market,
    price,
    change: ToNumber(row[11]),
    changePercent: ToNumber(row[10]),
    unit: spec.unit,
    digits: spec.digits,
    currency: 'CNY',
    high: ToNumber(row[6]) || undefined,
    low: ToNumber(row[7]) || undefined,
    open: ToNumber(row[5]) || undefined,
    prevClose: ToNumber(row[3]) || undefined,
    updateTime: ToTimeText(row[17], row[0]),
    sort: spec.sort,
  };
}

async function GetCryptoItems(): Promise<Price.Item[]> {
  const list = await CoinService.FromCoingecko(
    CRYPTO_SPEC.map(({ code }) => code).join(','),
    'usd'
  );
  return CRYPTO_SPEC.map((spec) => {
    const found = list.find(({ code }) => code === spec.code);
    if (!found) return null;
    const price = ToNumber(found.price);
    if (!price) return null;
    return {
      code: spec.code,
      name: spec.name,
      category: 'crypto' as Price.Category,
      market: '数字',
      price,
      change: ToNumber(found.change24h) ? (price * ToNumber(found.change24h)) / 100 : 0,
      changePercent: ToNumber(found.change24h),
      unit: '美元',
      digits: spec.digits,
      currency: 'USD' as Price.Currency,
      updateTime: found.updateTime,
      sort: spec.sort,
    };
  }).filter((_): _ is Price.Item => !!_);
}

/** 需按「元/克」换算的外盘品种（由 HF_SPEC 的 cny 字段派生，加品种只改表） */
const GRAM_CODES = new Set(
  HF_SPEC.filter(({ cny }) => cny === 'gram').map(({ code }) => code)
);

/** 美元单位简写，用于副标题 */
const SHORT_UNIT: Record<string, string> = {
  '美元/盎司': '/盎司',
  '美元/吨': '/吨',
  '美元': '',
};

/**
 * 把美元计价品种换算成人民币计价：
 * - 金/银/铂/钯：美元/盎司 → 元/克（÷31.1034768）
 * - 铜/锌/镍/锡：美元/吨 → 元/吨
 * - BTC/ETH：美元 → 元，小数位归零（数值大，两位小数无意义）
 * 内盘与汇率本身已是人民币口径，跳过。拿不到汇率时整体跳过，保留美元原价。
 */
function ConvertToCny(items: Price.Item[], usdCny: number) {
  if (!usdCny) return;

  items.forEach((item) => {
    if (item.currency !== 'USD') return;

    const isGram = GRAM_CODES.has(item.code);
    let factor = usdCny;
    let unit = '元/吨';
    let digits = 0;

    if (isGram) {
      factor = usdCny / OUNCE_IN_GRAM;
      unit = '元/克';
      digits = 2;
    } else if (item.category === 'crypto') {
      unit = '元';
      digits = 0;
    }

    // 副标题必须先按旧口径生成，再改 digits/unit
    item.originText = `$${item.price.toFixed(item.digits)}${SHORT_UNIT[item.unit] ?? ''}`;
    const convert = (value?: number) => (value === undefined ? undefined : value * factor);

    item.price = item.price * factor;
    item.change = item.change * factor;
    item.high = convert(item.high);
    item.low = convert(item.low);
    item.open = convert(item.open);
    item.prevClose = convert(item.prevClose);
    item.unit = unit;
    item.digits = digits;
    item.currency = 'CNY';
  });
}

/**
 * 拉取全部现价。四组数据源并发，单组失败只影响该组（各 fetch 内部已吞异常返回空），
 * 不会让整个看板空白。
 */
export async function GetPrices(): Promise<Price.Item[]> {
  const [fxRows, hfRows, nfRows, cryptoItems] = await Promise.all([
    FetchSinaRows(FX_SPEC.map(({ code }) => code)),
    FetchSinaRows(HF_SPEC.map(({ code }) => code)),
    FetchSinaRows(NF_SPEC.map(({ code }) => code)),
    GetCryptoItems(),
  ]);

  const fxItems = FX_SPEC.map((spec) => (fxRows[spec.code] ? ParseFx(fxRows[spec.code], spec) : null)).filter(
    (_): _ is Price.Item => !!_
  );
  const hfItems = HF_SPEC.map((spec) => (hfRows[spec.code] ? ParseHf(hfRows[spec.code], spec) : null)).filter(
    (_): _ is Price.Item => !!_
  );
  const nfItems = NF_SPEC.map((spec) => (nfRows[spec.code] ? ParseNf(nfRows[spec.code], spec) : null)).filter(
    (_): _ is Price.Item => !!_
  );

  // 折算基准取在岸价；拿不到就跳过折算，保留美元原价，不影响主数据
  const usdCny = fxItems.find(({ code }) => code === 'fx_susdcny')?.price || 0;
  const items = [...fxItems, ...hfItems, ...nfItems, ...cryptoItems];
  ConvertToCny(items, usdCny);

  return items;
}

/** 按分类分组，组内按 sort 升序；空组不返回 */
export function GroupPrices(items: Price.Item[]) {
  const groups: { category: Price.Category; title: string; items: Price.Item[] }[] = [
    { category: 'currency', title: '汇率', items: [] },
    { category: 'precious', title: '贵金属', items: [] },
    { category: 'base', title: '工业金属', items: [] },
    { category: 'crypto', title: '数字货币', items: [] },
  ];
  groups.forEach((group) => {
    group.items = items.filter(({ category }) => category === group.category).sort((a, b) => a.sort - b.sort);
  });
  return groups.filter(({ items: groupItems }) => groupItems.length);
}
