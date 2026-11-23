import dayjs from 'dayjs';
import request from '@/utils/request';
import * as CoinService from '@/services/coin';

// 现价看板数据源聚合（2026-11-16）
// 需求：把「货币」tab 从加密币自选列表改为只看现价的看板 —— 美元兑人民币、比特币、
// 金/银/铜/铁、主要贵金属。
// 数据源选型（均已实测可用）：
//   1. 新浪外盘 hf_*：伦敦金/银、纽约铂/钯、伦铜/锌/镍/锡，美元计价；
//   2. 新浪内盘 nf_*：沪金/沪银/沪铜、大商所铁矿石，人民币计价；
//   3. 新浪外汇 fx_s*：在岸/离岸美元兑人民币；
//   4. Gate.io spot/candlesticks：BTC + ETH（BTC 2026-11-23 从新浪迁入——新浪指数时间戳会
//      冻结且涨跌幅口径不准；Gate 直给涨跌幅/24h 高低，含历史 K 线）；
//   5. 新浪加密 btc_btcbtcusd：BTC 兜底（Gate 失败时）；
//   6. CoinGecko：仅作加密币最后兜底。
// 计价口径（2026-11-18）：全部折人民币；黄金/白银=元/克，其余金属=元/千克，
// 汇率/数字币=元。历史走势按同口径换算（美元品种逐日套当日美元兑人民币中间价）。
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
  /** 统一口径：g=元/克（仅黄金白银）、kg=元/千克（其余金属）、cny=元（数字币）；汇率不折算 */
  target?: Price.TargetUnit;
}

const FX_SPEC: Spec[] = [
  { code: 'fx_susdcny', name: '美元/人民币', category: 'currency', market: '在岸', unit: 'CNY', digits: 4, sort: 1 },
  { code: 'fx_susdcnh', name: '美元/离岸人民币', category: 'currency', market: '离岸', unit: 'CNH', digits: 4, sort: 2 },
];

// 外盘：字段序（实测核对）0=现价 1=买价 2=卖价 3=结算 4=最高 5=最低 6=时间 7=昨收 8=开盘 12=日期 13=名称
const HF_SPEC: Spec[] = [
  { code: 'hf_XAU', name: '伦敦金', category: 'precious', market: '伦敦', unit: '美元/盎司', digits: 2, sort: 1, target: 'g' },
  { code: 'hf_XAG', name: '伦敦银', category: 'precious', market: '伦敦', unit: '美元/盎司', digits: 2, sort: 2, target: 'g' },
  { code: 'hf_XPT', name: '铂金', category: 'precious', market: '纽约', unit: '美元/盎司', digits: 2, sort: 3, target: 'kg' },
  { code: 'hf_XPD', name: '钯金', category: 'precious', market: '纽约', unit: '美元/盎司', digits: 2, sort: 4, target: 'kg' },
  { code: 'hf_CAD', name: '伦铜', category: 'base', market: '伦敦', unit: '美元/吨', digits: 1, sort: 1, target: 'kg' },
  { code: 'hf_ZSD', name: '伦锌', category: 'base', market: '伦敦', unit: '美元/吨', digits: 1, sort: 2, target: 'kg' },
  { code: 'hf_NID', name: '伦镍', category: 'base', market: '伦敦', unit: '美元/吨', digits: 1, sort: 3, target: 'kg' },
  { code: 'hf_SND', name: '伦锡', category: 'base', market: '伦敦', unit: '美元/吨', digits: 1, sort: 4, target: 'kg' },
  // 能源（2026-11-19）：WTI 与布伦特同属 hf_ 外盘字段序，桶计价不折体积只折汇率
  { code: 'hf_CL', name: 'WTI 原油', category: 'energy', market: '纽约', unit: '美元/桶', digits: 2, sort: 1, target: 'bbl' },
  { code: 'hf_OIL', name: '布伦特原油', category: 'energy', market: '伦敦', unit: '美元/桶', digits: 2, sort: 2, target: 'bbl' },
];

