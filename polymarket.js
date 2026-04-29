const axios = require("axios");

// ====== 环境变量自检逻辑 ======
function getEnv(key) {
    const val = process.env[key];
    if (!val) console.warn(`⚠️  [Environment Warning]: 缺失变量 ${key}`);
    return val;
}

// ====== 1. Telegram 发送逻辑 ======
async function sendNotification(message) {
  const token = getEnv("TELEGRAM_BOT_TOKEN");
  const chatId = getEnv("TELEGRAM_CHAT_ID");

  if (!token || !chatId) {
    console.log(`❌ [Telegram Config Error]: Token或ChatID缺失 (Token长度: ${token?.length || 0})`);
    console.log("ℹ️ [Console Fallback]:", message);
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

// ====== 2. 市场解析逻辑 (修复 resolveTokenID) ======
let cachedMarkets = null;
async function fetchAllMarkets() {
  try {
    const res = await axios.get("https://clob.polymarket.com/markets", { timeout: 15000 });
    const data = res.data?.data || res.data || [];
    console.log(`    📦 Polymarket: 成功解析 ${data.length} 个市场`);
    cachedMarkets = data;
    return data;
  } catch (err) {
    console.error(`    ❌ 市场抓取失败: ${err.message}`);
    return cachedMarkets || [];
  }
}

function resolveTokenID(markets, coin) {
  if (!markets || !Array.isArray(markets)) return null;
  const keywords = {
    BTC: ["bitcoin", "btc"], ETH: ["ethereum", "eth"],
    SOL: ["solana", "sol"], XRP: ["xrp", "ripple"],
    DOGE: ["dogecoin", "doge"], HYPE: ["hyperliquid", "hype"],
    BNB: ["bnb", "binance"]
  };
  const kws = keywords[coin];
  if (!kws) return null;

  const match = markets.find(m => {
    const title = (m.question || "").toLowerCase();
    return kws.some(kw => title.includes(kw)) && /price|above|below/.test(title);
  });

  if (!match) return null;
  const tokens = match.tokens || match.outcomes || [];
  return {
    market: match.question,
    yesToken: tokens[0]?.token_id || tokens[0]?.id,
    noToken: tokens[1]?.token_id || tokens[1]?.id
  };
}

// ====== 3. 盘口与执行 ======
async function getOrderBook(tokenID) {
  if (!tokenID) return null;
  try {
    const res = await axios.get(`https://clob.polymarket.com/book?token_id=${tokenID}`);
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
    console.log(`执行下单: ${side} ${tokenID} $${size}`);
    return { success: true, orderId: "sim-" + Date.now() };
}

module.exports = {
  fetchAllMarkets,
  sendNotification,
  resolveTokenID,
  getOrderBook,
  marketTake
};
