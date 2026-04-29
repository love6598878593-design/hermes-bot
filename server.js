require("dotenv").config();
const express = require("express");
const polymarket = require("./polymarket"); 
const { executeTrade } = require("./exchange");
const { checkRisk, resetCycleCounter } = require("./risk");
// 确保 strategy.js 存在且导出 getSignal
const strategy = require("./strategy"); 

const COINS = ["BTC", "ETH", "SOL", "XRP", "DOGE", "HYPE", "BNB"];
let tradeCount = 0;
let totalProfit = 0;

const app = express();
const PORT = process.env.PORT || 8080;

app.get("/health", (req, res) => {
  res.json({ status: "running", cycles: tradeCount, profit: totalProfit.toFixed(2) });
});
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

async function runBot() {
  console.log(`\n[${new Date().toISOString()}] 🤖 Cycle #${++tradeCount}...`);
  try {
    const markets = await polymarket.fetchAllMarkets();
    resetCycleCounter();
    
    for (const coin of COINS) {
      try {
        const data = polymarket.resolveTokenID(markets, coin);
        if (!data) {
          console.log(`   ${coin}: Market not found`);
          continue;
        }

        // 统一传参结构
        const signal = await strategy.getSignal(coin, data);
        if (signal && checkRisk(signal, totalProfit)) {
          const result = await executeTrade(coin, signal, { [coin]: data });
          if (result?.success) {
            totalProfit += (result.profit || 0);
            await polymarket.sendNotification(`✅ *交易成功*: ${coin} ${signal.action} +$${result.profit}`);
          }
        }
      } catch (coinErr) {
        console.error(`   ❌ ${coin} 处理出错:`, coinErr.message);
      }
    }
  } catch (err) {
    console.error(`❌ 全局循环错误:`, err.message);
  }
}

// 启动通知
polymarket.sendNotification("🟢 *Hermes Bot 已启动*").catch(() => {});

const interval = process.env.TRADE_INTERVAL_MS || 60000;
setInterval(runBot, interval);
runBot();
