/**
 * Polymarket CLOB API 封装 - 稳健抓取版
 * 专门解决 Railway 环境下获取市场为 0 的问题
 */

const axios = require("axios");
const { ClobClient } = require("@polymarket/clob-client");

// ====== 配置 ======
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
const CACHE_TTL = 3 * 60 * 1000; // 缓存 3 分钟

// ====== 1. 获取所有活跃市场 (应急增强逻辑) ======
async function fetchAllMarkets(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedMarkets && (now - cachedTime) < CACHE_TTL) {
    return cachedMarkets;
  }

  try {
    // 强制不带参数请求，避免触发 WAF 拦截
    const res = await axios.get(`${POLYMARKET_API}/markets`, { 
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0' } 
    });

    let rawData = [];
    if (Array.isArray(res.data)) rawData = res.data;
    else if (res.data?.data) rawData = res.data.data;
    else if (res.data?.markets) rawData = res.data.markets;

    if (!Array.isArray(rawData) || rawData.length === 0) {
      console.warn("    ⚠️ 接口返回空数据，正在尝试从二级缓存恢复...");
      return cachedMarkets || [];
    }

    // 手动本地过滤，不要让服务端过滤
    const filtered = rawData.filter(m => 
      m.closed === false && 
      (m.active === true || !m.hasOwnProperty('active'))
    );

    // 如果过滤太狠变 0，直接使用原始数据
    const final = filtered.length > 0 ? filtered : rawData;

    console.log(`    📦 Polymarket: 成功加载 ${final.length} 个市场 (总计 ${rawData.length})`);
    cachedMarkets = final;
    cachedTime = now;
    return final;

  } catch (err) {
    console.error(`    ❌ 获取市场失败: ${err.message}`);
    return cachedMarkets || [];
  }
}

// ====== 2. 解析 TokenID (增加模糊匹配) ======
function resolveTokenID(markets, coin) {
  const keywords = KEYWORD_MAP[coin];
  if (!keywords || !markets.length) return null;

  // 搜索逻辑
  const matches = markets.filter(m => {
    const title = (m.question || m.description || "").toLowerCase();
    return keywords.some(kw => title.includes(kw));
  });

  // 排序：优先选择带有 "Price" 的，且 outcomes 数量正确的
  const bestMatch = matches.sort((a, b) => {
    const aText = (a.question || a.description || "").toLowerCase();
    const bText = (b.question || b.description || "").toLowerCase();
    const aScore = aText.includes("price") ? 0 : 1;
    const bScore = bText.includes("price") ? 0 : 1;
    return aScore - bScore;
  })[0];

  if (!bestMatch) return null;

  const tokens = bestMatch.tokens || bestMatch.outcomes || [];
  const getID = (t) => t.token_id || t.asset_id || t.id;

  if (tokens.length < 2) return null;

  return {
    market: bestMatch.question || coin,
    yesToken: getID(tokens[0]),
    noToken: getID(tokens[1]),
    conditionId: bestMatch.conditionId
  };
}

// ====== 3. 实时盘口监控 ======
async function getOrderBook(tokenID) {
  if (!tokenID) return null;
  try {
    const res = await axios.get(`${POLYMARKET_API}/book`, {
      params: { token_id: tokenID },
      timeout: 8000
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
    return null; // 静默跳过，避免报错
  }
}

// ====== 4. 批量获取数据 ======
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

module.exports = {
  fetchAllMarkets,
  resolveTokenID,
  getOrderBook,
  fetchAllTokenData
};
