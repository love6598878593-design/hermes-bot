const axios = require("axios");
const {
  fetchAllMarkets,
  resolveTokenID,
  getOrderBook,
  fetchAllTokenData
} = require("./polymarket");

// 内存缓存：防止 429 报错
const lastPrices = {};
const klinesCache = {};
let lastKlinesFetchTime = 0;

/**
 * 修复 451 错误：尝试多个币安 API 终端
 */
async function fetchBinancePrice(coin) {
  if (coin === "HYPE") return null;
  const symbol = coin + "USDT";
  
  // 备选域名列表
  const endpoints = [
    `https://api.binance.us/api/v3/ticker/price?symbol=${symbol}`,
    `https://api1.binance.com/api/v3/ticker/price?symbol=${symbol}`,
    `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`
  ];

  for (const url of endpoints) {
    try {
      const response = await axios.get(url, { timeout: 3000 });
      if (response.data && response.data.price) {
        return parseFloat(response.data.price);
      }
    } catch (error) {
      // 只有在最后一个也失败时才在控制台打印严重错误
      if (url === endpoints[endpoints.length - 1]) {
        console.error(`Binance Price Final Error (${coin}): ${error.message}`);
      }
    }
  }
  return null;
}

/**
 * 修复 429 错误：增加 5 分钟缓存机制
 */
async function fetchBinanceKlines(coin) {
  const COINGECKO_IDS = {
    BTC: "bitcoin", ETH: "ethereum", SOL: "solana",
    XRP: "ripple", DOGE: "dogecoin", HYPE: "hyperliquid",
    BNB: "binancecoin"
  };

  const id = COINGECKO_IDS[coin];
  if (!id) return null;

  const now = Date.now();
  // 如果 5 分钟（300000ms）内抓取过，直接返回缓存
  if (klinesCache[id] && (now - lastKlinesFetchTime < 300000)) {
    return klinesCache[id];
  }

  try {
    // 随机延迟 500ms-1500ms，防止并发导致 429
    await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500));

    const res = await axios.get(
      `https://api.coingecko.com/api/v3/coins/${id}/ohlc`,
      {
        params: { vs_currency: "usd", days: "1" },
        timeout: 10000
      }
    );
    
    if (Array.isArray(res.data) && res.data.length > 1) {
      const prices = res.data.slice(-12).map(candle => candle[4]);
      klinesCache[id] = prices; // 存入缓存
      lastKlinesFetchTime = now;
      return prices;
    }
    return null;
  } catch (err) {
    // 如果报 429，尝试使用缓存中的旧数据
    if (err.response && err.response.status === 429) {
      return klinesCache[id] || null;
    }
    console.error(`Klines Error (${coin}):`, err.message);
    return null;
  }
}

/**
 * 获取 Polymarket 盘口数据
 */
async function fetchPolymarketData(coin, markets) {
  try {
    const tokenInfo = resolveTokenID(markets, coin);
    if (!tokenInfo) return null;

    const book = await getOrderBook(tokenInfo.yesToken);

    let midPrice = null;
    if (book?.bestBid && book?.bestAsk) {
      midPrice = (book.bestBid + book.bestAsk) / 2;
    } else if (tokenInfo.outcomePrices) {
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
    console.error(`${coin} PM error: ${err.message}`);
    return null;
  }
}

/**
 * 计算波动率
 */
function calcRealVolatility(prices) {
  if (!prices || prices.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < prices.length; i++) {
    const change = Math.abs((prices[i] - prices[i-1]) / prices[i-1]) * 100;
    sum += change;
  }
  return sum / (prices.length - 1);
}

/**
 * 更新所有市场数据的主入口
 */
async function updateMarketData(coins) {
  const data = {};
  const markets = await fetchAllMarkets();

  for (const coin of coins) {
    // 串行获取，避免瞬时并发过高
    const binancePrice = await fetchBinancePrice(coin);
    const klines = await fetchBinanceKlines(coin);
    const pmData = await fetchPolymarketData(coin, markets);

    let priceChange = 0;
    if (binancePrice && lastPrices[coin]) {
      priceChange = ((binancePrice - lastPrices[coin]) / lastPrices[coin]) * 100;
    }

    const volatility = calcRealVolatility(klines);

    if (binancePrice) {
      lastPrices[coin] = binancePrice;
    }

    data[coin] = {
      coin,
      pmPrice: pmData?.price ?? null,
      pmBid: pmData?.book?.bestBid ?? null,
      pmAsk: pmData?.book?.bestAsk ?? null,
      pmSpread: pmData?.book?.spread ?? null,
      pmMarket: pmData?.market ?? null,
      conditionId: pmData?.conditionId ?? null,
      yesToken: pmData?.yesToken ?? null,
      noToken: pmData?.noToken ?? null,
      binancePrice,
      priceChange,
      volatility,
      success: !!(binancePrice || pmData),
      hasPM: !!pmData,
      hasBinance: !!binancePrice
    };
  }

  return data;
}

module.exports = { 
  updateMarketData, 
  fetchBinancePrice, 
  fetchBinanceKlines 
};
