/**
 * 风控系统
 * 防爆仓、限亏损、控仓位
 */

const MAX_CONSECUTIVE_LOSSES = 3;
const MAX_DAILY_LOSS = -50;   // 每日最大亏损 $50
const MAX_SINGLE_TRADE = 50;  // 单笔最大 $50
const MAX_OPEN_POSITIONS = 5; // 最多同时持仓数

let lossStreak = 0;
let openPositions = 0;
let dailyPnL = 0;
let lastResetDay = new Date().getDate();

function checkRisk(signal, tradeCount, totalProfit) {
  if (!signal) return false;

  // 1. 每日盈亏重置
  const today = new Date().getDate();
  if (today !== lastResetDay) {
    dailyPnL = 0;
    lastResetDay = today;
  }
  dailyPnL = totalProfit; // 用总利润代替

  // 2. 单笔大小限制
  if (signal.size > MAX_SINGLE_TRADE) {
    console.log(`   ⛔ Trade size ${signal.size} > max ${MAX_SINGLE_TRADE}`);
    return false;
  }

  // 3. 连续亏损熔断
  if (lossStreak >= MAX_CONSECUTIVE_LOSSES) {
    console.log(`   ⛔ ${lossStreak} consecutive losses, cooling down`);
    return false;
  }

  // 4. 日亏损限额
  if (dailyPnL < MAX_DAILY_LOSS) {
    console.log(`   ⛔ Daily loss limit reached: $${dailyPnL.toFixed(2)}`);
    return false;
  }

  // 5. 最大持仓数
  if (openPositions >= MAX_OPEN_POSITIONS) {
    console.log(`   ⛔ Max ${MAX_OPEN_POSITIONS} positions open`);
    return false;
  }

  return true;
}

// 记录盈亏（供外部调用）
function recordPnL(profit) {
  if (profit < 0) {
    lossStreak++;
  } else {
    lossStreak = 0;
  }

  if (profit > 0) {
    openPositions++;
  } else {
    openPositions = Math.max(0, openPositions - 1);
  }
}

// 手动重置状态
function resetRisk() {
  lossStreak = 0;
  openPositions = 0;
}

module.exports = { checkRisk, recordPnL, resetRisk };
