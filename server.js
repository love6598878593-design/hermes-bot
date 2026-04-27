require("dotenv").config();
const express = require("express");
const fetch = require("node-fetch");
const { getSignal } = require("./strategy");
const { executeTrade, getTradeStats } = require("./exchange");
const { checkRisk, recordPnL, resetCycleCounter, getRiskSummary } = require("./risk");
const { updateMarketData } = require("./market");

// =========================
//   🔥 基础状态
// =========================
const COINS = ["BTC", "ETH", "SOL", "XRP", "DOGE", "HYPE", "BNB"];
let marketData = {};
let tradeCount = 0;
let cyclePnL = 0;
let totalProfit = 0;
let botStartTime = Date.now();
let isRunning = true;
let lastHeartbeat = Date.now();

// =========================
//   🔔 微信通知
// =========================
const WECHAT_WEBHOOK = process.env.WECHAT_WEBHOOK;
async function notify(msg) {
  if (!WECHAT_WEBHOOK) return;
  try {
    await fetch(WECHAT_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ msgtype: "text", text: { content: `[HermesBot] ${msg}` } })
    });
  } catch (e) {
    console.error("WeChat notify failed:", e.message);
  }
}

// =========================
//   ⏱ sleep 工具
// =========================
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// =========================
//   🚀 Express 服务
// =========================
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

// ❤️ health check
app.get("/health", (req, res) => {
  res.json({
    status: isRunning ? "ok" : "stopped",
    uptime: Math.floor((Date.now() - botStartTime) / 1000),
    timestamp: new Date().toISOString(),
    lastHeartbeat,
    cycles: tradeCount,
    profit: totalProfit,
    trades: getTradeStats(),
    risk: getRiskSummary()
  });
});

// 📲 微信控制接口
app.post("/wechat", async (req, res) => {
  const msg = req.body.text?.content || "";

  if (msg === "/status") {
    return res.json({
      reply: `🧠 Hermes运行中\n⏱ uptime: ${Math.floor((Date.now() - botStartTime) / 1000)}s\n💰 PnL: $${totalProfit.toFixed(2)}\n📊 trades: ${tradeCount}`
    });
  }
  if (msg === "/stop") {
    isRunning = false;
    await notify("⛔ Hermes 已停止交易");
  }
  if (msg === "/start") {
    isRunning = true;
    await notify("🚀 Hermes 已恢复运行");
  }
  if (msg === "/pnl") {
    return res.json({ reply: `💰 PnL: $${totalProfit.toFixed(2)}, trades: ${tradeCount}` });
  }

  res.json({ reply: "OK" });
});

app.listen(PORT, () => {
  console.log(`🚀 Hermes running on port ${PORT}`);
});

// =========================
//   🔥 交易主循环
// =========================
async function runBot() {
  if (!isRunning) return;

  cyclePnL = 0;
  console.log(`\n[${new Date().toISOString()}] 🤖 Cycle #${++tradeCount}...`);

  try {
    // 1. 重置 cycle 计数器
    resetCycleCounter();

    // 2. 获取市场数据
    marketData = await updateMarketData(COINS);
    console.log(`   Market: ${Object.keys(marketData).length} coins loaded`);

    // 3. 对每个币生成信号
    for (const coin of COINS) {
      const data = marketData[coin];
      if (!data) continue;

      const signal = await getSignal(coin, data, marketData);
      if (!signal) {
        console.log(`   ${coin}: No signal`);
        continue;
      }

      const allowed = checkRisk(signal, totalProfit);
      if (!allowed) {
        console.log(`   ${coin}: ⛔ Risk blocked`);
        continue;
      }

      const result = await executeTrade(coin, signal, marketData);
      if (result) {
        const pnl = result.profit || 0;
        cyclePnL += pnl;
        totalProfit += pnl;
        recordPnL(pnl);
        console.log(`   ${coin}: ✅ ${signal.action} $${signal.size} | PnL: $${pnl.toFixed(2)}`);
      }
    }

    console.log(`   Cycle PnL: $${cyclePnL.toFixed(2)} | Total: $${totalProfit.toFixed(2)}`);
    console.log(`   ${JSON.stringify(getRiskSummary())}`);

  } catch (err) {
    console.error(`   ❌ Error:`, err.message);
    await notify(`❌ Cycle error: ${err.message}`);
  }
}

// =========================
//   💓 心跳（防假死）
// =========================
setInterval(() => {
  lastHeartbeat = Date.now();
  console.log(`💓 HEARTBEAT | uptime: ${Math.floor((Date.now() - botStartTime) / 1000)}s | trades: ${tradeCount} | PnL: $${totalProfit.toFixed(2)}`);
}, 60 * 1000);

// =========================
//   🚨 崩溃保护
// =========================
process.on("uncaughtException", async (err) => {
  console.error("💥 UNCAUGHT:", err);
  await notify(`🚨 Hermes崩溃: ${err.message}`);
  process.exit(1);
});

process.on("unhandledRejection", async (err) => {
  console.error("💥 UNHANDLED REJECTION:", err);
  await notify(`🚨 Promise错误: ${err}`);
});

// =========================
//   🚀 启动
// =========================
console.log("🚀 Hermes Bot starting...");
console.log(`   Coins: ${COINS.join(", ")}`);
console.log(`   Interval: ${process.env.TRADE_INTERVAL_MS || 20000}ms`);

runBot();
setInterval(runBot, parseInt(process.env.TRADE_INTERVAL_MS || "20000"));
notify("🟢 Hermes 已启动");
