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
const CACHE_TTL = 5 * 60 * 1000;

// ==================== 交易安全锁 ====================
let hasTraded = {};
let lastTradeTime = {};
const COOLDOWN = 10 * 60 * 1000;
const DRY_RUN = (process.env.DRY_RUN || 'true') !== 'false';

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

function normalizePrice(p) {
  let num = Number(p);
  if (isNaN(num) || num <= 0) return null;
  if (num > 10000) return num / 1000000;
  if (num > 1) return num / 100;
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

// ==================== CLOB Orderbook ====================
async function getOrderBook(tokenId) {
  if (!tokenId) return null;
  try {
    const res = await fetch(`https://clob.polymarket.com/orderbook?token_id=${tokenId}`);
    const data = await res.json();
    return {
      bestBid: data.bids?.[0]?.price || '0',
      bestAsk: data.asks?.[0]?.price || '0'
    };
  } catch(e) {
    console.error("getOrderBook error:", e.message);
    return null;
  }
}

// ==================== 余额查询 ====================
async function getBalance() {
  const privateKey = process.env.POLYMARKET_PRIVATE_KEY;
  if (!privateKey) {
    console.log("⚠️ 未设置 POLYMARKET_PRIVATE_KEY，返回模拟余额");
    return { balance: "1.00", currency: "USDC" };
  }

  try {
    const res = await fetch("https://clob.polymarket.com/balance", {
      headers: {
        "Authorization": `Bearer ${privateKey}`,
        "Content-Type": "application/json"
      }
    });

    if (!res.ok) {
      console.error(`❌ 余额查询失败: HTTP ${res.status}`);
      return { balance: "N/A", currency: "USDC" };
    }

    const data = await res.json();
    console.log(`💰 当前余额: $${data.balance || 'N/A'}`);
    return { balance: data.balance || 'N/A', currency: 'USDC' };
  } catch (e) {
    console.error("❌ 余额查询错误:", e.message);
    return { balance: "Error", currency: "USDC" };
  }
}

// ==================== 下单 ====================
async function placeOrder(tokenId, side, size) {
  if (DRY_RUN) {
    console.log(`🔸 [DRY RUN] ${side} $${size} → ${String(tokenId).slice(0,10)}...`);
    await sendNotification(`🔸 *模拟下单*\n方向: ${side}\n金额: $${size}`);
    return { dryRun: true };
  }

  const pk = process.env.POLYMARKET_PRIVATE_KEY;
  if (!pk) throw new Error("缺少私钥");

  const res = await fetch("https://clob.polymarket.com/order", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${pk}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ token_id: tokenId, side, size, type: "market" })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.message || "下单失败");

  console.log(`💰 实盘下单: ${side} $${size}`);
  await sendNotification(`💰 *实盘下单成功*\n方向: ${side}\n金额: $${size}`);
  return data;
}

// ==================== 安全交易 ====================
async function safeTrade(coin, yesToken, noToken, currentProb) {
  if (hasTraded[coin]) { console.log(`🔒 ${coin} 已交易过`); return null; }
  if (Date.now() - (lastTradeTime[coin] || 0) < COOLDOWN) { console.log(`⏳ ${coin} 冷却中`); return null; }
  if (currentProb == null || currentProb < 0.4 || currentProb > 0.6) { console.log(`⚠️ ${coin} 价格${currentProb?.toFixed(4)}不在安全区间`); return null; }
  const side = currentProb >= 0.5 ? "yes" : "no";
  const token = side === "yes" ? yesToken : noToken;
  lastTradeTime[coin] = Date.now();
  hasTraded[coin] = true;
  return await placeOrder(token, side, 1);
}

// ==================== 市场解析 ====================
function resolveMarket(markets, coin) {
  const names = COIN_MAP[coin.toLowerCase()] || [coin.toLowerCase()];

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
      const title = (m.title || m.question || "").toLowerCase();
      let score = 0;
      for (const n of names) {
        if (slug.includes(n)) score += WEIGHTS[n] || 1;
        if (title.includes(n)) score += (WEIGHTS[n] || 1) * 2;
      }
      return { m, score };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return null;

  const found = scored[0].m;
  const outcomes = safeJSON(found.outcomes);
  const tokens = safeJSON(found.clobTokenIds);
  if (tokens.length < 2) return null;

  let yesIdx = 0, noIdx = 1;
  for (let i = 0; i < Math.min(outcomes.length, tokens.length); i++) {
    const label = String(outcomes[i] || "").toLowerCase();
    if (label === "yes") yesIdx = i;
    if (label === "no")  noIdx  = i;
  }

  let yesPrice = null, noPrice = null;
  if (Array.isArray(found.outcomePrices)) {
    yesPrice = normalizePrice(found.outcomePrices[yesIdx]);
    noPrice  = normalizePrice(found.outcomePrices[noIdx]);
  }

  return {
    title: found.question || found.title || found.slug,
    slug: found.slug,
    yesToken: tokens[yesIdx],
    noToken:  tokens[noIdx],
    yesPrice,
    noPrice
  };
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
    if (Date.now() - cacheTimestamp < CACHE_TTL) {
      console.log("⚠️ 使用缓存数据");
      return marketCache;
    }
    return [];
  }
}

// ==================== 导出 ====================
module.exports = {
  sendNotification,
  getOrderBook,
  getBalance,
  placeOrder,
  safeTrade,
  resolveMarket,
  fetchAllMarkets,
  normalizePrice
};
