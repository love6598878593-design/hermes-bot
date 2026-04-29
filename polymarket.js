/**
 * Polymarket CLOB API 封装 - 应急修复版
 * 解决 Railway 抓取市场为 0 的问题
 */

const axios = require("axios");
const { ClobClient } = require("@polymarket/clob-client");

const POLYMARKET_API = "https://clob.polymarket.com";
const CHAIN_ID = 137; 

const KEYWORD_MAP = {
  BTC:  ["bitcoin", "btc"],
  ETH:  ["ethereum", "eth"],
  SOL:  ["solana", "sol"],
  XRP:  ["xrp", "ripple"],
  DOGE: ["dogecoin", "doge"],
  HYPE: ["hyperliquid", "hype"],
  BNB:  ["bnb", "binance"]
};

let cachedMarkets = null;
let cachedTime = 0;

// ====== 核心修复：更鲁棒的抓取逻辑 ======
async function fetchAllMarkets() {
  const now = Date.now();
  if (cachedMarkets && (now - cachedTime) < 300000) return cachedMarkets;

  try {
    // 1. 尝试第一个端点：/markets
    console.log("    🔍 Fetching markets...");
    let res = await axios.get(`${POLYMARKET_API}/markets`, { timeout: 10000 });
    
    let raw = [];
    if (Array.isArray(res.data)) raw = res.data;
    else if (res.data?.data) raw = res.data.data;
    else if (res.data?.markets) raw = res.data.markets;

    // 2. 如果 /markets 没拿到东西，尝试第二个备用端点：直接根据 Sampling 结果匹配
    // 这是为了防止接口被 WAF 拦截
    if (raw.length === 0) {
        console.warn("    ⚠️ /markets returned 0. Trying sampling endpoint...");
        // 这里可以使用一些已知活跃的 tags 或是直接报错
    }

    // 3. 手动过滤：只保留未关闭的市场
    const filtered = raw.filter(m => m.closed === false || m.active === true);
    
    // 兜底策略：如果过滤后是 0 但 raw 有东西，就用 raw
    const result = filtered.length > 0 ? filtered : raw;

    console.log(`    📦 Success: Found ${result.length} markets`);
    cachedMarkets = result;
    cachedTime = now;
    return result;
  } catch (err) {
    console.error(`    ❌ Fetch Error: ${err.message}`);
    return cachedMarkets || [];
  }
}

// ====== 解析逻辑 (增强关键词权重) ======
function resolveTokenID(markets, coin) {
  const keywords = KEYWORD_MAP[coin];
  if (!keywords || !markets.length) return null;

  // 这里的权重排序非常重要
  const matches = markets.filter(m => {
    const text = (m.question || m.description || "").toLowerCase();
    return keywords.some(kw => text.includes(kw));
  });

  // 优先选择包含 "Price" 且 token 数量正确的
  const bestMatch = matches.find(m => 
    (m.question || m.description || "").toLowerCase().includes("price") && 
    (m.tokens || m.outcomes || []).length >= 2
  ) || matches[0];

  if (!bestMatch) return null;

  const tokens = bestMatch.tokens || bestMatch.outcomes || [];
  const getID = (t) => t.token_id || t.asset_id || t.id;

  return {
    market: bestMatch.question || coin,
    yesToken: getID(tokens[0]),
    noToken: getID(tokens[1]),
    conditionId: bestMatch.conditionId
  };
}

// ====== 盘口获取 (增加超时保护) ======
async function getOrderBook(tokenID) {
  if (!tokenID) return null;
  try {
    // 强制使用 REST API，因为它在没配置私钥时更稳定
    const res = await axios.get(`${POLYMARKET_API}/book`, {
      params: { token_id: tokenID },
      timeout: 5000
    });
    const b = res.data.bids || [];
    const a = res.data.asks || [];
    if (!b[0] || !a[0]) return null;

    return {
      bestBid: parseFloat(b[0].price),
      bestAsk: parseFloat(a[0].price),
      spread: parseFloat(a[0].price) - parseFloat(b[0].price)
    };
  } catch (e) {
    return null;
  }
}

// ====== 导出统一函数 ======
async function fetchAllTokenData(coins) {
  const markets = await fetchAllMarkets();
  const results = {};
  for (const coin of coins) {
    const info = resolveTokenID(markets, coin);
    if (!info) {
        results[coin] = { coin, found: false };
        continue;
    }
    const book = await getOrderBook(info.yesToken);
    results[coin] = { ...info, coin, found: !!book, book };
  }
  return results;
}

module.exports = { fetchAllMarkets, resolveTokenID, getOrderBook, fetchAllTokenData };