// 内盘：字段序（实测核对）0=名称 1=时间HHMMSS 2=开盘 3=最高 4=最低 5=昨收 6=买 7=卖
// 8=最新价 9=结算 10=昨结算 13=持仓 14=成交 15=交易所 16=品种 17=日期
const NF_SPEC: Spec[] = [
  { code: 'nf_AU0', name: '沪金', category: 'precious', market: '上海', unit: '元/克', digits: 2, sort: 5, target: 'g' },
  { code: 'nf_AG0', name: '沪银', category: 'precious', market: '上海', unit: '元/千克', digits: 0, sort: 6, target: 'g' },
  { code: 'nf_CU0', name: '沪铜', category: 'base', market: '上海', unit: '元/吨', digits: 0, sort: 5, target: 'kg' },
  // 内盘有色（2026-11-19）：与伦铜/锌/镍互补，同一字段序
  { code: 'nf_AL0', name: '沪铝', category: 'base', market: '上海', unit: '元/吨', digits: 0, sort: 6, target: 'kg' },
  { code: 'nf_ZN0', name: '沪锌', category: 'base', market: '上海', unit: '元/吨', digits: 0, sort: 7, target: 'kg' },
  { code: 'nf_NI0', name: '沪镍', category: 'base', market: '上海', unit: '元/吨', digits: 0, sort: 8, target: 'kg' },
  { code: 'nf_PB0', name: '沪铅', category: 'base', market: '上海', unit: '元/吨', digits: 0, sort: 9, target: 'kg' },
  // 黑色系（2026-11-19）：铁矿石从「工业金属」归位到黑色
  { code: 'nf_I0', name: '铁矿石', category: 'black', market: '大连', unit: '元/吨', digits: 1, sort: 1, target: 'kg' },
  { code: 'nf_RB0', name: '螺纹钢', category: 'black', market: '上海', unit: '元/吨', digits: 0, sort: 2, target: 'kg' },
  { code: 'nf_JM0', name: '焦煤', category: 'black', market: '大连', unit: '元/吨', digits: 1, sort: 3, target: 'kg' },
  // 能源（2026-11-19）：上海原油本身元/桶，只做口径标记不换算
  { code: 'nf_SC0', name: '上海原油', category: 'energy', market: '上海', unit: '元/桶', digits: 1, sort: 3, target: 'bbl' },
  // 农产品（2026-11-19）：元/吨 → 元/千克，与现货报价习惯（元/公斤）一致
  { code: 'nf_LH0', name: '生猪', category: 'agri', market: '大连', unit: '元/吨', digits: 0, sort: 1, target: 'kg' },
  { code: 'nf_C0', name: '玉米', category: 'agri', market: '大连', unit: '元/吨', digits: 0, sort: 2, target: 'kg' },
  { code: 'nf_A0', name: '豆一', category: 'agri', market: '大连', unit: '元/吨', digits: 0, sort: 3, target: 'kg' },
];

interface CryptoSpec {
  code: string;
  name: string;
  digits: number;
  sort: number;
  target: Price.TargetUnit;
}

const CRYPTO_SPEC: CryptoSpec[] = [
  // 2026-11-23 用户要求：BTC 保持美元计价（不折人民币），ETH 仍统一人民币
  { code: 'bitcoin', name: '比特币 BTC', digits: 2, sort: 1, target: 'usd' },
  { code: 'ethereum', name: '以太坊 ETH', digits: 2, sort: 2, target: 'cny' },
];

// 新浪加密代码 → 看板 code。仅作 BTC 兜底源（主源是 Gate.io）。
const SINA_CRYPTO_SPEC: { sinaCode: string; code: string }[] = [
  { sinaCode: 'btc_btcbtcusd', code: 'bitcoin' },
];

