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
 * 修复后的获取币安价格函数
 * 自动处理币种到交易对的转换
 */
async function fetchBinancePrice(coin) {
  if (coin === "HYPE") return null;
  try {
    const symbol = coin + "USDT";
    const response = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`, { timeout: 3000 });
    return parseFloat(response.data.price);
  } catch (error) {
    console.error(`Binance Price Error (${coin}):`, error.message);
    return null;
  }
}

/**
 * 修复后的 K 线获取函数
 * 统一命名为 fetchBinanceKlines，并使用 CoinGecko 作为数据源（规避地区限制）
 */
async function fetchBinanceKlines(coin) {
  const COINGECKO_IDS = {
    BTC: "bitcoin", ETH: "ethereum", SOL: "solana",
    XRP: "ripple", DOGE: "dogecoin", HYPE: "hyperliquid",
    BNB: "binancecoin"
  };

  const id = COINGECKO_IDS[coin];
  if (!id) return null;

  try {
    // 使用 CoinGecko OHLC 接口作为稳定来源
    const res = await axios.get(
      `https://api.coingecko.com/api/v3/coins/${id}/ohlc`,
      {
        params: { vs_currency: "usd", days: "1" },
        timeout: 8000
      }
    );
    if (Array.isArray(res.data) && res.data.length > 1) {
      // 取最后 12 根 K 线的收盘价
      return res.data.slice(-12).map(candle => candle[4]);
    }
    return null;
  } catch (err) {
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
    // 这里的函数名现在已经和上面定义的统一了
    const [binancePrice, klines] = await Promise.all([
      fetchBinancePrice(coin),
      fetchBinanceKlines(coin)
    ]);

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

// 统一导出，确保名字与 updateMarketData 中的调用一致
module.exports = { 
  updateMarketData, 
  fetchBinancePrice, 
  fetchBinanceKlines 
};
