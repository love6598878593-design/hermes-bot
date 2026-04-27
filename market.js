const axios = require("axios");

// Polymarket 价格 API (polygon 子图)
const POLYMARKET_API = "https://clob.polymarket.com";

// 缓存上一次价格，用来算变化
const lastPrices = {};

/**
 * 获取 Polymarket 某个币的当前概率价格
 * 这里按币名查预测市场（示例：BTC 5-min Up）
 */
async function fetchPolymarketPrice(coin) {
  try {
    // 搜索 Polymarket 市场
    const res = await axios.get(`${POLYMARKET_API}/markets`, {
      params: { 
        limit: 1,
        tag: coin.toLowerCase(),
        closed: false
      },
      timeout: 10000
    });

    if (res.data && res.data.length > 0) {
      const market = res.data[0];
      const price = parseFloat(market.outcomePrices?.[0] || "0.5");
      return {
        price,
        market: market.conditionId || market.id,
        question: market.question || `${coin} Up?`
      };
    }
    return null;
  } catch (err) {
    console.error(`   ${coin} PM API error: ${err.message}`);
    return null;
  }
}

/**
 * 获取 Binance 实时价格
 */
async function fetchBinancePrice(coin) {
  try {
    const symbol = coin + "USDT";
    const res = await axios.get(`https://api.binance.com/api/v3/ticker/price`, {
      params: { symbol },
      timeout: 5000
    });
    return parseFloat(res.data.price);
  } catch (err) {
    // 部分币可能不是直接 BTCUSDT 格式
    if (coin === "HYPE") {
      try {
        const res = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT`, { timeout: 5000 });
        return parseFloat(res.data.price);
      } catch {}
    }
    return null;
  }
}

/**
 * 跟新所有市场数据
 */
async function updateMarketData(coins) {
  const data = {};

  for (const coin of coins) {
    const [pm, binance] = await Promise.all([
      fetchPolymarketPrice(coin),
      fetchBinancePrice(coin)
    ]);

    if (pm && binance) {
      // 核心逻辑：Polymarket 概率 vs Binance 隐含概率
      // 如果 5-min 历史走势向上，PM 价格应 > 0.5
      // 如果有价差，就有套利机会
      data[coin] = {
        coin,
        pmPrice: pm.price,
        binancePrice: binance,
        priceChange: lastPrices[coin] ? ((binance - lastPrices[coin]) / lastPrices[coin]) * 100 : 0,
        volatility: Math.abs(((binance - (lastPrices[coin] || binance)) / (lastPrices[coin] || binance)) * 100)
      };

      lastPrices[coin] = binance;
    } else if (pm) {
      data[coin] = {
        coin,
        pmPrice: pm.price,
        binancePrice: null,
        priceChange: 0,
        volatility: 0,
        onlyPM: true
      };
    }
  }

  return data;
}

module.exports = { updateMarketData, fetchPolymarketPrice, fetchBinancePrice };
