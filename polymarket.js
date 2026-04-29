/**
 * Polymarket 核心模块 - 全功能整合版
 * 修复: resolveTokenID 导出错误 & Telegram 变量诊断
 */
const axios = require("axios");

// ====== 环境变量自检 ======
function getEnv(key) {
    return process.env[key];
}

// ====== 1. Telegram 发送逻辑 ======
async function sendNotification(message) {
  const token = getEnv("TELEGRAM_BOT_TOKEN");
  const chatId = getEnv("TELEGRAM_CHAT_ID");

  if (!token || !chatId) {
    console.log(`❌ [Telegram Config Error]: Token或ChatID缺失`);
    console.log("ℹ️ [Console Log]:", message);
    return;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const res = await axios.post(url, {
      chat_id: chatId,
      text: message,
      parse_mode: "Markdown"
    }, { timeout: 10000 });
    if (res.data && res.data.ok) console.log("✅ [Telegram]: 消息送达成功");
  } catch (err) {
    console.error("❌ [Telegram]: 发送失败 -", err.response?.data?.description || err.message);
  }
}

// ====== 2. 市场数据抓取 ======
let cachedMarkets = null;
async function fetchAllMarkets() {
  try {
    const res = await axios.get("https://clob.polymarket.com/markets", { timeout: 15000 });
    const data = res.data?.data || res.data || [];
    cachedMarkets = data;
    return data;
  } catch (err) {
    console.error(`    ❌ 市场抓取失败: ${err.message}`);
    return cachedMarkets || [];
  }
}

// ====== 3. 核心工具函数 (修复 resolveTokenID) ======
function resolveTokenID(markets, coin) {
  if (!markets || !Array.isArray(markets)) return null;
  
  const keywords = {
    BTC: ["bitcoin", "btc"],
    ETH: ["ethereum", "eth"],
    SOL: ["solana", "sol"],
    XRP: ["xrp", "ripple"],
    DOGE: ["dogecoin", "doge"],
    HYPE: ["hyperliquid", "hype"],
    BNB: ["bnb", "binance"]
  };

  const kws = keywords[coin];
  if (!kws) return null;

  // 寻找最匹配的价格预测市场
  const match = markets.find(m => {
    const title = (m.question || "").toLowerCase();
    return kws.some(kw => title.includes(kw)) && /price|above|below/.test(title);
  });

  if (!match) return null;

  const tokens = match.tokens || match.outcomes || [];
  return {
    market: match.question,
    yesToken: tokens[0]?.token_id || tokens[0]?.id,
    noToken: tokens[1]?.token_id || tokens[1]?.id,
    conditionId: match.conditionId
  };
}

async function getOrderBook(tokenID) {
  if (!tokenID) return null;
  try {
    const res = await axios.get(`https://clob.polymarket.com/book?token_id=${tokenID}`, { timeout: 8000 });
    const b = res.data.bids || [];
    const a = res.data.asks || [];
    if (!b[0] || !a[0]) return null;
    return {
      bestBid: parseFloat(b[0].price),
      bestAsk: parseFloat(a[0].price),
      spread: parseFloat(a[0].price) - parseFloat(b[0].price)
    };
  } catch (e) { return null; }
}

async function marketTake(tokenID, side, size) {
    // 这是一个占位，实际下单逻辑应调用 CLOB SDK
    console.log(`执行下单: ${side} ${tokenID} Amount: ${size}`);
    return { success: true, orderId: "sim-order-" + Date.now() };
}

// ====== 4. 导出所有模块 ======
module.exports = {
  fetchAllMarkets,
  sendNotification,
  resolveTokenID,
  getOrderBook,
  marketTake
};
