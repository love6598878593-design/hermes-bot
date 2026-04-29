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
  MIN_VOL: 0.0001,
  COINS: ['bitcoin', 'ethereum', 'solana'],
  PERSISTENCE_STEPS: 5
};

// ==================== Regime Engine 状态机 ====================
let state = {};
for (const c of CONFIG.COINS) {
  state[c] = {
    ema: null,
    volatility: 0.01,
    trendDelta: 0,
    signalStrength: 0,
    regime: 'INIT',
    persistence: 0,
    emaHistory: [],
    lastDecisionTime: 0
  };
}

function classifyRegime(volatility, trendDelta) {
  if (volatility < 0.008) return 'LOW_VOL';
  if (Math.abs(trendDelta) > volatility * 2) return 'TREND';
  return 'CHOP';
}

function updateRegimeEngine(coin, currentProb) {
  const s = state[coin];

  // 初始化
  if (s.ema === null) {
    s.ema = currentProb;
    s.emaHistory = [currentProb];
    s.regime = 'INIT';
    return { signalStrength: 0, trendDelta: 0, regime: 'INIT', persistence: 0 };
  }

  const instantVol = Math.abs(currentProb - s.ema);

  // ✅ 修正：波动越大 alpha 越小（更稳），波动越小 alpha 越大（更敏感）
  const adaptiveAlpha = Math.max(0.08, Math.min(0.35, 0.35 - instantVol * 2));

  const prevEma = s.ema;
  s.ema = (currentProb * adaptiveAlpha) + (s.ema * (1 - adaptiveAlpha));

  // 滚动波动率
  s.volatility = (instantVol * 0.15) + (s.volatility * 0.85);

  const trendDelta = s.ema - prevEma;

  // ✅ 修正：加上 MIN_VOL 防止除零
  const signalStrength = Math.abs(trendDelta) / (s.volatility + CONFIG.MIN_VOL);

  // ✅ persistence：当前 EMA vs N 步前 EMA
  s.emaHistory.push(s.ema);
  if (s.emaHistory.length > CONFIG.PERSISTENCE_STEPS) s.emaHistory.shift();
  const persistence = s.ema - (s.emaHistory[0] || s.ema);

  // ✅ regime 分类
  const regime = classifyRegime(s.volatility, trendDelta);

  s.trendDelta = trendDelta;
  s.signalStrength = signalStrength;
  s.persistence = persistence;
  s.regime = regime;

  return { signalStrength, trendDelta, regime, persistence };
}

// ==================== 主循环 ====================
let mainInterval = null;

async function main() {
  if (mainInterval) clearInterval(mainInterval);
  console.log('🤖 Hermes V3 Regime Engine 启动 (单实例)\n');

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

      let report = `📊 *Polymarket 扫描*\n⏱ Cycle: ${cycle}\n\n`;

      for (const coin of CONFIG.COINS) {
        const m = resolveMarket(markets, coin);
        if (!m) {
          report += `❌ ${coin.toUpperCase()}: 无匹配市场\n`;
          continue;
        }

        const book = await getOrderBook(m.yesToken);
        if (!book) {
          report += `🪙 *${coin.toUpperCase()}*\n• ${m.title}\n• 盘口获取失败\n\n`;
          continue;
        }

        const bid = normalizePrice(book.bestBid);
        const ask = normalizePrice(book.bestAsk);
        if (!bid || !ask) {
          report += `🪙 *${coin.toUpperCase()}*\n• ${m.title}\n• 盘口数据异常\n\n`;
          continue;
        }

        const currentProb = (bid + ask) / 2;
        const { signalStrength, trendDelta, regime, persistence } = updateRegimeEngine(coin, currentProb);
        const s = state[coin];

        // ✅ AI 门控：只在 TREND 且信号强度>0.2 触发，CHOP/LOW_VOL 跳过
        const shouldAI =
          regime === 'TREND' &&
          signalStrength > 0.2 &&
          currentProb > 0.1 && currentProb < 0.9 &&
          (Date.now() - s.lastDecisionTime > CONFIG.AI_COOLDOWN);

        if (shouldAI) s.lastDecisionTime = Date.now();

        const direction = trendDelta > 0 ? '📈' : '📉';
        const persistSign = persistence > 0 ? '↑' : persistence < 0 ? '↓' : '→';
        report += `🪙 *${coin.toUpperCase()}*\n`;
        report += `• ${m.title}\n`;
        report += `• 概率: $${currentProb.toFixed(4)} | EMA: $${s.ema.toFixed(4)}\n`;
        report += `• 信号: ${signalStrength.toFixed(3)} ${direction} | 持续性: ${persistSign}${Math.abs(persistence).toFixed(4)}\n`;
        report += `• Regime: ${regime} | Vol: ${s.volatility.toFixed(4)}\n`;
        if (shouldAI) report += `🧠 AI 门控触发\n`;

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
