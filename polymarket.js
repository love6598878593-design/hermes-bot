const fetch = require('node-fetch');

// ============================================================
// 辅助函数：从匹配的市场中提取 token 信息
// ============================================================
function resolveFromMatch(market) {
  if (!market) return null;
  let tokens = market.tokens || market.outcomes || [];
  if (!Array.isArray(tokens)) tokens = Object.values(tokens);
  if (tokens.length < 2) return null;
  
  let yesToken = null;
  let noToken = null;
  
  for (const t of tokens) {
    const outcome = (t.outcome || t.label || t.title || "").toLowerCase();
    const id = t.token_id || t.id || t.tokenId || null;
    if (outcome === "yes" || outcome === "up") yesToken = id;
    else if (outcome === "no" || outcome === "down") noToken = id;
  }
  
  if (!yesToken) yesToken = tokens[0]?.token_id || tokens[0]?.id || tokens[0]?.tokenId;
  if (!noToken) noToken = tokens[1]?.token_id || tokens[1]?.id || tokens[1]?.tokenId;
  
  return {
    market: market.question || market.title || market.slug,
    token0: yesToken,
    token1: noToken,
    yesToken: yesToken,
    noToken: noToken
  };
}

// ============================================================
// 核心函数：根据币种解析 Polymarket Token ID
// ============================================================
function resolveTokenID(markets, coin) {
  if (!markets || !Array.isArray(markets)) return null;
  
  const keywords = {
    BTC: ["btc", "bitcoin"],
    ETH: ["eth", "ethereum"],
    SOL: ["sol", "solana"],
    XRP: ["xrp"],
    DOGE: ["doge", "dogecoin"],
    HYPE: ["hype", "hyperliquid"],
    BNB: ["bnb"]
  };
  
  const kws = keywords[coin] || [coin.toLowerCase()];
  
  // 第一步：匹配 Up/Down 类型市场
  const match = markets.find(m => {
    const title = (m.question || m.title || "").toLowerCase();
    const slug = (m.slug || m.eventSlug || "").toLowerCase();
    const combined = title + " " + slug;
    return kws.some(kw => combined.includes(kw)) &&
           (combined.includes("up") || combined.includes("down") || combined.includes("updown"));
  });
  
  if (match) return resolveFromMatch(match);
  
  // 第二步：回退，不限类型
  const fallback = markets.find(m => {
    const title = (m.question || m.title || "").toLowerCase();
    const slug = (m.slug || m.eventSlug || "").toLowerCase();
    const combined = title + " " + slug;
    return kws.some(kw => combined.includes(kw));
  });
  
  return fallback ? resolveFromMatch(fallback) : null;
}

// ============================================================
// 获取市场价格
// ============================================================
async function getMarketPrices(markets) {
  const coins = ["BTC", "ETH", "SOL", "XRP", "DOGE", "HYPE", "BNB"];
  const results = {};

  for (const coin of coins) {
    const resolved = resolveTokenID(markets, coin);
    if (resolved) {
      console.log(`✅ ${coin}: ${resolved.market}`);
      results[coin] = resolved;
    } else {
      console.log(`❌ ${coin}: Market not found`);
    }
  }

  return results;
}

// ============================================================
// 获取 Polymarket 数据
// ============================================================
async function fetchPolymarkets() {
  try {
    const res = await fetch("https://gamma-api.polymarket.com/events?limit=1000&closed=false");
    const data = await res.json();
    console.log(`   📦 Polymarket: 成功解析 ${data.length} 个市场`);
    return data;
  } catch (err) {
    console.error("❌ Polymarket 获取失败:", err.message);
    return [];
  }
}

module.exports = {
  resolveTokenID,
  resolveFromMatch,
  getMarketPrices,
  fetchPolymarkets
};
