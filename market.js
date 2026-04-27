const axios = require("axios");

// Polymarket CLOB API
const POLYMARKET_API = "https://clob.polymarket.com";

// 缓存上一次价格，用来算变化
const lastPrices = {};
// 价格历史，用于计算真实波动率
const priceHistory = {};

/**
 * 获取 Binance 实时价格
 * Binance API 不需要代理，直接访问
 */
async function fetchBinancePrice(coin) {
  try {
    // HYPE 没有 USDT 交易对，跳过
    if (coin === "HYPE") {
      return null;
    }
    const symbol = coin + "USDT";
    const res = await axios.get(`https://api.binance.com/api/v3/ticker/price`, {
      params: { symbol },
      timeout: 5000
    });
    return parseFloat(res.data.price);
  } catch (err) {
    console.error(`   ${coin} Binance error: ${err.message}`);
    return null;
  }
}

/**
 * 获取 Polymarket 某个币的当前概率价格
 * 使用 CLOB API 的价差数据搜索活跃市场
 */
async function fetchPolymarketPrice(coin) {
  try {
    // 搜索 Polymarket 市场 - 按币名关键词
    const res = await axios.get(`${POLYMARKET_API}/price`, {
      params: {
        token: coin.toLowerCase(),
        side: "BUY"
      },
      timeout: 10000
    });

    // API 可能返回价格数据或空
    if (res.data && res.data.price !== undefined) {
      return {
        price: parseFloat(res.data.price) / 100, // 有些 API 返回的是基点
        market: res.data.asset_id || coin,
        question: `${coin} Up or Down?`
      };
    }
    return null;
  } catch (err) {
    // Polymarket API 可能需要认证，fallback 到模拟数据
    // 真实部署时需要配 API key
    if (process.env.POLYMARKET_API_KEY) {
      console.error(`   ${coin} PM API error: ${err.message}`);
    }
    return null;
  }
}

/**
 * 获取真实 Binance K 线数据（用于真实波动率计算）
 */
async function fetchBinanceKlines(coin, interval = "5m", limit = 12) {
  try {
    if (coin === "HYPE") return null;
    const symbol = coin + "USDT";
    const res = await axios.get(`https://api.binance.com/api/v3/klines`, {
      params: { symbol, interval, limit },
      timeout: 5000
    });
    if (res.data && res.data.length > 1) {
      // klines: [open_time, open, high, low, close, volume, ...]
      const closes = res.data.map(k => parseFloat(k[4]));
      return closes;
    }
    return null;
  } catch (err) {
    return null;
  }
}

/**
 * 计算真实波动率（基于最近12个 5-min K 线）
 */
function calcRealVolatility(prices) {
  if (!prices || prices.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < prices.length; i++) {
    const change = Math.abs((prices[i] - prices[i-1]) / prices[i-1]) * 100;
    sum += change;
  }
  return sum / (prices.length - 1); // 平均每根 K 线的变化百分比
}

/**
 * 更新所有市场数据
 */
async function updateMarketData(coins) {
  const data = {};

  for (const coin of coins) {
    // 同时获取：当前价格 + 历史 K 线 + Polymarket
    const [binancePrice, klines, pm] = await Promise.all([
      fetchBinancePrice(coin),
      fetchBinanceKlines(coin),
      fetchPolymarketPrice(coin)
    ]);

    // 计算价格变化
    let priceChange = 0;
    if (binancePrice && lastPrices[coin]) {
      priceChange = ((binancePrice - lastPrices[coin]) / lastPrices[coin]) * 100;
    }

    // 计算真实波动率
    const volatility = calcRealVolatility(klines);

    // 缓存价格
    if (binancePrice) {
      lastPrices[coin] = binancePrice;
    }

    data[coin] = {
      coin,
      pmPrice: pm?.price ?? null,
      pmMarket: pm?.market ?? null,
      binancePrice,
      priceChange,
      volatility,
      success: !!(binancePrice || pm)
    };
  }

  return data;
}

module.exports = { updateMarketData, fetchPolymarketPrice, fetchBinancePrice };
