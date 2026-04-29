/**
 * Polymarket CLOB API 封装 - 电报推送版
 * 修复内容：
 * 1. 移除 WeChat 推送，替换为 Telegram Bot 推送
 * 2. 增强 Markdown 消息格式化
 * 3. 保持 Railway 环境下的高稳定性抓取
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
const CACHE_TTL = 3 * 60 * 1000; 

// ====== 新增：Telegram 推送函数 ======
async function sendNotification(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.log("   ℹ️ [Internal Log]:", message);
    return;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  try {
    await axios.post(url, {
      chat_id: chatId,
      text: `🤖 *Hermes Bot 交易提醒*\n\n${message}`,
      parse_mode: "Markdown"
    }, { timeout: 5000 });
    console.log("   ✅ Telegram 通知已送达");
  } catch (err) {
    // 仅打印错误，不抛出异常，防止干扰交易逻辑
    console.error("   ❌ Telegram 推送失败:", err.message);
  }
}

// ====== 1. 获取所有活跃市场 ======
async function fetchAllMarkets(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedMarkets && (now - cachedTime) < CACHE_TTL) {
    return cachedMarkets;
  }

  try {
    const res = await axios.get(`${POLYMARKET_API}/markets`, { 
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0' } 
    });

    let rawData = [];
    if (Array.isArray(res.data)) rawData = res.data;
    else if (res.data?.data) rawData = res.data.data;
    else if (res.data?.markets) rawData = res.data.markets;

    if (!Array.isArray(rawData) || rawData.length === 0) {
      return cachedMarkets || [];
    }

    const filtered = rawData.filter(m => 
      m.closed === false && (m.active === true || !m.hasOwnProperty('active'))
    );

    const final = filtered.length > 0 ? filtered : rawData;
    console.log(`    📦 Polymarket: 成功解析 ${final.length} 个市场`);
    
    cachedMarkets = final;
    cachedTime = now;
    return final;
  } catch (err) {
    console.error(`    ❌ 市场数据抓取异常: ${err.message}`);
    return cachedMarkets || [];
  }
}

// ====== 2. 解析 TokenID ======
function resolveTokenID(markets, coin) {
  const keywords = KEYWORD_MAP[coin];
  if (!keywords || !markets.length) return null;

  const matches = markets.filter(m => {
    const title = (m.question || m.description || "").toLowerCase();
    return keywords.some(kw => title.includes(kw));
  });

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
    return null;
  }
}

// ====== 4. 批量获取数据并触发通知 ======
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
    
    // 如果发现异常点位（示例：利差过大），可以调用推送
    // if (book && book.spread > 0.05) { 
    //   sendNotification(`检测到 ${coin} 套利空间: ${book.spread}`); 
    // }

    results[coin] = { ...info, coin, found: !!book, book };
  }
  return results;
}

module.exports = {
  fetchAllMarkets,
  resolveTokenID,
  getOrderBook,
  fetchAllTokenData,
  sendNotification // 导出此函数供 server.js 使用
};
