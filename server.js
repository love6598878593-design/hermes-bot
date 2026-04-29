require("dotenv").config();

const {
  sendNotification,
  fetchAllMarkets,
  resolveTokenID,
  getMarketPrices
} = require("./polymarket");

const INTERVAL = 60 * 1000; // 1分钟

async function main() {
  console.log("🤖 Hermes Bot started...\n");

  let cycle = 0;

  setInterval(async () => {
    cycle++;
    console.log(`\n🤖 Cycle #${cycle}...`);

    try {
      // 1️⃣ 拉市场
      const markets = await fetchAllMarkets();

      if (!markets.length) {
        console.log("❌ 没有获取到市场");
        return;
      }

      // 2️⃣ 获取目标币（这里只是示例）
      const coins = ["bitcoin", "ethereum", "solana"];

      let report = `📊 *Polymarket 市场扫描*\n⏱ Cycle: ${cycle}\n\n`;

      for (const coin of coins) {
        try {
          const m = resolveTokenID(markets, coin);

          if (!m) {
            report += `❌ ${coin.toUpperCase()}: Market not found\n`;
            continue;
          }

          report += `🪙 *${coin.toUpperCase()}*\n`;
          report += `• ${m.title}\n`;
          report += `• YES: \`${m.yesToken}\`\n`;
          report += `• NO : \`${m.noToken}\`\n\n`;

        } catch (e) {
          report += `❌ ${coin.toUpperCase()} error\n`;
        }
      }

      // 3️⃣ 输出 + 推送
      console.log(report);
      await sendNotification(report);

    } catch (err) {
      console.error("❌ 主循环错误:", err.message);
    }

  }, INTERVAL);
}

main();
