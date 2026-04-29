  const newRegime = classifyRegime(zVol, momentum);

  // ✅ Regime 稳定窗口
  if (newRegime === s.regime) {
    s.regimeStableCount++;
  } else {
    s.regime = newRegime;
    s.regimeStableCount = 0;
    s.regimeLastChange = Date.now();
  }

  // ✅ 结构性变化检测
  const structuralShift =
    (newRegime === 'TREND' && s.regimeStableCount === 0) ||
    Math.abs(momentum) > CONFIG.DEAD_ZONE * 2;

  // ✅ 信号强度
  const signalStrength = zVol > 0 ? Math.abs(momentum) / (zVol + 0.001) : 0;
  s.signalStrength = signalStrength;

  const threshold = aiThreshold(Math.abs(zVol));

  // ✅ AI 门控：结构性变化 + 信号超阈值 + regime 稳定 + 非 CHOP
  const shouldAI =
    structuralShift &&
    signalStrength > threshold &&
    s.regimeStableCount >= CONFIG.REGIME_STABILITY_TICKS &&
    s.regime !== 'CHOP' &&
    currentProb > 0.1 && currentProb < 0.9 &&
    (Date.now() - s.lastDecisionTime > CONFIG.AI_COOLDOWN);

  if (shouldAI) s.lastDecisionTime = Date.now();

  return { signalStrength, momentum, regime: s.regime, zVol, shouldAI };
}

// ==================== 主循环 ====================
let mainInterval = null;

async function main() {
  if (mainInterval) clearInterval(mainInterval);
  console.log('🤖 Hermes V5 Production Stable 启动 (单实例)\n');

  const balance = await getBalance();
  if (balance) {
    await sendNotification(`💰 *Hermes 余额报告*\n💵 余额: $${balance.balance || 'N/A'}`);
  }

  let markets = await fetchAllMarkets();
  let cycle = 0;

  mainInterval = setInterval(async () => {
    cycle++;
    console.log(`\n🤖 Cycle #${cycle}`);

    try {
      if (cycle % 3 === 0) markets = await fetchAllMarkets();

      let report = `📊 *Hermes V5*\n⏱ Cycle: ${cycle}\n\n`;

      for (const coin of CONFIG.COINS) {
        const m = resolveMarket(markets, coin);
        if (!m) {
          report += `❌ ${coin.toUpperCase()}: 无市场\n`;
          continue;
        }

        const book = await getOrderBook(m.yesToken);
        if (!book) {
          report += `🪙 *${coin.toUpperCase()}*\n• 盘口获取失败\n\n`;
          continue;
        }

        const bid = normalizePrice(book.bestBid);
        const ask = normalizePrice(book.bestAsk);
        if (!bid || !ask) continue;

        const currentProb = (bid + ask) / 2;
        const result = updateV5Core(coin, currentProb);
        const s = state[coin];

        const dir = result.momentum > 0 ? '📈' : result.momentum < 0 ? '📉' : '➡️';
        report += `🪙 *${coin.toUpperCase()}*\n`;
        report += `• ${m.title}\n`;
        report += `• 价格: $${currentProb.toFixed(4)} | EMA: $${s.emaShort.toFixed(4)}\n`;
        report += `• 动量: ${result.momentum >= 0 ? '+' : ''}${result.momentum.toFixed(5)} ${dir}\n`;
        report += `• 信号: ${result.signalStrength.toFixed(3)} | Z-Vol: ${result.zVol.toFixed(2)}\n`;
        report += `• Regime: ${result.regime} (稳定${s.regimeStableCount}t)\n`;
        if (result.shouldAI) report += `🧠 AI 门控触发\n`;

        const trade = await safeTrade(coin, m.yesToken, m.noToken, currentProb);
        if (trade) report += `✅ 交易已执行\n`;

        report += `\n`;
      }

      console.log(report);
      await sendNotification(report);

    } catch (err) {
      console.error('❌', err.message);
    }
  }, CONFIG.INTERVAL);
}

main();
