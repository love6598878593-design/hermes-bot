require("dotenv").config();
const express = require("express");
const { getSignal } = require("./strategy");
const { executeTrade, getTradeStats } = require("./exchange");
const { checkRisk, recordPnL, resetCycleCounter, getRiskSummary } = require("./risk");
const { updateMarketData } = require("./market");
const polymarket = require("./polymarket"); // 引入我们修改后的 polymarket.js

// =========================
//    🔥 基础状态
// =========================
const COINS = ["BTC", "ETH", "SOL", "XRP", "DOGE", "HYPE", "BNB"];
let marketData = {};
let tradeCount = 0;
let totalProfit = 0;
let botStartTime = Date.now();
let isRunning = true;
let lastHeartbeat = Date.now();

// =========================
//    🚀 Express 服务
// =========================
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 8080; // Railway 通常使用 8080

// ❤️ Health Check 接口
app.get("/health", (req, res) => {
  res.json({
    status: isRunning ? "ok" : "stopped",
    uptime: Math.floor((Date.now() - botStartTime) / 1000),
    timestamp: new Date().toISOString(),
    cycles: tradeCount,
    profit: totalProfit.toFixed(2),
    risk: getRiskSummary()
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Hermes Server running on port ${PORT}`);
});

// =========================
//    🔥 交易主循环
// =========================
async function runBot() {
  if (!isRunning) return;

  let cyclePnL = 0;
  console.log(`\n[${new Date().toISOString()}] 🤖 Cycle #${++tradeCount}...`);

  try {
    // 1. 重置 cycle 风险计数
    resetCycleCounter();

    // 2. 获取市场数据 (这里会触发 polymarket.js 中的 1000 个市场抓取)
    marketData = await updateMarketData(COINS);
    
    // 3. 对每个币种生成信号并执行
    for (const coin of COINS) {
      const data = marketData[coin];
      if (!data || !data.found) continue;

      const signal = await getSignal(coin, data, marketData);
      
      if (!signal) {
        console.log(`   ${coin}: No signal`);
        continue;
      }

      // 4. 风险检查
      const allowed = checkRisk(signal, totalProfit);
      if (!allowed) {
        console.log(`   ${coin}: ⛔ Risk blocked`);
        continue;
      }

      // 5. 执行交易
      const result = await executeTrade(coin, signal, marketData);
      if (result && result.success) {
        const pnl = result.profit || 0;
        cyclePnL += pnl;
        totalProfit += pnl;
        recordPnL(pnl);
        
        console.log(`   ${coin}: ✅ ${signal.action} Success | PnL: $${pnl.toFixed(4)}`);
        
        // 实时推送交易成功到 Telegram
        await polymarket.sendNotification(
          `✅ *交易执行成功*\n` +
          `• 币种: ${coin}\n` +
          `• 动作: ${signal.action}\n` +
          `• 收益: $${pnl.toFixed(4)}\n` +
          `• 累计总额: $${totalProfit.toFixed(2)}`
        );
      }
    }

    console.log(`   Cycle PnL: $${cyclePnL.toFixed(4)} | Total: $${totalProfit.toFixed(4)}`);

  } catch (err) {
    console.error(`   ❌ Cycle Error:`, err.message);
    // 发生严重错误时推送 TG
    await polymarket.sendNotification(`🚨 *运行异常*: ${err.message}`);
  }
}

// =========================
//    💓 心跳 (每分钟打印)
// =========================
setInterval(() => {
  lastHeartbeat = Date.now();
  const uptime = Math.floor((Date.now() - botStartTime) / 1000);
  console.log(`💓 HEARTBEAT | uptime: ${uptime}s | trades: ${tradeCount} | PnL: $${totalProfit.toFixed(2)}`);
}, 60 * 1000);

// =========================
//    🚨 崩溃保护
// =========================
process.on("uncaughtException", async (err) => {
  console.error("💥 UNCAUGHT:", err);
  await polymarket.sendNotification(`💥 *程序崩溃 (Uncaught)*: ${err.message}`);
  setTimeout(() => process.exit(1), 1000);
});

process.on("unhandledRejection", async (err) => {
  console.error("💥 UNHANDLED REJECTION:", err);
  await polymarket.sendNotification(`💥 *Promise 拒绝错误*: ${err.message || err}`);
});

// =========================
//    🚀 启动逻辑
// =========================
const interval = parseInt(process.env.TRADE_INTERVAL_MS || "60000");

console.log("🚀 Hermes Bot starting...");
console.log(`   Coins: ${COINS.join(", ")}`);
console.log(`   Interval: ${interval}ms`);

// 启动后立即推送一条 TG 消息确认链路通畅
polymarket.sendNotification("🟢 *Hermes Bot 已在 Railway 启动成功*\n正在监听 Polymarket 套利机会...");

// 立即运行一次，随后进入定时循环
runBot();
setInterval(runBot, interval);
