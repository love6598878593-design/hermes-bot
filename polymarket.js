const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

// ==================== 币种映射 ====================
const COIN_MAP = {
  bitcoin:  { include: ["bitcoin", "btc"], exclude: [] },
  ethereum: { include: ["ethereum", "eth"], exclude: ["megaeth", "netherlands"] },
  solana:   { include: ["solana", "sol"], exclude: ["solanke"] }
};

const WEIGHTS = { bitcoin: 5, btc: 4, ethereum: 5, eth: 4, solana: 5, sol: 4 };

// ==================== 噪音黑名单 ====================
const NOISE_WORDS = [
  "gta", "solanke", "football", "soccer", "movie", "album",
  "megaeth", "halving", "grammy", "president", "election",
  "netherlands", "world cup", "nba", "nhl", "stanley",
  "premier league", "champions league", "uefa", "fifa",
  "senate", "congress", "impeach", "Oscars", "Grammy",
  "reality show", "tv series", "celebrity", "prison", "sentenced"
];

// ==================== 缓存 ====================
let marketCache = [];
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000;

// ==================== 交易安全锁 ====================
const STATE_FILE = path.join('/tmp', 'hermes_trade_state.json');
let hasTraded = {};
let lastTradeTime = {};
const COOLDOWN = 10 * 60 * 1000;
const DRY_RUN = (process.env.DRY_RUN || 'true') !== 'false';

function loadTradeState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}
function saveTradeState(s) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(s)); } catch {}
}
const savedTrade = loadTradeState();
hasTraded = savedTrade.hasTraded || {};
lastTradeTime = savedTrade.lastTradeTime || {};

// ==================== 工具 ====================
function safeJSON(x, fallback = []) {
  try {
    if (!x) return fallback;
    if (Array.isArray(x)) return x;
    return JSON.parse(x);
  } catch { return fallback; }
}

function normalizePrice(p) {
  let num = Number(p);
  if (isNaN(num) || num <= 0) return null;
  if (num > 10000) return num / 1000000;
  if (num > 1) return num / 100;
  return num;
}

