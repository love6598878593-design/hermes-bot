/**
 * Polymarket CLOB API 封装
 *
 * 核心功能:
 * 1. fetchAllMarkets() — 获取所有活跃市场
 * 2. resolveTokenID(markets, keyword) — 自动解析 tokenID
 * 3. getOrderBook(tokenID) — 实时盘口
 * 4. placeLimitOrder(tokenID, side, price, size) — 限价单
 * 5. marketTake(tokenID, side, size) — 吃单
 *
 * 关键词映射: BTC → ["bitcoin", "btc"], ETH → ["ethereum", "eth"], 等等
 */

const axios = require("axios");
const { ClobClient } = require("@polymarket/clob-client");

// ====== 配置 ======
const POLYMARKET_API = "https://clob.polymarket.com";
const CHAIN_ID = 137; // Polygon mainnet

// 7 个核心币的关键词映射
const KEYWORD_MAP = {
  BTC:  ["bitcoin", "btc", "btcusdt"],
  ETH:  ["ethereum", "eth", "ethusdt"],
  SOL:  ["solana", "sol", "solusdt"],
  XRP:  ["xrp", "ripple", "xrpusdt"],
  DOGE: ["dogecoin", "doge", "dogeusdt"],
  HYPE: ["hyperliquid", "hype"],
  BNB:  ["bnb", "binance coin", "bnbusdt"]
};

// 缓存市场列表
let cachedMarkets = null;
let cachedTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 min

// ClobClient 实例（懒加载）
let clobInstance = null;

function getClobClient() {
  if (clobInstance) return clobInstance;
  const pk = process.env.POLYMARKET_PRIVATE_KEY;
  if (pk) {
    clobInstance = new ClobClient(POLYMARKET_API, pk, CHAIN_ID);
  }
  return clobInstance;
}

// ====== 1. 获取所有活跃市场 ======
async function fetchAllMarkets(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedMarkets && (now - cachedTime) < CACHE_TTL) {
    return cachedMarkets;
  }

  try {
    // 先用 GET /markets 获取活跃市场
    // 这个接口不需要认证
    const res = await axios.get(`${POLYMARKET_API}/markets`, {
      params: {
        closed: false,
        limit: 200
      },
      timeout: 15000
    });

    let markets = [];

    if (Array.isArray(res.data)) {
      markets = res.data;
    } else if (res.data?.data && Array.isArray(res.data.data)) {
      markets = res.data.data;
    } else if (res.data?.markets && Array.isArray(res.data.markets)) {
      markets = res.data.markets;
    }

    // 过滤掉已结束的市场
    markets = markets.filter(m => m.closed !== true);

    console.log(`   📦 Fetched ${markets.length} active markets from Polymarket`);

    cachedMarkets = markets;
    cachedTime = now;
    return markets;

  } catch (err) {
    console.error(`   Fetch markets error: ${err.message}`);
    if (cachedMarkets) {
      console.log(`   Using stale cache (${cachedMarkets.length} markets)`);
      return cachedMarkets;
    }
    return [];
  }
}

// ====== 2. 自动解析 tokenID ======
/**
 * 从市场列表中搜索匹配关键词的市场
 * 返回 market + conditionId + yesToken + noToken
 */
function resolveTokenID(markets, coin) {
  const keywords = KEYWORD_MAP[coin];
  if (!keywords || !markets || markets.length === 0) return null;

  for (const m of markets) {
    const question = (m.question || m.description || "").toLowerCase();

    // 检查是否包含任意关键词
    const match = keywords.some(kw => question.includes(kw));
    if (!match) continue;

    // 提取 tokens
    const tokens = m.tokens || m.outcomes || [];
    if (tokens.length < 2) {
      // 有些市场结构不同
      if (m.conditionId && m.token_id) {
        return {
          market: m.question || coin,
          conditionId: m.conditionId,
          yesToken: m.token_id,
          noToken: null
        };
      }
      continue;
    }

    return {
      market: m.question || m.description || coin,
      conditionId: m.conditionId,
      yesToken: tokens[0]?.token_id || tokens[0]?.id,
      noToken: tokens[1]?.token_id || tokens[1]?.id,
      outcomePrices: m.outcomePrices || null
    };
  }

  return null;
}

