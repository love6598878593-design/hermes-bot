/**
 * 交易所执行层
 * 对接 Polymarket CLOB API（通过 polymarket.js） + Binance API
 */

const { getOrderBook, placeLimitOrder, marketTake } = require("./polymarket");

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
 * 自动使用 marketData 中的 tokenID 进行 Polymarket 下单
 */
async function executeTrade(coin, signal, marketData) {
  try {
    let result = null;
    const data = marketData?.[coin];

    switch (signal.action) {
      case "BUY_PM":
      case "SELL_PM": {
        const tokenID = signal.action === "BUY_PM"
          ? data?.yesToken
          : data?.noToken;
        result = await placePolymarketOrder(coin, signal.action === "BUY_PM" ? "BUY" : "SELL", signal.size, tokenID);
        break;
      }
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
 * Polymarket 真实下单
 * 走 CLOB API，自动吃单价成交
 *
 * 需要环境变量:
 *   POLYMARKET_PRIVATE_KEY — Polygon 钱包私钥（用于签名）
 *   POLYMARKET_API_KEY — CLOB API key（可选）
 *
 * 如果没有配 key → 模拟交易
 */
async function placePolymarketOrder(coin, side, size, tokenID) {
  if (!process.env.POLYMARKET_PRIVATE_KEY || !tokenID) {
    // 没配 Key → 模拟
    const profit = simulatePnL(size);
    console.log(`   ${coin}: ⚠️ No PM key or tokenID → simulated $${profit.toFixed(2)}`);
    return { profit, simulated: true };
  }

  try {
    // 真实吃单：根据 side 吃 best ask / best bid
    const result = await marketTake(tokenID, side, size);

    if (!result || !result.success) {
      console.log(`   ${coin}: PM order failed, fallback to sim`);
      const profit = simulatePnL(size);
      return { profit, simulated: true };
    }

    console.log(`   ${coin}: ✅ PM ${side} ${size} @ token ${tokenID.slice(0,10)}... | ID: ${result.orderId?.slice(0,12)}...`);
    return {
      profit: size * 0.025, // 真实交易先估算 2.5%
      simulated: false,
      orderId: result.orderId,
      status: result.status
    };

  } catch (err) {
    console.error(`   ${coin} PM order error: ${err.message}`);
    const profit = simulatePnL(size);
    return { profit, simulated: true };
  }
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
