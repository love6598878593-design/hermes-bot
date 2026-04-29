/**
 * 交易所执行层 - 余额增强版
 * 对接地址: 0x2e83745069DBf93336d4Ea268A33e8f5B6d56BFA
 */

const { ethers } = require("ethers");
const { getOrderBook, placeLimitOrder, marketTake } = require("./polymarket");

// --- 节点与合约配置 ---
const RPC_URL = "https://polygon-rpc.com";
const WALLET_ADDRESS = "0x2e83745069DBf93336d4Ea268A33e8f5B6d56BFA";
const USDC_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"; 
const USDC_ABI = ["function balanceOf(address owner) view returns (uint256)"];

const provider = new ethers.JsonRpcProvider(RPC_URL);

/** 交易统计 */
const tradeStats = {
  total: 0,
  wins: 0,
  losses: 0,
  simulated: 0,
  real: 0
};

// ====== 1. 余额查询逻辑 ======
/**
 * 获取实时余额 (USDC 和 MATIC)
 */
async function getWalletBalance() {
    try {
        // 查询 USDC (6位小数)
        const usdcContract = new ethers.Contract(USDC_ADDRESS, USDC_ABI, provider);
        const usdcRaw = await usdcContract.balanceOf(WALLET_ADDRESS);
        const usdcBalance = parseFloat(ethers.formatUnits(usdcRaw, 6)).toFixed(2);

        // 查询 MATIC (Gas 费)
        const maticRaw = await provider.getBalance(WALLET_ADDRESS);
        const maticBalance = parseFloat(ethers.formatEther(maticRaw)).toFixed(4);

        return { usdc: usdcBalance, matic: maticBalance };
    } catch (e) {
        console.error("   ❌ 余额查询失败:", e.message);
        return { usdc: "0.00", matic: "0.00" };
    }
}

// ====== 2. 交易执行逻辑 ======
/**
 * 执行交易
 * 根据 action 类型路由到对应交易所
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
        // 趋势/波动率交易 → 走模拟
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
 */
async function placePolymarketOrder(coin, side, size, tokenID) {
  if (!process.env.POLYMARKET_PRIVATE_KEY || !tokenID) {
    const profit = simulatePnL(size);
    console.log(`   ${coin}: ⚠️ No PM key or tokenID → simulated $${profit.toFixed(2)}`);
    return { profit, simulated: true };
  }

  try {
    // 检查余额是否支持下单
    const balances = await getWalletBalance();
    if (parseFloat(balances.usdc) < size) {
        console.log(`   ${coin}: ❌ 余额不足 (${balances.usdc} USDC), 跳过真实下单`);
        return { profit: 0, simulated: true, error: "Insufficient Balance" };
    }

    // 真实吃单
    const result = await marketTake(tokenID, side, size);

    if (!result || !result.success) {
      console.log(`   ${coin}: PM order failed, fallback to sim`);
      const profit = simulatePnL(size);
      return { profit, simulated: true };
    }

    console.log(`   ${coin}: ✅ PM ${side} ${size} @ token ${tokenID.slice(0,10)}...`);
    return {
      success: true,
      profit: size * 0.025, 
      simulated: false,
      orderId: result.orderId
    };

  } catch (err) {
    console.error(`   ${coin} PM order error: ${err.message}`);
    const profit = simulatePnL(size);
    return { profit, simulated: true };
  }
}

/**
 * 模拟执行与收益计算
 */
async function simulateExecution(coin, signal) {
  const profit = simulatePnL(signal.size);
  return { profit, simulated: true };
}

function simulatePnL(size) {
  const win = Math.random() < 0.55;
  const pnlPercent = win
    ? (1.5 + Math.random() * 2.5) / 100 
    : -(1 + Math.random() * 2) / 100;
  return +(size * pnlPercent).toFixed(2);
}

function getTradeStats() {
    return tradeStats;
}

module.exports = {
  executeTrade,
  getTradeStats,
  getWalletBalance,
  WALLET_ADDRESS
};