// ====== 3. 实时盘口监控 (Order Book) ======
async function getOrderBook(tokenID, side = null) {
  try {
    if (!tokenID) return null;

    const client = getClobClient();
    if (!client) {
      // 没有私钥时用 REST API 获取盘口
      const res = await axios.get(`${POLYMARKET_API}/book`, {
        params: { token_id: tokenID },
        timeout: 10000
      });

      const book = res.data;
      return {
        bestBid: book.bids?.[0] ? parseFloat(book.bids[0].price) : null,
        bestAsk: book.asks?.[0] ? parseFloat(book.asks[0].price) : null,
        bidSize: book.bids?.[0] ? parseFloat(book.bids[0].size) : 0,
        askSize: book.asks?.[0] ? parseFloat(book.asks[0].size) : 0,
        spread: book.bids?.[0] && book.asks?.[0]
          ? parseFloat(book.asks[0].price) - parseFloat(book.bids[0].price)
          : null,
        raw: book
      };
    }

    // 用 ClobClient
    const book = await client.getOrderBook(tokenID);
    if (!book) return null;

    const bids = Array.isArray(book) ? book : (book.bids || []);
    const asks = Array.isArray(book) ? [] : (book.asks || []);

    return {
      bestBid: bids[0]?.price ? parseFloat(bids[0].price) : null,
      bestAsk: asks[0]?.price ? parseFloat(asks[0].price) : null,
      bidSize: bids[0]?.size ? parseFloat(bids[0].size) : 0,
      askSize: asks[0]?.size ? parseFloat(asks[0].size) : 0,
      spread: bids[0]?.price && asks[0]?.price
        ? parseFloat(asks[0].price) - parseFloat(bids[0].price)
        : null,
      raw: book
    };

  } catch (err) {
    console.error(`   OrderBook error: ${err.message}`);
    return null;
  }
}

// ====== 4. 限价单（挂单） ======
async function placeLimitOrder(tokenID, side, price, size) {
  try {
    const client = getClobClient();
    if (!client) {
      console.error(`   ClobClient not initialized — set POLYMARKET_PRIVATE_KEY`);
      return null;
    }

    // ClobClient.createOrder 返回签名的 order
    const order = await client.createOrder({
      tokenID,
      price: price.toString(),
      size: size.toString(),
      side                    // "BUY" or "SELL"
    });

    // 发送到 CLOB
    const result = await client.postOrder(order);
    return {
      success: true,
      orderId: result?.orderId || result?.id,
      status: result?.status || "PENDING",
      raw: result
    };

  } catch (err) {
    console.error(`   Limit order error: ${err.message}`);
    return null;
  }
}

// ====== 5. 吃单（立即成交） ======
async function marketTake(tokenID, side, size) {
  try {
    const book = await getOrderBook(tokenID);
    if (!book) {
      console.error(`   No order book for token ${tokenID}`);
      return null;
    }

    // 吃单价格：买就吃 ask，卖就吃 bid
    const price = side === "BUY"
      ? book.bestAsk
      : book.bestBid;

    if (!price) {
      console.error(`   No ${side === "BUY" ? "ask" : "bid"} price available`);
      return null;
    }

    return await placeLimitOrder(tokenID, side, price, size);

  } catch (err) {
    console.error(`   Market take error: ${err.message}`);
    return null;
  }
}

// ====== 6. 批量获取所有 7 币的市场数据 ======
/**
 * 一次性获取所有币的 market + tokenID + order book
 */
async function fetchAllTokenData(coins) {
  const markets = await fetchAllMarkets();
  const results = {};

  for (const coin of coins) {
    const tokenInfo = resolveTokenID(markets, coin);
    if (!tokenInfo) {
      results[coin] = { coin, found: false };
      continue;
    }

    // 获取盘口
    const book = await getOrderBook(tokenInfo.yesToken);

    results[coin] = {
      coin,
      found: true,
      market: tokenInfo.market,
      conditionId: tokenInfo.conditionId,
      yesToken: tokenInfo.yesToken,
      noToken: tokenInfo.noToken,
      outcomePrices: tokenInfo.outcomePrices,
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
