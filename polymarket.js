const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

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

// ==================== 噪音过滤词 ====================
const NOISE_WORDS = ["gta", "solanke", "football", "soccer", "movie", "album", "megaeth", "halving", "grammy", "president", "election"];

// ==================== 带 TTL 的缓存 ====================
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

  const url = `https://clob.polymarket.com/book?token_id=${tokenId}`;
  console.log(`📡 getOrderBook: ${url}`);

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    console.log(`📡 getOrderBook status: ${res.status}`);

    if (!res.ok) {
      console.error(`getOrderBook HTTP ${res.status}`);
      return null;
    }

    const text = await res.text();

    // 检测 HTML 响应（Cloudflare 拦截）
    if (text.startsWith('<')) {
      console.error('getOrderBook: 收到 HTML 响应 (Cloudflare 拦截)');
      return null;
    }

    const data = JSON.parse(text);

    const bestBid = data.bids?.[0]?.price || data.bestBid || null;
    const bestAsk = data.asks?.[0]?.price || data.bestAsk || null;

    if (!bestBid || !bestAsk) {
      console.error('getOrderBook: 无有效 bid/ask');
      return null;
    }

    console.log(`✅ Bid: ${bestBid}, Ask: ${bestAsk}`);
    return { bestBid, bestAsk };

  } catch (e) {
    console.error('getOrderBook error:', e.message);
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
  saveTradeState({ hasTraded, lastTradeTime });
  return await placeOrder(token, side, 1);
}

// ==================== 市场解析（纯净版，只返回 token） ====================
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
      const text = `${m.slug || ""} ${m.question || m.title || ""}`.toLowerCase();
      let score = 0;
      for (const n of names) {
        if (text.includes(n)) score += (WEIGHTS[n] || 2);
      }
      if (NOISE_WORDS.some(w => text.includes(w))) score -= 5;
      return { m, score };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return null;

  const found = scored[0].m;
  const tokens = safeJSON(found.clobTokenIds || found.outcomes);

  if (!tokens || tokens.length < 2) return null;

  return {
    title: found.question || found.title || found.slug,
    slug: found.slug,
    yesToken: tokens[0],
    noToken: tokens[1]
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
