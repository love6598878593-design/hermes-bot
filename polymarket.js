const fetch = require('node-fetch');

// ==================== 加权币种映射 ====================
const COIN_MAP = {
  bitcoin:  ["btc",  "bitcoin"],
  ethereum: ["eth",  "ethereum"],
  solana:   ["sol", "solana"],
  xrp:      ["xrp", "ripple"],
  doge:     ["doge", "dogecoin"],
  hype:     ["hype", "hyperliquid"],
  bnb:      ["bnb",  "binance"]
};

// 权重：全名 > 缩写
const WEIGHTS = {
  bitcoin: 5, btc: 3,
  ethereum: 5, eth: 3,
  solana: 5, sol: 3,
  xrp: 5, ripple: 4,
  dogecoin: 5, doge: 3,
  hyperliquid: 5, hype: 3,
  binance: 5, bnb: 3
};

// ==================== 带 TTL 的缓存 ====================
let marketCache = [];
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 分钟

// ==================== 工具函数 ====================
function safeJSON(x, fallback = []) {
  try {
    if (!x) return fallback;
    if (Array.isArray(x)) return x;
    return JSON.parse(x);
  } catch {
    return fallback;
  }
}

function parsePrice(p) {
  if (p == null) return null;
  let num = Number(p);
  if (isNaN(num)) return null;
  if (num > 1e4) num = num / 1e6;
  if (num > 1 && num <= 1e4) return num;
  return num;
}

// ==================== 通知 ====================
async function sendNotification(msg) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const cid   = process.env.TELEGRAM_CHAT_ID;
  if (token && cid) {
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: cid, text: msg, parse_mode: "Markdown" })
      });
      console.log("📤 Telegram sent");
    } catch(e) {
      console.error("Telegram error:", e.message);
    }
  } else {
    console.log(`ℹ️ [Console] ${msg}`);
  }
}

// ==================== 格式化单个市场（outcomes 绑定） ====================
function formatResult(m) {
  if (!m) return null;
  const outcomes = safeJSON(m.outcomes);
  const tokens   = safeJSON(m.clobTokenIds);

  if (tokens.length < 2) return null;

  // 用 outcomes 确定 YES/NO 位置
  let yesIdx = 0;
  let noIdx  = 1;

  // 遍历 outcomes，找 Yes/No
  for (let i = 0; i < Math.min(outcomes.length, tokens.length); i++) {
    const label = String(outcomes[i] || "").toLowerCase();
    if (label === "yes") yesIdx = i;
    if (label === "no")  noIdx  = i;
  }

  let yesPrice = null;
  let noPrice  = null;
  if (Array.isArray(m.outcomePrices)) {
    yesPrice = parsePrice(m.outcomePrices[yesIdx]);
    noPrice  = parsePrice(m.outcomePrices[noIdx]);
  }

  return {
    title: m.title || m.slug,
    slug: m.slug,
    yesToken: tokens[yesIdx],
    noToken:  tokens[noIdx],
    yesPrice,
    noPrice,
    outcomes
  };
}

// ==================== 加权 scoring 市场解析器 ====================
function resolveTokenID(markets, coin) {
  const names = COIN_MAP[coin.toLowerCase()] || [coin.toLowerCase()];

  // 选择数据源：优先传入的 markets，其次 TTL 内缓存
  let list;
  if (markets && markets.length > 0) {
    list = markets;
  } else if (Date.now() - cacheTimestamp < CACHE_TTL) {
    list = marketCache;
  } else {
    list = [];
  }

  const scored = list
    .map(m => {
      const slug = (m.slug || "").toLowerCase();
      let score = 0;
      for (const n of names) {
        if (slug.includes(n)) {
          score += WEIGHTS[n] || 1;
        }
      }
      return { m, score };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.length > 0 ? formatResult(scored[0].m) : null;
}

// ==================== 拉取全量市场 ====================
async function fetchAllMarkets() {
  try {
    const res = await fetch(
      "https://gamma-api.polymarket.com/markets?limit=500&active=true&closed=false"
    );
    const data = await res.json();
    const active = (Array.isArray(data) ? data : []).filter(m => m.active && !m.closed);
    marketCache = active;
    cacheTimestamp = Date.now();
    console.log(`📦 Polymarket: ${active.length} 个活跃市场`);
    return active;
  } catch(e) {
    console.error("fetchAllMarkets error:", e.message);
    // 仅 TTL 内返回缓存
    if (Date.now() - cacheTimestamp < CACHE_TTL) {
      console.log("⚠️ 使用缓存数据");
      return marketCache;
    }
    return [];
  }
}

module.exports = {
  sendNotification,
  resolveTokenID,
  fetchAllMarkets,
  getMarketPrices: async () => ({})
};
