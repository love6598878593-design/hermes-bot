require("dotenv").config();
const express = require("express");
const polymarket = require("./polymarket"); 
const { getSignal } = require("./strategy");
const { executeTrade, getTradeStats } = require("./exchange");
const { checkRisk, recordPnL, resetCycleCounter, getRiskSummary } = require("./risk");
const { updateMarketData } = require("./market");

const COINS = ["BTC", "ETH", "SOL", "XRP", "DOGE", "HYPE", "BNB"];
let tradeCount = 0;
let totalProfit = 0;
let botStartTime = Date.now();

const app = express();
const PORT = process.env.PORT || 8080;

app.get("/health", (req, res) => {
  res.json({
    status: "running",
    uptime: Math.floor((Date.now() - botStartTime) / 1000),
    cycles: tradeCount,
    profit: totalProfit.toFixed(2)
  });
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

async function runBot() {
  console.log(`\n[${new Date().toISOString()}] 🤖 Cycle #${++tradeCount}...`);
  try {
    resetCycleCounter();
    const markets = await polymarket.fetchAllMarkets();
    
    for (const coin of COINS) {
      const data = polymarket.resolveTokenID(markets, coin);
      if (!data) {
          console.log(`   ${coin}: Market not found`);
          continue;
      }

      const signal = await getSignal(coin, data);
      if (signal && checkRisk(signal, totalProfit)) {
        const result = await executeTrade(coin, signal, { [coin]: data });
        if (result?.success) {
          totalProfit += result.profit;
          await polymarket.sendNotification(`✅ *交易成功*: ${coin} ${signal.action} +$${result.profit}`);
        }
      }
    }
  } catch (err) {
    console.error(`❌ Cycle Error:`, err.message);
  }
}

console.log("🚀 Hermes Bot starting...");
polymarket.sendNotification("🟢 *Hermes Bot 已在 Railway 启动成功*");

setInterval(runBot, process.env.TRADE_INTERVAL_MS || 60000);
runBot();
