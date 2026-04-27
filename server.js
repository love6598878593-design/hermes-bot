require("dotenv").config();
const { getSignal } = require("./strategy");
const { executeTrade } = require("./exchange");
const { checkRisk } = require("./risk");
const { updateMarketData } = require("./market");

// 7 个核心币
const COINS = ["BTC", "ETH", "SOL", "XRP", "DOGE", "HYPE", "BNB"];
let marketData = {};
let tradeCount = 0;
let profitTotal = 0;

async function runBot() {
  console.log(`\n[${new Date().toISOString()}] 🤖 Running bot cycle #${++tradeCount}...`);

  try {
    // 1. 更新市场数据
    marketData = await updateMarketData(COINS);
    console.log(`   Market: ${Object.keys(marketData).length} coins loaded`);

    // 2. 对每个币生成信号
    for (const coin of COINS) {
      const data = marketData[coin];
      if (!data) continue;

      const signal = await getSignal(coin, data, marketData);

      if (!signal) {
        console.log(`   ${coin}: No signal`);
        continue;
      }

      // 3. 风控检查
      const allowed = checkRisk(signal, tradeCount, profitTotal);
      if (!allowed) {
        console.log(`   ${coin}: ⛔ Risk blocked`);
        continue;
      }

      // 4. 执行交易
      const result = await executeTrade(coin, signal);
      if (result) {
        profitTotal += result.profit || 0;
        console.log(`   ${coin}: ✅ ${signal.action} $${signal.size} | PnL: $${result.profit?.toFixed(2) || 'N/A'}`);
      }
    }

    console.log(`   Total PnL: $${profitTotal.toFixed(2)}`);

  } catch (err) {
    console.error(`   ❌ Error:`, err.message);
  }
}

// 启动
console.log("🚀 Hermes Bot starting...");
console.log(`   Coins: ${COINS.join(", ")}`);
console.log(`   Interval: ${process.env.TRADE_INTERVAL_MS || 20000}ms`);

runBot();
setInterval(runBot, parseInt(process.env.TRADE_INTERVAL_MS || "20000"));
