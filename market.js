const axios = require("axios");
const {
  fetchAllMarkets,
  resolveTokenID,
  getOrderBook,
  fetchAllTokenData
} = require("./polymarket");

// 缓存上一次 Binance 价格，用来算变化
const lastPrices = {};

/**
 * 获取 Polymarket 某个币的完整数据（tokenID + order book + 价格）
 * 替代旧的假 API 调用
 */
async function fetchPolymarketData(coin, markets) {
  try {
    const tokenInfo = resolveTokenID(markets, coin);
    if (!tokenInfo) return null;

    // 获取盘口
    const book = await getOrderBook(tokenInfo.yesToken);

    // 计算中间价（如果盘口有数据）
    let midPrice = null;
    if (book?.bestBid && book?.bestAsk) {
      midPrice = (book.bestBid + book.bestAsk) / 2;
    } else if (tokenInfo.outcomePrices) {
      // 用 outcomePrices 做 fallback
      const prices = Array.isArray(tokenInfo.outcomePrices)
        ? tokenInfo.outcomePrices
        : JSON.parse(tokenInfo.outcomePrices || "[]");
      midPrice = parseFloat(prices[0] || "0.5");
    }

    return {
      price: midPrice,
      market: tokenInfo.market,
      conditionId: tokenInfo.conditionId,
      yesToken: tokenInfo.yesToken,
      noToken: tokenInfo.noToken,
      book
    };
  } catch (err) {
    console.error(`   ${coin} PM error: ${err.message}`);
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
 * 更新所有市场数据（真实 Polymarket + Binance）
 *
 * 数据流:
 *   1. 从 Polymarket CLOB API 获取所有活跃市场
 *   2. 自动解析每个币的 tokenID（关键词匹配）
 *   3. 获取 order book（真实盘口）
 *   4. 同时获取 Binance 价格 + K 线
 *   5. 合并数据供策略引擎使用
 */
async function updateMarketData(coins) {
  const data = {};

  // 阶段 1: 批量获取 Polymarket 市场列表（共 1 次请求，缓存 5 分钟）
  const markets = await fetchAllMarkets();

  for (const coin of coins) {
    // 同时抓取: Binance 价格 + K 线 + Polymarket 数据
    const [binancePrice, klines] = await Promise.all([
      fetchBinancePrice(coin),
      fetchBinanceKlines(coin)
    ]);

    // 从 Polymarket 解析 token + order book
    const pmData = await fetchPolymarketData(coin, markets);

    // 计算币安价格变化
    let priceChange = 0;
    if (binancePrice && lastPrices[coin]) {
      priceChange = ((binancePrice - lastPrices[coin]) / lastPrices[coin]) * 100;
    }

    // 计算真实波动率（基于 12 根 5-min K 线）
    const volatility = calcRealVolatility(klines);

    // 缓存 Binance 价格
    if (binancePrice) {
      lastPrices[coin] = binancePrice;
    }

    data[coin] = {
      coin,
      // Polymarket 数据
      pmPrice: pmData?.price ?? null,
      pmBid: pmData?.book?.bestBid ?? null,
      pmAsk: pmData?.book?.bestAsk ?? null,
      pmSpread: pmData?.book?.spread ?? null,
      pmMarket: pmData?.market ?? null,
      conditionId: pmData?.conditionId ?? null,
      yesToken: pmData?.yesToken ?? null,
      noToken: pmData?.noToken ?? null,
      // Binance 数据
      binancePrice,
      priceChange,
      volatility,
      // 状态
      success: !!(binancePrice || pmData),
      hasPM: !!pmData,
      hasBinance: !!binancePrice
    };
  }

  return data;
}

module.exports = { updateMarketData, fetchBinancePrice, fetchBinanceKlines };
