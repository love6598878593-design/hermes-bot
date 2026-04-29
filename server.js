require('dotenv').config();
const fs = require('fs');
const path = require('path');

// ==================== 实例锁 ====================
const LOCK_FILE = '/tmp/hermes.lock';
try {
  const pid = fs.readFileSync(LOCK_FILE, 'utf8');
  console.log(`⚠️ 已有实例 (PID: ${pid})，退出`);
  process.exit(0);
} catch (e) {
  fs.writeFileSync(LOCK_FILE, String(process.pid));
}
process.on('exit', () => { try { fs.unlinkSync(LOCK_FILE); } catch(e) {} });
process.on('SIGTERM', () => { try { fs.unlinkSync(LOCK_FILE); } catch(e) {} process.exit(0); });

// ==================== 模块导入 ====================
const {
  sendNotification,
  resolveMarket,
  fetchAllMarkets,
  getBalance,
  safeTrade: executeTrade
} = require('./polymarket');

// ==================== 宪法读取 ====================
function loadRule(name) {
  try { return fs.readFileSync(path.join(__dirname, 'hermes-os', `${name}.md`), 'utf8'); }
  catch { return ''; }
}
const LAWS = {
  SOUL: loadRule('SOUL'),
  STRATEGY: loadRule('STRATEGY'),
  EXECUTION: loadRule('EXECUTION'),
  STATE_MACHINE: loadRule('STATE_MACHINE')
};
console.log('📜 宪法加载完成');

// ==================== 配置 ====================
const CONFIG = {
  INTERVAL: 30_000,
  COINS: ['bitcoin', 'ethereum', 'solana'],
  DEAD_ZONE: 0.002,
  REGIME_STABILITY_TICKS: 2,
  VOL_HISTORY_SIZE: 20,
  MIN_SIGNAL_STRENGTH: 0.2,
  AI_COOLDOWN: 5 * 60 * 1000,
  AI_OVERRIDE_SIGNAL: 0.35,
  BLOCKED_REGIMES: ['CHOP', 'INIT'],
  AI_BLOCKED_REGIMES: ['CHOP', 'LOW_VOL']
};

// ==================== 工具 ====================
const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
const stddev = arr => {
  if (!arr.length) return 0;
  const m = avg(arr);
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length);
};

// ==================== 状态持久化 ====================
const STATE_FILE = path.join('/tmp', 'hermes_v5_state.json');
function saveState(s) {
  try {
    const min = {};
    for (const c of CONFIG.COINS) {
      min[c] = {
        emaShort: s[c].emaShort, emaLong: s[c].emaLong,
        regime: s[c].regime, regimeStableCount: s[c].regimeStableCount,
        position: s[c].position, lastDecisionTime: s[c].lastDecisionTime
      };
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(min));
  } catch {}
}
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return null; }
}

// ==================== 初始化状态 ====================
let state = {};
const saved = loadState();
for (const c of CONFIG.COINS) {
  state[c] = {
    emaShort: saved?.[c]?.emaShort ?? null,
    emaLong: saved?.[c]?.emaLong ?? null,
    momentum: 0, absVolatility: 0, zVolatility: 0,
    volHistory: saved ? [0.005] : [],
    regime: saved?.[c]?.regime ?? 'INIT',
    regimeStableCount: saved?.[c]?.regimeStableCount ?? 0,
    regimeLastChange: 0,
    signalStrength: 0,
    lastDecisionTime: saved?.[c]?.lastDecisionTime ?? 0,
    position: saved?.[c]?.position ?? 'FLAT',
    lastPrice: null
  };
}
if (saved) console.log('📀 状态已恢复');

// ==================== 量化引擎 ====================
function aiThreshold(zVol) { return 0.12 + Math.abs(zVol) * 0.6; }
function classifyRegime(zVol, momentum) {
  if (zVol < -0.5) return 'LOW_VOL';
  if (Math.abs(momentum) > 0.004) return 'TREND';
  return 'CHOP';
}

