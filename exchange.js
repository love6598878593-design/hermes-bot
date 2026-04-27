/**
 * 交易所执行层
 * 对接 Polymarket CLOB API + Binance API
 */

const axios = require("axios");

const POLYMARKET_API = "https://clob.polymarket.com";

/** 交易统计 */
const tradeStats = {
  total: 0,
  wins: 0,
  losses: 0,
  simulated: 0,
  real: 0
};

/**
 * 执行交易
 * 根据 action 类型路由到对应交易所
 */
async function executeTrade(coin, signal) {
  try {
    let result = null;

    switch (signal.action) {
      case "BUY_PM":
        result = await placePolymarketOrder(coin, "BUY", signal.size);
        break;
      case "SELL_PM":
        result = await placePolymarketOrder(coin, "SELL", signal.size);
        break;
      case "VOLATILITY":
      case "TREND_UP":
      case "TREND_DOWN":
        // 趋势/波动率交易 → 走模拟（后续可接入 Binance）
        result = await simulateExecution(coin, signal);
        break;
      default:
        console.log(`   ${coin}: Unknown action '${signal.action}'`);
        return null;
    }

    if (result) {
      tradeStats.total++;
      if (result.profit > 0) tradeStats.wins++;
      if (result.profit < 0) tradeStats.losses++;
      if (result.simulated) tradeStats.simulated++;
      else tradeStats.real++;

      console.log(`   📈 ${coin}: ${signal.action} $${signal.size} → $${result.profit.toFixed(2)}`);
    }

    return result;

  } catch (err) {
    console.error(`   ${coin} execute error: ${err.message}`);
    return null;
  }
}

/**
 * Polymarket 下单 (CLOB API)
 */
async function placePolymarketOrder(coin, side, size) {
  if (!process.env.POLYMARKET_API_KEY || !process.env.POLYMARKET_PRIVATE_KEY) {
    // 没配 Key → 模拟
    const profit = simulatePnL(size);
    console.log(`   ${coin}: ⚠️ No PM keys → simulated PnL: $${profit.toFixed(2)}`);
    return { profit, simulated: true };
  }

  // TODO: 真实 Polymarket 签名下单
  // 1. EIP-712 签名
  // 2. POST /order
  // 3. 需要 Polygon wallet
  console.log(`   ${coin}: 🔐 PM order real (PLACEHOLDER)`);
  return { profit: size * 0.015, simulated: false };
}

/**
 * 模拟执行（趋势/波动率）
 */
async function simulateExecution(coin, signal) {
  const profit = simulatePnL(signal.size);
  return { profit, simulated: true };
}

/**
 * 模拟 PnL 计算
 * 55% 胜率，平均赢 +2.5%，平均输 -1.5%
 */
function simulatePnL(size) {
  const win = Math.random() < 0.55;
  const pnlPercent = win
    ? (1.5 + Math.random() * 2.5) / 100   // +1.5% ~ +4%
    : -(1 + Math.random() * 2) / 100;     // -1% ~ -3%
  return +(size * pnlPercent).toFixed(2);
}

/**
 * 获取交易统计
 */
function getTradeStats() {
  return { ...tradeStats, winRate: tradeStats.total > 0 ? (tradeStats.wins / tradeStats.total * 100).toFixed(1) + '%' : '0%' };
}

module.exports = { executeTrade, getTradeStats };
