/**
 * Polymarket 核心模块 - 变量诊断增强版
 */
const axios = require("axios");

// ====== 强制环境变量自检 ======
function getEnv(key) {
    // 优先读取 process.env，如果没读到再次尝试手动读取
    const val = process.env[key];
    if (!val) {
        // 如果依然缺失，这里会打印到 Railway 日志，帮你瞬间定位
        console.warn(`⚠️  [Environment Warning]: 缺失变量 ${key}`);
    }
    return val;
}

// ====== 1. Telegram 发送逻辑 (带诊断) ======
async function sendNotification(message) {
  const token = getEnv("TELEGRAM_BOT_TOKEN");
  const chatId = getEnv("TELEGRAM_CHAT_ID");

  if (!token || !chatId) {
    // 只要日志里出现这行，说明 Railway 的 Variables 页面还是有问题
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
    
    if (res.data && res.data.ok) {
        console.log("✅ [Telegram]: 消息送达成功");
    }
  } catch (err) {
    // 如果报错 401: Token不对；如果报错 400: ChatID不对或没点Start
    console.error("❌ [Telegram]: 发送失败 -", err.response?.data?.description || err.message);
  }
}

// ====== 2. 市场数据抓取 (原有逻辑) ======
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

// 导出必要的函数
module.exports = {
  fetchAllMarkets,
  sendNotification,
  // 确保你其他的 resolveTokenID, getOrderBook 等函数也在这里导出
};