// ==================== Telegram ====================
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
    const res = await fetch(`https://clob.polymarket.com/book?token_id=${tokenId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      bestBid: data.bids?.[0]?.price || null,
      bestAsk: data.asks?.[0]?.price || null
    };
  } catch (e) { return null; }
}

// ==================== 余额 ====================
async function getBalance() {
  const pk = process.env.POLYMARKET_PRIVATE_KEY;
  if (!pk) return { balance: "未设置私钥", currency: "USDC" };
  try {
    const res = await fetch("https://clob.polymarket.com/balance", {
      headers: {
        "Authorization": `Bearer ${pk}`,
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0"
      }
    });
    if (!res.ok) return { balance: "离线", currency: "USDC" };
    const data = await res.json();
    return { balance: data.balance || data.usdcBalance || "N/A", currency: "USDC" };
  } catch (e) { return { balance: "离线", currency: "USDC" }; }
}

// ==================== 下单（SDK 优先，CLOB REST 备用） ====================
async function placeOrder(tokenId, side, size) {
  if (DRY_RUN) {
    console.log(`🔸 [DRY RUN] ${side} $${size}`);
    await sendNotification(`🔸 *模拟下单*\n方向: ${side}\n金额: $${size}`);
    return { dryRun: true };
  }

  const pk = process.env.POLYMARKET_PRIVATE_KEY;
  if (!pk) {
    console.error("❌ 缺少私钥，无法下单");
    return null;
  }

  // 方式1: 尝试 SDK
  try {
    const { ClobClient } = require('@polymarket/clob-client');
    const client = new ClobClient({ privateKey: pk, chainId: 137, signatureType: 1 });
    const order = await client.createMarketOrder({ tokenId, side: side === 'yes' ? 'buy' : 'sell', size });
    console.log(`💰 SDK下单成功: ${side} $${size}`);
    await sendNotification(`💰 *实盘下单成功*\n方向: ${side}\n金额: $${size}`);
    return order;
  } catch (sdkErr) {
    console.log('SDK下单失败，尝试REST:', sdkErr.message);
  }

  // 方式2: REST API
  try {
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
    console.log(`💰 REST下单成功: ${side} $${size}`);
    await sendNotification(`💰 *实盘下单成功*\n方向: ${side}\n金额: $${size}`);
    return data;
  } catch (e) {
    console.error('下单失败:', e.message);
    await sendNotification(`❌ *下单失败*\n${e.message}`);
    return null;
  }
}

// ==================== 安全交易 ====================
async function safeTrade(coin, yesToken, noToken, currentProb) {
  if (hasTraded[coin]) { console.log(`🔒 ${coin} 已交易过`); return null; }
  if (Date.now() - (lastTradeTime[coin] || 0) < COOLDOWN) { console.log(`⏳ ${coin} 冷却中`); return null; }
  if (currentProb == null || currentProb < 0.4 || currentProb > 0.6) {
    console.log(`⚠️ ${coin} 价格${currentProb?.toFixed(4)}不在安全区间`);
    return null;
  }
  const side = currentProb >= 0.5 ? "yes" : "no";
  const token = side === "yes" ? yesToken : noToken;
  lastTradeTime[coin] = Date.now();
  hasTraded[coin] = true;
  saveTradeState({ hasTraded, lastTradeTime });
  return await placeOrder(token, side, 1);
}

// ==================== 市场解析 ====================
function resolveMarket(markets, coin) {
  const rules = COIN_MAP[coin.toLowerCase()];
  if (!rules) return null;

  const list = (markets && markets.length > 0) ? markets :
    (Date.now() - cacheTimestamp < CACHE_TTL ? marketCache : []);

  let candidates = list.filter(m => {
    const text = `${m.slug || ""} ${m.question || m.title || ""}`.toLowerCase();
    return rules.include.some(k => text.includes(k));
  });

  candidates = candidates.filter(m => {
    const text = `${m.slug || ""} ${m.question || m.title || ""}`.toLowerCase();
    return !rules.exclude.some(e => text.includes(e));
  });

  candidates = candidates.filter(m => {
    const text = `${m.slug || ""} ${m.question || m.title || ""}`.toLowerCase();
    return !NOISE_WORDS.some(w => text.includes(w));
  });

  if (candidates.length === 0) return null;

  const scored = candidates.map(m => {
    const text = `${m.slug || ""} ${m.question || m.title || ""}`.toLowerCase();
    let score = 0;
    for (const k of rules.include) {
      if (text.includes(k)) score += (WEIGHTS[coin.toLowerCase()] || 2);
    }
    if (/price|above|below|up\b|down\b|today|tomorrow|this week/i.test(text)) score += 5;
    return { m, score };
  }).sort((a, b) => b.score - a.score);

  const found = scored[0].m;
  const tokens = safeJSON(found.clobTokenIds || found.outcomes);
  if (!tokens || tokens.length < 2) return null;

  let yesPrice = null, noPrice = null;
  if (Array.isArray(found.outcomePrices)) {
    yesPrice = normalizePrice(found.outcomePrices[0]);
    noPrice  = normalizePrice(found.outcomePrices[1]);
  }

  return {
    title: found.question || found.title || found.slug,
    slug: found.slug,
    yesToken: tokens[0],
    noToken: tokens[1],
    yesPrice,
    noPrice
  };
}

// ==================== 拉取全量市场 ====================
async function fetchAllMarkets() {
  try {
    const res = await fetch("https://gamma-api.polymarket.com/markets?limit=500&active=true&closed=false");
    const data = await res.json();
    const active = (Array.isArray(data) ? data : []).filter(m => m.active && !m.closed);
    marketCache = active;
    cacheTimestamp = Date.now();
    console.log(`📦 Polymarket: ${active.length} 个活跃市场`);
    return active;
  } catch(e) {
    console.error("fetchAllMarkets error:", e.message);
    if (Date.now() - cacheTimestamp < CACHE_TTL) return marketCache;
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
