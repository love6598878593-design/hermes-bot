/**
 * 风控系统
 * 防爆仓、限亏损、控仓位
 */

const MAX_CONSECUTIVE_LOSSES = 3;
const MAX_DAILY_LOSS = -50;
const MAX_SINGLE_TRADE = 40;
const MAX_TRADES_PER_CYCLE = 3;

let lossStreak = 0;
let totalTrades = 0;
let sessionStartTime = Date.now();
let cycleTradeCount = 0;

/**
 * 检查是否允许交易
 * @param {object} signal - 交易信号
 * @param {number} totalProfit - 当前总利润
 */
function checkRisk(signal, totalProfit) {
  if (!signal || !signal.action) return false;

  // 1. 单笔大小限制
  if (signal.size > MAX_SINGLE_TRADE) {
    console.log(`   ⛔ Trade size $${signal.size} > max $${MAX_SINGLE_TRADE}`);
    return false;
  }
  if (signal.size < 1) {
    console.log(`   ⛔ Trade size $${signal.size} too small`);
    return false;
  }

  // 2. 连续亏损熔断
  if (lossStreak >= MAX_CONSECUTIVE_LOSSES) {
    console.log(`   ⛔ ${lossStreak} consecutive losses — cooling down`);
    return false;
  }

  // 3. 全局日亏损限额（基于 session 总利润）
  if (totalProfit < MAX_DAILY_LOSS) {
    console.log(`   ⛔ Session loss limit: $${totalProfit.toFixed(2)} < $${MAX_DAILY_LOSS}`);
    return false;
  }

  // 4. 单 cycle 交易数限制
  if (cycleTradeCount >= MAX_TRADES_PER_CYCLE) {
    console.log(`   ⛔ Max ${MAX_TRADES_PER_CYCLE} trades this cycle`);
    return false;
  }

  return true;
}

/**
 * 记录盈亏结果
 */
function recordPnL(profit) {
  totalTrades++;

  if (profit < 0) {
    lossStreak++;
  } else {
    lossStreak = 0;
  }

  // 记录 cycle 交易数
  cycleTradeCount++;
}

/**
 * 重置 cycle 计数器（每轮 bot 循环开始时调用）
 */
function resetCycleCounter() {
  cycleTradeCount = 0;
}

/**
 * 获取风控摘要
 */
function getRiskSummary() {
  return {
    lossStreak,
    totalTrades,
    uptime: Math.floor((Date.now() - sessionStartTime) / 1000) + 's',
    cycleTrades: cycleTradeCount
  };
}

/**
 * 手动重置所有风控状态
 */
function resetRisk() {
  lossStreak = 0;
  totalTrades = 0;
  cycleTradeCount = 0;
  sessionStartTime = Date.now();
}

module.exports = { checkRisk, recordPnL, resetCycleCounter, getRiskSummary, resetRisk };