// Gate.io 交易对（USDT 近似美元口径）→ 看板 code。
// 2026-11-23：BTC 从新浪指数迁到 Gate.io —— 新浪 btc_btcbtcusd 时间戳会冻结（实测卡在
// 某分钟后现价不动），且 row[8] 并非 24h 前价，算出的涨跌方向与实际相反；Gate 直接给
// last/change_percentage/high_24h/low_24h，与 ETH 同一条可靠链路。新浪降为兜底。
const GATE_CRYPTO_SPEC: { pair: string; code: string }[] = [
  { pair: 'BTC_USDT', code: 'bitcoin' },
  { pair: 'ETH_USDT', code: 'ethereum' },
];

/** code → 统一计价口径（现价与历史共用，加品种只改上面的表） */
const TARGET_BY_CODE = new Map<string, Price.TargetUnit>();
[...FX_SPEC, ...HF_SPEC, ...NF_SPEC].forEach((spec) => spec.target && TARGET_BY_CODE.set(spec.code, spec.target));
CRYPTO_SPEC.forEach((spec) => TARGET_BY_CODE.set(spec.code, spec.target));

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

/**
 * 新浪 BTC 字段序（2026-11-18 实测核对，仅作 Gate 失败时的兜底）：
 * 0=时间 3=现价 6=最高 7=最低 8=24h 前价 10=24h 量(BTC) 11=日期 12=成交额(USD)
 * 注意：该接口时间戳会冻结、8 号位 pay 口径不准（2026-11-23 实测涨跌方向与 Gate 相反），
 * 故已降为兜底；主源 Gate.io 的 change_percentage 才可信。
 */
function ParseSinaCrypto(row: SinaRow, spec: CryptoSpec): Price.Item | null {
  const price = ToNumber(row[3]);
  if (!price) return null;
  const prevClose = ToNumber(row[8]);
  return {
    code: spec.code,
    name: spec.name,
    category: 'crypto',
    market: '数字',
    price,
    change: prevClose ? price - prevClose : 0,
    changePercent: prevClose ? ((price - prevClose) / prevClose) * 100 : 0,
    unit: '美元',
    digits: spec.digits,
    currency: 'USD',
    high: ToNumber(row[6]) || undefined,
    low: ToNumber(row[7]) || undefined,
    prevClose: prevClose || undefined,
    updateTime: ToTimeText(row[11], row[0]),
    sort: spec.sort,
  };
}

interface GateTicker {
  last: string;
  change_percentage: string;
  high_24h: string;
  low_24h: string;
}

/** Gate.io 现货行情（ETH 走这里；USDT 近似美元口径），失败返回空对象由上层兜底 */
async function FetchGateTicker(pair: string): Promise<GateTicker | null> {
  try {
    const { body } = await request<GateTicker[]>(
      'https://api.gateio.ws/api/v4/spot/tickers',
      { searchParams: { currency_pair: pair }, responseType: 'json' }
    );
    return Array.isArray(body) ? body[0] || null : null;
  } catch (error) {
    return null;
  }
}

function ParseGateCrypto(ticker: GateTicker | null, spec: CryptoSpec): Price.Item | null {
  const price = ToNumber(ticker?.last);
  if (!price) return null;
  const changePercent = ToNumber(ticker?.change_percentage);
  return {
    code: spec.code,
    name: spec.name,
    category: 'crypto',
    market: '数字',
    price,
    change: changePercent ? (price * changePercent) / 100 : 0,
    changePercent,
    unit: '美元',
    digits: spec.digits,
    currency: 'USD',
    high: ToNumber(ticker?.high_24h) || undefined,
    low: ToNumber(ticker?.low_24h) || undefined,
    updateTime: dayjs().format('MM-DD HH:mm'),
    sort: spec.sort,
  };
}