function updateEngine(coin, currentProb) {
  const s = state[coin];
  if (s.lastPrice === currentProb) {
    return { signalStrength: s.signalStrength, momentum: s.momentum, regime: s.regime,
             zVol: s.zVolatility, shouldAI: false, currentProb };
  }
  s.lastPrice = currentProb;

  if (s.emaShort === null) {
    s.emaShort = currentProb; s.emaLong = currentProb;
    s.volHistory = [0.001]; s.regime = 'INIT';
    return { signalStrength: 0, momentum: 0, regime: 'INIT', zVol: 0, shouldAI: false, currentProb };
  }

  const instantVol = Math.abs(currentProb - s.emaShort);
  const alpha = 0.4 / (1 + instantVol * 15);
  s.emaShort = (currentProb * alpha) + (s.emaShort * (1 - alpha));
  s.emaLong  = (currentProb * (alpha * 0.4)) + (s.emaLong * (1 - alpha * 0.4));

  let mom = s.emaShort - s.emaLong;
  if (Math.abs(mom) < CONFIG.DEAD_ZONE) mom = 0;
  s.momentum = mom;

  s.absVolatility = (instantVol * 0.1) + (s.absVolatility * 0.9);
  s.volHistory.push(s.absVolatility);
  if (s.volHistory.length > CONFIG.VOL_HISTORY_SIZE) s.volHistory.shift();

  const zVol = (s.absVolatility - avg(s.volHistory)) / (stddev(s.volHistory) + 1e-6);
  s.zVolatility = zVol;

  const newRegime = classifyRegime(zVol, mom);
  if (newRegime === s.regime) s.regimeStableCount++;
  else { s.regime = newRegime; s.regimeStableCount = 0; s.regimeLastChange = Date.now(); }

  const structuralShift = (newRegime === 'TREND' && s.regimeStableCount === 0) || Math.abs(mom) > CONFIG.DEAD_ZONE * 2;
  const signalStrength = Math.abs(zVol) > 0 ? Math.abs(mom) / (Math.abs(zVol) + 0.001) : 0;
  s.signalStrength = signalStrength;

  const shouldAI = structuralShift && signalStrength > aiThreshold(zVol) &&
    s.regimeStableCount >= CONFIG.REGIME_STABILITY_TICKS &&
    !CONFIG.AI_BLOCKED_REGIMES.includes(s.regime) &&
    currentProb > 0.1 && currentProb < 0.9 &&
    (Date.now() - s.lastDecisionTime > CONFIG.AI_COOLDOWN);

  if (shouldAI) s.lastDecisionTime = Date.now();

  return { signalStrength, momentum: mom, regime: s.regime, zVol, shouldAI, currentProb };
}

// ==================== Control Plane: 纯规则决策引擎 ====================
function decisionEngine(coin, m, engineOutput) {
  const s = state[coin];
  const { regime, signalStrength, momentum, zVol, shouldAI, currentProb } = engineOutput;

  // 硬阻断规则（从宪法提取）
  if (CONFIG.BLOCKED_REGIMES.includes(regime)) {
    return { allowTrade: false, requireAI: false, reason: `REGIME_BLOCKED:${regime}`, regime, signalStrength, momentum };
  }
  if (s.position !== 'FLAT') {
    return { allowTrade: false, requireAI: false, reason: 'POSITION_OPEN', regime, signalStrength, momentum };
  }
  if (currentProb < 0.1 || currentProb > 0.9) {
    return { allowTrade: false, requireAI: false, reason: 'EXTREME_PROB', regime, signalStrength, momentum };
  }
  if (Date.now() - s.lastDecisionTime < CONFIG.AI_COOLDOWN) {
    return { allowTrade: false, requireAI: false, reason: 'COOLDOWN', regime, signalStrength, momentum };
  }

  // 信号过弱 → 不交易但可 AI 观察
  if (signalStrength < CONFIG.MIN_SIGNAL_STRENGTH) {
    return { allowTrade: false, requireAI: false, reason: 'SIGNAL_WEAK', regime, signalStrength, momentum };
  }

  // 强信号覆盖
  if (signalStrength > CONFIG.AI_OVERRIDE_SIGNAL) {
    return { allowTrade: true, requireAI: false, reason: 'STRONG_SIGNAL', regime, signalStrength, momentum };
  }

  // 正常信号 → 需要 AI 审计
  if (shouldAI && !CONFIG.AI_BLOCKED_REGIMES.includes(regime)) {
    return { allowTrade: false, requireAI: true, reason: 'NEEDS_AI_AUDIT', regime, signalStrength, momentum };
  }

  return { allowTrade: false, requireAI: false, reason: 'NO_TRIGGER', regime, signalStrength, momentum };
}

