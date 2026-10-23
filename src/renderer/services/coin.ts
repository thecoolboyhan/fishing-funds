import NP from 'number-precision';
import dayjs from 'dayjs';
import request from '@/utils/request';
import * as Utils from '@/utils';

// Coingecko 市值排行
// 2026-10 起替代原 CoinCap 排行源：api.coincap.io/v2/assets 已停止服务（连接即失败/502），
// FromCoinCap 恒返回 []，导致货币排行榜整体为空。
// /coins/markets 与钱包货币列表同域（api.coingecko.com），实测国内直连可用，
// 按市值降序返回，字段与排行榜消费契约（code/name/symbol/priceUsd/changePercent24Hr）对齐。
export async function FromCoingeckoMarkets(keyword = '', ids = '') {
  try {
    const { body } = await request<
      {
        id: string;
        symbol: string;
        name: string;
        image: string;
        current_price: number | null;
        market_cap: number | null;
        market_cap_rank: number | null;
        total_volume: number | null;
        circulating_supply: number | null;
        max_supply: number | null;
        price_change_percentage_24h: number | null;
        last_updated: string;
      }[]
    >('https://api.coingecko.com/api/v3/coins/markets', {
      searchParams: {
        vs_currency: 'usd',
        order: 'market_cap_desc',
        per_page: 200,
        page: 1,
        sparkline: false,
        ...(ids ? { ids } : {}),
      },
      responseType: 'json',
    });

    const kw = keyword.trim().toLowerCase();
    return body
      .filter((item) => {
        if (!kw) return true;
        // /coins/markets 不支持文本搜索，keyword 仅做客户端过滤；精确查询请传 ids
        return (
          item.name.toLowerCase().includes(kw) ||
          item.symbol.toLowerCase().includes(kw) ||
          item.id.toLowerCase().includes(kw)
        );
      })
      .map((item) => ({
        ...item,
        code: item.id,
        rank: item.market_cap_rank,
        symbol: item.symbol.toUpperCase(),
        priceUsd: Number(item.current_price ?? 0).toFixed(2),
        changePercent24Hr: Number(item.price_change_percentage_24h ?? 0).toFixed(2),
        marketCapUsd: NP.divide(Number(item.market_cap ?? 0), 10 ** 8).toFixed(2),
        volumeUsd24Hr: NP.divide(Number(item.total_volume ?? 0), 10 ** 8).toFixed(2),
        supply: item.circulating_supply != null ? NP.divide(item.circulating_supply, 10 ** 4).toFixed(2) : undefined,
        maxSupply: item.max_supply != null ? NP.divide(item.max_supply, 10 ** 4).toFixed(2) : undefined,
        updateTime: dayjs(item.last_updated).format('MM-DD HH:mm'),
      }));
  } catch (error) {
    return [];
  }
}

// Coingecko
export async function FromCoingecko(codes: string, currency: string) {
  try {
    const { body } = await request<
      Record<
        string,
        {
          btc: 1.0;
          btc_market_cap: 18788387.0;
          btc_24h_vol: 736517.4638024335;
          btc_24h_change: 0.0;
          usd: 46310;
          usd_market_cap: 866740147397.4691;
          usd_24h_vol: 34086961197.17789;
          usd_24h_change: -2.9264155483511267;
          cny: 299962;
          cny_market_cap: 5611795758339.655;
          cny_24h_vol: 220788065066.3608;
          cny_24h_change: -2.9339084535836757;
          last_updated_at: 1629166496;
        } & Record<string, any>
      >
    >(`https://api.coingecko.com/api/v3/simple/price`, {
      searchParams: {
        ids: codes,
        vs_currencies: 'btc,usd,cny',
        include_market_cap: true,
        include_24hr_vol: true,
        include_24hr_change: true,
        include_last_updated_at: true,
      },
      responseType: 'json',
    });
    return Object.entries(body).map(([code, data]) => ({
      code,
      ...data,
      price: data[`${currency}`],
      marketCap: Utils.UnitTransform(data[`${currency}_market_cap`]),
      vol24h: Utils.UnitTransform(data[`${currency}_24h_vol`]),
      change24h: data[`${currency}_24h_change`].toFixed(2),
      updateTime: dayjs.unix(data.last_updated_at).format('MM-DD HH:mm'),
    }));
  } catch (error) {
    return [];
  }
}

export async function GetDetailFromCoingecko(code: string) {
  try {
    const { body } = await request<Coin.DetailItem>(`https://api.coingecko.com/api/v3/coins/${code}`, {
      searchParams: {
        localization: false,
        tickers: false,
        market_data: false,
        community_data: false,
        developer_data: false,
        sparkline: false,
      },
      responseType: 'json',
    });
    return body;
  } catch (error) {
    return;
  }
}

export async function GetRemoteCoinsFromCoingecko() {
  try {
    const { body } = await request<
      {
        id: string;
        symbol: string;
        name: string;
      }[]
    >('https://api.coingecko.com/api/v3/coins/list', {
      responseType: 'json',
    });
    return body.map((coin) => ({
      name: coin.name,
      symbol: coin.symbol.toUpperCase(),
      code: coin.id,
    }));
  } catch (error) {
    return [];
  }
}

export async function GetKFromCoingecko(code: string, currency: string, days: string) {
  try {
    const { body } = await request<[1597795200000, 85083.78, 85083.78, 82712.82, 82712.82][]>(
      `https://api.coingecko.com/api/v3/coins/${code}/ohlc`,
      {
        searchParams: {
          days,
          vs_currency: currency,
        },
        responseType: 'json',
      }
    );
    return body.map(([time, o, h, l, c]) => ({
      time: dayjs(time).format('YYYY-MM-DD HH:mm'),
      kp: o,
      sp: c,
      zd: l,
      zg: h,
    }));
  } catch (error) {
    return [];
  }
}

export async function GetHistoryFromCoingecko(code: string, currency: string, days: string) {
  try {
    const { body } = await request<{
      prices: [1629106772337, 47108.05433394351][];
      market_caps: [1629106772337, 47108.05433394351][];
      total_volumes: [1629106772337, 47108.05433394351][];
    // 注意：不要设置 'Accept-Encoding': 'gzip' —— 服务端会返回 gzip 压缩体，
    // 而本项目的 HTTP 客户端（undici request）不做自动解压，body.json() 解析二进制
    // 直接抛错并被 catch 静默吞掉，表现为「近期走势」白图（2026-10-23 实测）。
    // 不设该头时服务端返回明文 JSON，与 simple/price、markets、ohlc 等端点行为一致。
    }>(`https://api.coingecko.com/api/v3/coins/${code}/market_chart`, {
      searchParams: { vs_currency: currency, days },
      responseType: 'json',
    });
    return {
      prices: body.prices.map(([time, value]) => ({
        time,
        price: value.toFixed(2),
      })),
      vol24h: body.total_volumes.map(([time, value]) => ({
        time,
        price: NP.divide(value, 10 ** 8).toFixed(2),
      })),
    };
  } catch (error) {
    return { prices: [], vol24h: [] };
  }
}
