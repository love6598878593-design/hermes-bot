/**
 * Polymarket CLOB API 封装 - 修复版
 * * 核心改进：
 * 1. 增加 404 错误静默处理，避免日志轰炸
 * 2. 增强 fetchAllMarkets 的活跃市场过滤，剔除已结束市场
 * 3. 优化 resolveTokenID 的关键字匹配逻辑
 */

const axios = require("axios");
const { ClobClient } = require("@polymarket/clob-client");

// ====== 配置 ======
const POLYMARKET_API = "https://clob.polymarket.com";
const CHAIN_ID = 137; 

const KEYWORD_MAP = {
  BTC:  ["bitcoin", "btc", "btcusdt"],
  ETH:  ["ethereum", "eth", "ethusdt"],
  SOL:  ["solana", "sol", "solusdt"],
  XRP:  ["xrp", "ripple", "xrpusdt"],
  DOGE: ["dogecoin", "doge", "dogeusdt"],
  HYPE: ["hyperliquid", "hype"],
  BNB:  ["bnb", "binance coin", "bnbusdt"]
};

let cachedMarkets = null;
let cachedTime = 0;
const CACHE_TTL = 5 * 60 * 1000; 

let clobInstance = null;

function getClobClient() {
  if (clobInstance) return clobInstance;
  const pk = process.env.POLYMARKET_PRIVATE_KEY;
  if (pk) {
    // 确保这里的初始化符合你使用的 SDK 版本
    clobInstance = new ClobClient(POLYMARKET_API, pk, CHAIN_ID);
  }
  return clobInstance;
}

// ====== 1. 获取所有活跃市场 (增加严格过滤) ======
async function fetchAllMarkets(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedMarkets && (now - cachedTime) < CACHE_TTL) {
    return cachedMarkets;
  }

  try {
    const res = await axios.get(`${POLYMARKET_API}/markets`, {
      params: { closed: false, limit: 1000 }, // 扩大搜索范围
      timeout: 15000
    });

    let rawMarkets = [];
    if (Array.isArray(res.data)) rawMarkets = res.data;
    else if (res.data?.data) rawMarkets = res.data.data;
    else if (res.data?.markets) rawMarkets = res.data.markets;

    // 核心修复：只保留未关闭且 active 的市场，彻底避免 404
    const markets = rawMarkets.filter(m => 
      m.closed === false && 
      m.active !== false &&
      (m.tokens || m.outcomes || m.token_id)
    );

    console.log(`    📦 Fetched ${markets.length} active markets from Polymarket`);

    cachedMarkets = markets;
    cachedTime = now;
    return markets;

  } catch (err) {
    console.error(`    Fetch markets error: ${err.message}`);
    return cachedMarkets || [];
  }
}

// ====== 2. 自动解析 tokenID (优化匹配) ======
function resolveTokenID(markets, coin) {
  const keywords = KEYWORD_MAP[coin];
  if (!keywords || !markets || markets.length === 0) return null;

  // 优先匹配包含 "Price" 或 "above/below" 的预测市场，避免匹配到杂乱的活动市场
  const sortedMarkets = markets.sort((a, b) => {
    const aDesc = (a.question || a.description || "").toLowerCase();
    return aDesc.includes("price") ? -1 : 1;
  });

  for (const m of sortedMarkets) {
    const question = (m.question || m.description || "").toLowerCase();
    const match = keywords.some(kw => question.includes(kw));
    if (!match) continue;

    const tokens = m.tokens || m.outcomes || [];
    
    // 兼容不同的数据结构
    if (tokens.length >= 2) {
      return {
        market: m.question || m.description || coin,
        conditionId: m.conditionId,
        yesToken: tokens[0]?.token_id || tokens[0]?.id || tokens[0]?.asset_id,
        noToken: tokens[1]?.token_id || tokens[1]?.id || tokens[1]?.asset_id,
        outcomePrices: m.outcomePrices || null
      };
    } else if (m.token_id) {
      return {
        market: m.question || coin,
        conditionId: m.conditionId,
        yesToken: m.token_id,
        noToken: null
      };
    }
  }
  return null;
}

// ====== 3. 实时盘口监控 (修复 404 报错) ======
async function getOrderBook(tokenID) {
  if (!tokenID) return null;
  
  try {
    const client = getClobClient();
    let book;

    if (!client) {
      const res = await axios.get(`${POLYMARKET_API}/book`, {
        params: { token_id: tokenID },
        timeout: 10000
      });
      book = res.data;
    } else {
      book = await client.getOrderBook(tokenID);
    }

    if (!book) return null;

    const bids = book.bids || [];
    const asks = book.asks || [];

    return {
      bestBid: bids[0]?.price ? parseFloat(bids[0].price) : null,
      bestAsk: asks[0]?.price ? parseFloat(asks[0].price) : null,
      bidSize: bids[0]?.size ? parseFloat(bids[0].size) : 0,
      askSize: asks[0]?.size ? parseFloat(asks[0].size) : 0,
      spread: (bids[0]?.price && asks[0]?.price)
        ? parseFloat(asks[0].price) - parseFloat(bids[0].price)
        : null,
      raw: book
    };

  } catch (err) {
    // 核心修复：如果是 404 错误（Token 已失效），静默处理不报错
    if (err.response && err.response.status === 404) {
      return null;
    }
    console.error(`    OrderBook error for ${tokenID.substring(0,8)}: ${err.message}`);
    return null;
  }
}

// ====== 4. 限价单 ======
async function placeLimitOrder(tokenID, side, price, size) {
  try {
    const client = getClobClient();
    if (!client) return null;

    const order = await client.createOrder({
      tokenID,
      price: price.toString(),
      size: size.toString(),
      side 
    });

    const result = await client.postOrder(order);
    return {
      success: true,
      orderId: result?.orderId || result?.id,
      raw: result
    };
  } catch (err) {
    console.error(`    Limit order error: ${err.message}`);
    return null;
  }
}

// ====== 5. 吃单 ======
async function marketTake(tokenID, side, size) {
  const book = await getOrderBook(tokenID);
  if (!book) return null;

  const price = side === "BUY" ? book.bestAsk : book.bestBid;
  if (!price) return null;

  return await placeLimitOrder(tokenID, side, price, size);
}

// ====== 6. 批量数据获取 ======
async function fetchAllTokenData(coins) {
  const markets = await fetchAllMarkets();
  const results = {};

  for (const coin of coins) {
    const tokenInfo = resolveTokenID(markets, coin);
    if (!tokenInfo) {
      results[coin] = { coin, found: false };
      continue;
    }

    const book = await getOrderBook(tokenInfo.yesToken);
    results[coin] = {
      coin,
      found: true,
      market: tokenInfo.market,
      conditionId: tokenInfo.conditionId,
      yesToken: tokenInfo.yesToken,
      noToken: tokenInfo.noToken,
      book
    };
  }
  return results;
}

module.exports = {
  fetchAllMarkets,
  resolveTokenID,
  getOrderBook,
  placeLimitOrder,
  marketTake,
  fetchAllTokenData,
  KEYWORD_MAP
};
