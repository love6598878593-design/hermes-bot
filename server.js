require('dotenv').config();

const LOCK_FILE = '/tmp/hermes.lock';
const fs = require('fs');
try {
  const pid = fs.readFileSync(LOCK_FILE, 'utf8');
  console.log(`⚠️ 已有实例 (PID: ${pid})，退出`);
  process.exit(0);
} catch (e) {
  fs.writeFileSync(LOCK_FILE, String(process.pid));
}
process.on('exit', () => { try { fs.unlinkSync(LOCK_FILE); } catch(e) {} });
process.on('SIGTERM', () => { try { fs.unlinkSync(LOCK_FILE); } catch(e) {} process.exit(0); });

const {
  sendNotification,
  getOrderBook,
  resolveMarket,
  fetchAllMarkets,
  getBalance,
  safeTrade,
  normalizePrice
} = require('./polymarket');

const CONFIG = {
  INTERVAL: 30_000,
  AI_COOLDOWN: 5 * 60 * 1000,
  MIN_VOL: 1e-6,
  COINS: ['bitcoin', 'ethereum', 'solana'],
  DEAD_ZONE: 0.002,
  REGIME_STABILITY_TICKS: 2,
  REGIME_STABILITY_MS: 60_000,
  VOL_DECAY: 0.9
};

// ==================== 指数衰减波动率估计器 ====================
let volEstimator = {};
for (const c of CONFIG.COINS) {
  volEstimator[c] = { mean: 0.01, std: 0.005 };
}

function updateVolEstimator(coin, absVol) {
  const v = volEstimator[coin];
  const dev = Math.abs(absVol - v.mean);
  v.mean = CONFIG.VOL_DECAY * v.mean + (1 - CONFIG.VOL_DECAY) * absVol;
  v.std  = CONFIG.VOL_DECAY * v.std  + (1 - CONFIG.VOL_DECAY) * dev;
  return (absVol - v.mean) / (v.std + 1e-6);
}

// ==================== 状态机 ====================
let state = {};
for (const c of CONFIG.COINS) {
  state[c] = {
    emaShort: null,
    emaLong: null,
    momentum: 0,
    absVolatility: 0,
    zVolatility: 0,
    regime: 'INIT',
    regimeStableCount: 0,
    regimeLastChange: 0,
    signalStrength: 0,
    lastDecisionTime: 0
  };
}

function aiThreshold(zVol) {
  const absZ = Math.abs(zVol);
  return 0.12 + absZ * 0.6;
}

function classifyRegime(zVol, momentum) {
  if (zVol < -0.5) return 'LOW_VOL';
  if (Math.abs(momentum) > 0.004) return 'TREND';
  return 'CHOP';
}

function updateV5Core(coin, currentProb) {
  const s = state[coin];

  if (s.emaShort === null) {
    s.emaShort = currentProb;
    s.emaLong = currentProb;
    s.zVolatility = 0;
    s.regime = 'INIT';
    return { signalStrength: 0, momentum: 0, regime: 'INIT', zVol: 0, shouldAI: false };
  }

  const instantVol = Math.abs(currentProb - s.emaShort);
  const alpha = 0.4 / (1 + instantVol * 15);

  s.emaShort = (currentProb * alpha) + (s.emaShort * (1 - alpha));
  s.emaLong  = (currentProb * (alpha * 0.4)) + (s.emaLong * (1 - alpha * 0.4));

  let momentum = s.emaShort - s.emaLong;
  if (Math.abs(momentum) < CONFIG.DEAD_ZONE) momentum = 0;
  s.momentum = momentum;

  s.absVolatility = (instantVol * 0.1) + (s.absVolatility * 0.9);

  const zVol = updateVolEstimator(coin, s.absVolatility);
  s.zVolatility = zVol;

  const newRegime = classifyRegime(zVol, momentum);
  const now = Date.now();

  if (newRegime === s.regime) {
    s.regimeStableCount++;
  } else {
    s.regime = newRegime;
    s.regimeStableCount = 0;
    s.regimeLastChange = now;
  }

  const stableTime = now - s.regimeLastChange;
  const isStable = s.regimeStableCount >= CONFIG.REGIME_STABILITY_TICKS ||
                   stableTime > CONFIG.REGIME_STABILITY_MS;

  const structuralShift =
    (newRegime === 'TREND' && s.regimeStableCount === 0) ||
    Math.abs(momentum) > CONFIG.DEAD_ZONE * 2;

  const signalStrength = Math.abs(momentum) / (Math.abs(zVol) + 0.001);
  s.signalStrength = signalStrength;

  const threshold = aiThreshold(zVol);

  // ✅ 主触发 + 辅约束 + 高信号 override
  const baseTrigger = structuralShift;
  const gatedTrigger = signalStrength > threshold && isStable;
  const highSignalOverride = signalStrength > 0.35;

  const shouldAI =
    baseTrigger &&
    (gatedTrigger || highSignalOverride) &&
    s.regime !== 'CHOP' &&
    currentProb > 0.1 && currentProb < 0.9 &&
    (now - s.lastDecisionTime > CONFIG.AI_COOLDOWN);

  if (shouldAI) s.lastDecisionTime = now;

  return { signalStrength, momentum, regime: s.regime, zVol, shouldAI };
}

// ==================== 主循环 ====================
let mainInterval = null;

async function main() {
  if (mainInterval) clearInterval(mainInterval);
  console.log('🤖 Hermes V5 Final 启动 (单实例)\n');

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