async function GetCryptoItems(): Promise<Price.Item[]> {
  const items: Price.Item[] = [];

  // 数字币主源走 Gate.io（2026-11-23 BTC 也从新浪迁入）：交易所直给现价/涨跌幅/24h 高低，
  // 比新浪指数可靠。CoinGecko/海外所在本机代理下不可达，Gate 直连可用。
  const gateTickers = await Promise.all(GATE_CRYPTO_SPEC.map(({ pair }) => FetchGateTicker(pair)));
  GATE_CRYPTO_SPEC.forEach(({ code }, index) => {
    const spec = CRYPTO_SPEC.find((item) => item.code === code);
    if (!spec) return;
    const parsed = ParseGateCrypto(gateTickers[index], spec);
    if (parsed) items.push(parsed);
  });

  // 新浪作兜底（BTC）：Gate 失败时顶上；已在 Gate 拿到数据的品种跳过，避免覆盖。
  const sinaRows = await FetchSinaRows(SINA_CRYPTO_SPEC.map(({ sinaCode }) => sinaCode));
  SINA_CRYPTO_SPEC.forEach(({ sinaCode, code }) => {
    if (items.some((item) => item.code === code)) return;
    const spec = CRYPTO_SPEC.find((item) => item.code === code);
    const row = sinaRows[sinaCode];
    if (!spec || !row) return;
    const parsed = ParseSinaCrypto(row, spec);
    if (parsed) items.push(parsed);
  });

  const rest = CRYPTO_SPEC.filter((spec) => !items.some((item) => item.code === spec.code));
  if (!rest.length) return items;

  const list = await CoinService.FromCoingecko(
    rest.map(({ code }) => code).join(','),
    'usd'
  );
  return items.concat(
    rest
      .map((spec) => {
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
      })
      .filter((_): _ is Price.Item => !!_)
  );
}

/** 原始报价单位简写，用于副标题 */
const SHORT_UNIT: Record<string, string> = {
  '美元/盎司': '/盎司',
  '美元/吨': '/吨',
  '美元/桶': '/桶',
  '美元': '',
  '元/克': '/克',
  '元/千克': '/千克',
  '元/吨': '/吨',
  '元/桶': '/桶',
};

/** 按统一口径计算换算系数：美元品种乘当日汇率，人民币品种只做克/千克/吨换算 */
function GetUnitFactor(code: string, unit: string, currency: Price.Currency, usdCny: number) {
  const target = TARGET_BY_CODE.get(code);
  if (!target || target === 'usd') return 1; // 汇率本身人民币口径 / usd 口径品种（如 BTC）不折汇率
  if (currency === 'USD') {
    if (target === 'g') return usdCny / OUNCE_IN_GRAM;
    if (target === 'kg') return unit.includes('盎司') ? (usdCny / OUNCE_IN_GRAM) * 1000 : usdCny / 1000;
    if (target === 'bbl') return usdCny; // 美元/桶 → 元/桶，桶不折体积
    return usdCny; // 数字币
  }
  // 内盘：沪金已是元/克，沪银元/千克→元/克，沪铜/铁矿石元/吨→元/千克
  if (target === 'g') return unit.includes('千克') ? 1 / 1000 : 1;
  if (target === 'kg') return unit.includes('吨') ? 1 / 1000 : 1;
  return 1; // 沪原油本身元/桶，数字币/汇率不折
}

/**
 * 全品类统一人民币计价（2026-11-18，2026-11-19 增桶口径）：
 * - 黄金/白银（伦敦金/银、沪金/沪银）→ 元/克；
 * - 其余金属/黑色/农产品（铂/钯/伦铜锌镍锡/沪铜铝锌镍铅/铁矿石/螺纹/焦煤/生猪/玉米/豆一）→ 元/千克；
 * - 原油（WTI/布伦特/上海原油）→ 元/桶；
 * - 数字币 → 元；汇率保持原口径。
 * 副标题保留原始报价（如 $3777.57/盎司、¥11360/千克）。拿不到汇率时整体跳过，不显示半截数据。
 */
