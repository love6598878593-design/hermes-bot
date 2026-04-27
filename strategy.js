/**
 * 策略引擎 —— 规则做决策，AI 做辅助
 *
 * 核心框架：
 * 1. 规则引擎（主要）：价差、趋势、波动率
 * 2. AI 辅助（可选）：规则产生信号后，AI 做二次确认
 */

const axios = require("axios");

// AI API 配置
const AI_PROVIDER = process.env.AI_PROVIDER || "openai";
const AI_MODEL = process.env.AI_MODEL || "gpt-4o-mini";

// 策略命中统计
const strategyHits = {};

/**
 * 规则引擎：生成交易信号
 * 规则决定买卖，AI 只做过滤/增强
 */
async function getSignal(coin, data) {
  if (!data || !data.success) return null;

  let signal = null;

  // ====== 规则 1: Polymarket vs Binance 套利 ======
  if (data.binancePrice && data.pmPrice !== null && data.pmPrice !== undefined) {
    const priceChange = data.priceChange || 0;
    // pmPrice 是概率 0-1，但因为还不稳定，先用价差
    const binancePctChange = Math.abs(priceChange);

    // 套利信号：Binance 价格变化而 Polymarket 概率滞后
    // Binance 涨 > 0.3% 且还没被 PM 定价 → 套利机会
    if (priceChange > 0.3) {
      signal = {
        action: "BUY_PM",
        size: calcPositionSize(binancePctChange),
        reason: `Arb: Binance +${priceChange.toFixed(2)}%`,
        confidence: Math.min(40 + binancePctChange * 10, 85),
        strategy: "PM_ARB"
      };
    }
    // Binance 跌 > 0.3%
    else if (priceChange < -0.3) {
      signal = {
        action: "SELL_PM",
        size: calcPositionSize(binancePctChange),
        reason: `Arb: Binance ${priceChange.toFixed(2)}%`,
        confidence: Math.min(40 + binancePctChange * 10, 85),
        strategy: "PM_ARB"
      };
    }
  }

  // ====== 规则 2: 波动率交易（纯 Binance） ======
  const vol = data.volatility || 0;
  if (!signal && vol > 1.5) {
    signal = {
      action: "VOLATILITY",
      size: Math.min(Math.round(vol * 8), 40),
      reason: `Vol ${vol.toFixed(1)}% → high movement expected`,
      confidence: Math.min(40 + vol * 10, 80),
      strategy: "VOLATILITY"
    };
  }

  // ====== 规则 3: 趋势跟踪 ======
  if (!signal && data.binancePrice) {
    const pc = data.priceChange || 0;
    if (pc > 0.8) {
      signal = {
        action: "TREND_UP",
        size: 10,
        reason: `Trend: +${pc.toFixed(2)}%`,
        confidence: 55,
        strategy: "TREND"
      };
    } else if (pc < -0.8) {
      signal = {
        action: "TREND_DOWN",
        size: 10,
        reason: `Trend: ${pc.toFixed(2)}%`,
        confidence: 55,
        strategy: "TREND"
      };
    }
  }

  // 统计命中
  if (signal) {
    strategyHits[signal.strategy] = (strategyHits[signal.strategy] || 0) + 1;
    console.log(`   ${coin}: [${signal.strategy}] ${signal.reason}`);
  }

  return signal;
}

/**
 * AI 辅助二次确认
 * 只在有配 API key 时才生效
 */
async function aiConfirm(signal, coin, context) {
  const apiKey = process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return true;

  try {
    const baseURL = AI_PROVIDER === "deepseek"
      ? "https://api.deepseek.com/v1"
      : "https://api.openai.com/v1";

    const res = await axios.post(
      `${baseURL}/chat/completions`,
      {
        model: AI_MODEL,
        messages: [
          {
            role: "system",
            content: "You are a trading risk filter. Reply ONLY with YES or NO. YES = trade is safe, NO = skip."
          },
          {
            role: "user",
            content: `Coin: ${coin}\nSignal: ${signal.action} $${signal.size}\nReason: ${signal.reason}\nVolatility: ${(context.volatility || 0).toFixed(1)}%\nPrice Change: ${(context.priceChange || 0).toFixed(2)}%\n\nTrade? YES or NO`
          }
        ],
        max_tokens: 5,
        temperature: 0.1
      },
      {
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        timeout: 10000
      }
    );

    return (res.data.choices?.[0]?.message?.content?.trim() || "YES") === "YES";
  } catch (err) {
    console.error(`   AI confirm error: ${err.message}`);
    return true;
  }
}

/**
 * 计算仓位大小
 * 信号越强仓位越大，最低 $5，最高 $40
 */
function calcPositionSize(signalStrength) {
  if (signalStrength <= 0) return 5;
  const raw = Math.round(signalStrength * 20);
  // clamp between 5 and 40
  return Math.max(5, Math.min(40, raw));
}

/**
 * 获取策略统计
 */
function getStrategyStats() {
  return { ...strategyHits };
}

module.exports = { getSignal, aiConfirm, getStrategyStats };