// ==================== AI 审计层（预留 DeepSeek 接口） ====================
async function aiAudit(coin, decision) {
  const ctx = LAWS.STRATEGY.substring(0, 500);
  const prompt = `You are a trade auditor. Strategy: ${ctx}\n\nSignal: ${coin} regime=${decision.regime} strength=${decision.signalStrength.toFixed(3)}\nReturn JSON: {"approve":true/false,"confidence":0-1,"reason":"..."}`;

  console.log(`🧠 [AI Audit] ${coin} → ${prompt.length} chars prompt ready`);
  // TODO: 接入 DeepSeek
  // const raw = await callDeepSeek(prompt);
  // return JSON.parse(raw);

  // 默认：信号强则通过
  return { approve: decision.signalStrength > 0.3, confidence: 0.7, reason: 'auto' };
}

// ==================== 执行层 ====================
async function executionSandbox(coin, m, decision, aiResult) {
  if (!decision.allowTrade && !(decision.requireAI && aiResult?.approve)) {
    return { executed: false, reason: decision.reason };
  }

  const finalAllow = decision.allowTrade || (decision.requireAI && aiResult?.approve);
  if (!finalAllow) {
    return { executed: false, reason: 'AI_REJECTED' };
  }

  const trade = await executeTrade(coin, m.yesToken, m.noToken, decision.currentProb || m.yesPrice);
  if (trade) {
    state[coin].position = 'LONG';
    state[coin].lastDecisionTime = Date.now();
    saveState(state);
    return { executed: true, reason: decision.requireAI ? 'AI_APPROVED' : 'STRONG_SIGNAL' };
  }

  return { executed: false, reason: 'EXECUTION_FAILED' };
}

// ==================== 主循环 ====================
let mainInterval = null;

async function main() {
  if (mainInterval) clearInterval(mainInterval);
  console.log('🏛️ Hermes V5 Production Engine 启动\n');

  try {
    const balance = await getBalance();
    if (balance) await sendNotification(`💰 *余额: $${balance.balance || 'N/A'}`);
  } catch {}

  let markets = await fetchAllMarkets();
  let cycle = 0;

  mainInterval = setInterval(async () => {
    cycle++;
    console.log(`\n🏛️ Cycle #${cycle}`);

    try {
      if (cycle % 3 === 0) markets = await fetchAllMarkets();
      let report = `📊 *Hermes V5 PROD*\n⏱ Cycle: ${cycle}\n\n`;

      for (const coin of CONFIG.COINS) {
        const m = resolveMarket(markets, coin);
        if (!m) { report += `❌ ${coin.toUpperCase()}: 无市场\n`; continue; }
        if (m.yesPrice == null) { report += `🪙 *${coin.toUpperCase()}*\n• ${m.title}\n• 价格缺失\n\n`; continue; }

        // Layer 1: Engine
        const engineOutput = updateEngine(coin, m.yesPrice);

        // Layer 2: Control Plane
        const decision = decisionEngine(coin, m, engineOutput);

        // Layer 3: AI Audit (only if needed)
        let aiResult = null;
        if (decision.requireAI) {
          aiResult = await aiAudit(coin, decision);
        }

        // Layer 4: Execution Sandbox
        const execution = decision.allowTrade || decision.requireAI ?
          await executionSandbox(coin, m, decision, aiResult) : { executed: false, reason: decision.reason };

        const dir = decision.momentum > 0 ? '📈' : decision.momentum < 0 ? '📉' : '➡️';
        report += `🪙 *${coin.toUpperCase()}*\n`;
        report += `• ${m.title}\n`;
        report += `• YES $${m.yesPrice.toFixed(4)} | EMA: ${(state[coin].emaShort || 0).toFixed(4)}\n`;
        report += `• 动量: ${decision.momentum >= 0 ? '+' : ''}${decision.momentum.toFixed(5)} ${dir}\n`;
        report += `• 信号: ${decision.signalStrength.toFixed(3)} | Regime: ${decision.regime}\n`;
        report += `• 决策: ${decision.reason}`;
        if (aiResult) report += ` | AI: ${aiResult.approve ? '✅' : '❌'}`;
        if (execution.executed) report += ` | ✅ 已执行`;
        report += `\n\n`;
      }

      console.log(report);
      await sendNotification(report);
    } catch (err) { console.error('❌', err.message); }
  }, CONFIG.INTERVAL);
}

main().catch(console.error);