function ConvertToCny(items: Price.Item[], usdCny: number) {
  if (!usdCny) return;

  items.forEach((item) => {
    const target = TARGET_BY_CODE.get(item.code);
    // 2026-11-23：usd 口径品种（BTC）保持美元原价，不折算、不改单位、不生成人民币化副标题
    if (!target || target === 'usd') return;

    const factor = GetUnitFactor(item.code, item.unit, item.currency, usdCny);
    const unit = target === 'g' ? '元/克' : target === 'kg' ? '元/千克' : target === 'bbl' ? '元/桶' : '元';
    const digits = target === 'cny' ? 0 : 2;

    // 副标题必须先按旧口径生成，再改 digits/unit
    item.originText = `${item.currency === 'USD' ? '$' : '¥'}${item.price.toFixed(item.digits)}${
      SHORT_UNIT[item.unit] ?? ''
    }`;
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

  // 振幅在换算后统一算，保证分子分母同口径（美元品种已折人民币）
  items.forEach((item) => {
    if (item.high === undefined || item.low === undefined || !item.prevClose) return;
    item.amplitude = ((item.high - item.low) / item.prevClose) * 100;
  });

  return items;
}

/** 按分类分组，组内按 sort 升序；空组不返回 */
export function GroupPrices(items: Price.Item[]) {
  const groups: { category: Price.Category; title: string; items: Price.Item[] }[] = [
    { category: 'currency', title: '汇率', items: [] },
    { category: 'precious', title: '贵金属', items: [] },
    { category: 'base', title: '工业金属', items: [] },
    { category: 'black', title: '黑色系', items: [] },
    { category: 'energy', title: '能源', items: [] },
    { category: 'agri', title: '农产品', items: [] },
    { category: 'crypto', title: '数字货币', items: [] },
  ];
  groups.forEach((group) => {
    group.items = items.filter(({ category }) => category === group.category).sort((a, b) => a.sort - b.sort);
  });
  return groups.filter(({ items: groupItems }) => groupItems.length);
}

// ── 历史走势 ────────────────────────────────────────────────────────────────
// 全部为日线：新浪外盘/内盘/外汇 JSONP、Gate.io 日 K。美元品种逐日套当日美元兑人民币
// 中间价后统一口径，故历史与现价卡片的单位、数值域一致。

interface RawPoint {
  time: number;
  price: number;
}

interface SinaKRow {
  date?: string;
  d?: string;
  close?: string;
  c?: string;
}

function ToDate(time: string) {
  const value = Date.parse(time);
  return Number.isFinite(value) ? value : 0;
}

// 新浪 JSONP：前缀是 <script> 跳转注释，形如 var _T([{...}]);
async function FetchJsonpRows<T>(url: string): Promise<T[]> {
  try {
    const { body } = await request(url, { responseType: 'text', headers: SINA_HEADERS });
    if (typeof body !== 'string') return [];
    const matched = body.match(/var\s+_T\s*\(\s*([\s\S]*?)\s*\)\s*;?/);
    if (!matched) return [];
    const parsed = JSON.parse(matched[1]);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

/** 新浪外盘 hf_* 历史日线：date/open/high/low/close（BTC 已不走这里，改走 Gate） */
async function FetchGlobalHistory(symbol: string): Promise<RawPoint[]> {
  const url = `https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_T/GlobalFuturesService.getGlobalFuturesDailyKLine?symbol=${symbol}`;
  const rows = await FetchJsonpRows<SinaKRow>(url);
  return rows
    .map((row) => ({ time: ToDate(row.date || ''), price: ToNumber(row.close) }))
    .filter((point) => point.time && point.price);
}

/** 新浪内盘（nf_*）：d/o/h/l/c */
async function FetchInnerHistory(symbol: string): Promise<RawPoint[]> {
  const url = `https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_T/InnerFuturesNewService.getDailyKLine?symbol=${symbol}`;
  const rows = await FetchJsonpRows<SinaKRow>(url);
  return rows
    .map((row) => ({ time: ToDate(row.d || ''), price: ToNumber(row.c) }))
    .filter((point) => point.time && point.price);
}

/** 新浪外汇日线：var _T("date,open,low,high,close|...")，取 4 号位收盘价 */
async function FetchFxHistory(symbol: string): Promise<RawPoint[]> {
  try {
    const url = `https://vip.stock.finance.sina.com.cn/forex/api/jsonp.php/var%20_T/NewForexService.getDayKLine?symbol=${symbol}`;
    const { body } = await request(url, { responseType: 'text', headers: SINA_HEADERS });
    if (typeof body !== 'string') return [];
    const matched = body.match(/var\s+_T\s*\(\s*"([^"]+)"\s*\)/);
    if (!matched) return [];
    return matched[1]
      .split('|')
      .map((line) => line.split(','))
      .map((fields) => ({ time: ToDate(fields[0] || ''), price: ToNumber(fields[4]) }))
      .filter((point) => point.time && point.price);
  } catch (error) {
    return [];
  }
}

/** Gate.io 日 K：[unix秒, 成交额, 开, 高, 低, 收, ...] */
async function FetchGateHistory(pair: string): Promise<RawPoint[]> {
  try {
    const { body } = await request<string[][]>(`https://api.gateio.ws/api/v4/spot/candlesticks`, {
      searchParams: { currency_pair: pair, interval: '1d', limit: 400 },
      responseType: 'json',
    });
    if (!Array.isArray(body)) return [];
    return body
      .map((row) => ({ time: Number(row[0]) * 1000, price: ToNumber(row[5]) }))
      .filter((point) => point.time && point.price);
  } catch (error) {
    return [];
  }
}

function FilterDays(points: RawPoint[], days: string) {
  if (days === 'max') return points;
  const amount = Number(days);
  if (!Number.isFinite(amount) || amount <= 0) return points.slice(-30);
  const from = Date.now() - amount * 86400000;
  return points.filter((point) => point.time >= from);
}

/**
 * 现价条目的历史日线（已折人民币、单位与现价卡片一致）。
 * @param code Price.Item.code
 * @param days '30' | '90' | '180' | '365' | 'max'
 */
export async function GetPriceHistory(code: string, days = '30'): Promise<Price.HistoryResult> {
  const target = TARGET_BY_CODE.get(code);
  const unit =
    target === 'usd' ? '美元' : target === 'g' ? '元/克' : target === 'kg' ? '元/千克' : target === 'bbl' ? '元/桶' : '元';

  let rows: RawPoint[] = [];
  let currency: Price.Currency = 'USD';
  let originUnit = '美元';

  // 2026-11-23：BTC 与 ETH 历史统一走 Gate.io 日线（新浪 BTC 指数已冻结，历史也不可靠）。
  if (code === 'bitcoin' || code === 'ethereum') {
    const pair = GATE_CRYPTO_SPEC.find((item) => item.code === code)?.pair;
    rows = pair ? await FetchGateHistory(pair) : [];
  } else if (code.startsWith('hf_')) {
    originUnit = HF_SPEC.find((item) => item.code === code)?.unit || '美元';
    rows = await FetchGlobalHistory(code.slice(3));
  } else if (code.startsWith('nf_')) {
    currency = 'CNY';
    originUnit = NF_SPEC.find((item) => item.code === code)?.unit || '元';
    rows = await FetchInnerHistory(code.slice(3));
  } else if (code.startsWith('fx_')) {
    currency = 'CNY';
    originUnit = 'CNY';
    rows = await FetchFxHistory(code);
  }

  if (!rows.length) return { prices: [], unit };

  // 美元品种按当日中间价折算；外汇周末无报价时沿用最近一天。
  // usd 口径（BTC）不折人民币，跳过汇率请求。
  const needFx = currency === 'USD' && target !== 'usd';
  const fxRows = needFx ? await FetchFxHistory('fx_susdcny') : [];
  const fxByDate = new Map(fxRows.map((point) => [dayjs(point.time).format('YYYY-MM-DD'), point.price]));
  const lastRate = fxRows[fxRows.length - 1]?.price || 0;

  const prices = FilterDays(rows, days)
    .map((point) => {
      const rate = currency === 'USD' ? fxByDate.get(dayjs(point.time).format('YYYY-MM-DD')) || lastRate : 1;
      const factor = GetUnitFactor(code, originUnit, currency, rate);
      return { time: point.time, price: Number((point.price * factor).toFixed(2)) };
    })
    .filter((point) => point.price > 0);

  return { prices, unit };
}

// ── 内外盘价差（2026-11-19）─────────────────────────────────────────────────
// 同一标的在两个市场的报价差（沪金 vs 伦敦金 等）。两边都已折成人民币同口径，
// 直接相除即得溢价率，无需再套汇率。只做展示，不参与涨跌计算。

/**
 * 配对表：key 为看板 code，peer 为对照品种，label 描述「谁比谁贵」。
 * ★ 增值税口径：国内白银/铜/锌/镍现货含 13% 增值税，LME 不含税，故沪伦价差里
 *   天然带约 11~14% 的税差（实测 2026-11-19：沪铜 +12.98%、沪镍 +13.91%、沪银 +11.53%），
 *   黄金免征增值税（沪金仅 +0.64%）。note 用于在 UI 上标注，避免被误读成套利空间。
 */
export const SPREAD_PAIRS: Record<string, { peer: string; label: string; note?: string }> = {
  nf_AU0: { peer: 'hf_XAU', label: '对伦敦金溢价' },
  hf_XAU: { peer: 'nf_AU0', label: '对沪金溢价' },
  nf_AG0: { peer: 'hf_XAG', label: '对伦敦银溢价', note: '含13%增值税差' },
  hf_XAG: { peer: 'nf_AG0', label: '对沪银溢价', note: '含13%增值税差' },
  nf_CU0: { peer: 'hf_CAD', label: '对伦铜溢价', note: '含13%增值税差' },
  hf_CAD: { peer: 'nf_CU0', label: '对沪铜溢价', note: '含13%增值税差' },
  // 锌虽同为上期所含税品种，但内外盘比价受进口盈亏/升贴水影响：实测溢价常仅 2% 左右，
  // 并非铜/镍/银那种 13% 税差主导，故不标注（2026-11-23 实测复核，勿凭制度想当然补 note）
  nf_ZN0: { peer: 'hf_ZSD', label: '对伦锌溢价' },
  hf_ZSD: { peer: 'nf_ZN0', label: '对沪锌溢价' },
  nf_NI0: { peer: 'hf_NID', label: '对伦镍溢价', note: '含13%增值税差' },
  hf_NID: { peer: 'nf_NI0', label: '对沪镍溢价', note: '含13%增值税差' },
  // SC 原油定价参考 Brent/Dubai 篮子，用布伦特做基准更贴切（品种品质不同，非税差）
  nf_SC0: { peer: 'hf_OIL', label: '对布伦特溢价', note: '品种品质不同' },
  hf_OIL: { peer: 'nf_SC0', label: '对上海原油溢价', note: '品种品质不同' },
};

export interface SpreadResult {
  label: string;
  /** 口径提示，如「含13%增值税差」，无则 undefined */
  note?: string;
  /** 对照品种（用于展示对方价格） */
  peer: Price.Item;
  /** 本品种相对对照品种的溢价 %，正数代表本品种更贵 */
  percent: number;
}

/** 取某品种的内外盘溢价；无配对、缺一边、或对照价为 0 时返回 null */
export function GetSpread(code: string, items: Price.Item[]): SpreadResult | null {
  const pair = SPREAD_PAIRS[code];
  if (!pair) return null;
  const self = items.find((item) => item.code === code);
  const peer = items.find((item) => item.code === pair.peer);
  if (!self || !peer || !self.price || !peer.price) return null;
  return { label: pair.label, note: pair.note, peer, percent: (self.price / peer.price - 1) * 100 };
}
