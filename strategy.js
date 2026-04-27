/**
 * 策略引擎 —— 规则做决策，AI 做辅助
 * 
 * 核心框架：
 * 1. 规则引擎（主要）：价差、趋势、波动率
 * 2. AI 辅助（可选）：情绪判断、新闻分析
 */

const axios = require("axios");

// AI API 配置
const AI_PROVIDER = process.env.AI_PROVIDER || "openai"; // openai | deepseek
const AI_MODEL = process.env.AI_MODEL || "gpt-4o-mini";

/**
 * 规则引擎：生成交易信号
 * 规则决定买卖，AI 只做过滤/增强
 */
async function getSignal(coin, data, allMarketData) {
  if (!data) return null;

  // ====== 规则 1: Polymarket vs Binance 套利 ======
  if (data.binancePrice && data.pmPrice) {
    // Polymarket 概率 vs 实际价格隐含概率的差值
    // 如果 Binance 价格涨了但 PM 概率没跟上 → BUY PM
    // 如果 Binance 价格跌了但 PM 概率没跌 → SELL PM
    const priceChange = data.priceChange || 0;
    const pmProb = data.pmPrice; // 0-1

    // Binance 上涨 > 0.5% 且 PM 概率 < 0.55 → PM 低估，买入
    if (priceChange > 0.5 && pmProb < 0.55) {
      return {
        action: "BUY_PM",
        size: calculateSize(priceChange, coin),
        reason: `Binance +${priceChange.toFixed(2)}% | PM prob ${(pmProb * 100).toFixed(1)}% → undervalued`,
        confidence: Math.min(priceChange / 2, 90)
      };
    }

    // Binance 下跌 > 0.5% 且 PM 概率 > 0.45 → PM 高估，卖出
    if (priceChange < -0.5 && pmProb > 0.45) {
      return {
        action: "SELL_PM",
        size: calculateSize(Math.abs(priceChange), coin),
        reason: `Binance ${priceChange.toFixed(2)}% | PM prob ${(pmProb * 100).toFixed(1)}% → overvalued`,
        confidence: Math.min(Math.abs(priceChange) / 2, 90)
      };
    }
  }

  // ====== 规则 2: 纯波动率交易 ======
  const vol = data.volatility || 0;
  if (vol > 2.0) {
    return {
      action: "VOLATILITY",
      size: Math.min(vol * 5, 30),
      reason: `High volatility: ${vol.toFixed(2)}%`,
      confidence: Math.min(vol * 10, 80)
    };
  }

  // ====== 规则 3: 趋势跟踪 ======
  if (data.priceChange > 1.0) {
    return {
      action: "TREND_UP",
      size: 10,
      reason: `Strong uptrend: +${data.priceChange.toFixed(2)}%`,
      confidence: 60
    };
  }

  if (data.priceChange < -1.0) {
    return {
      action: "TREND_DOWN",
      size: 10,
      reason: `Strong downtrend: ${data.priceChange.toFixed(2)}%`,
      confidence: 60
    };
  }

  return null;
}

/**
 * AI 辅助分析（可选）
 * 当规则给出信号后，可以用 AI 做二次确认
 */
async function aiConfirm(signal, coin, context) {
  if (!process.env.OPENAI_API_KEY && !process.env.DEEPSEEK_API_KEY) {
    return true; // 没配 API key 直接放行
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY;
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
            content: "You are a trading risk filter. Given a signal, market context, and coin, reply ONLY with YES or NO. YES = trade is safe, NO = skip this trade."
          },
          {
            role: "user",
            content: `Coin: ${coin}\nAction: ${signal.action}\nReason: ${signal.reason}\nContext: ${JSON.stringify(context)}\n\nShould we trade? YES or NO`
          }
        ],
        max_tokens: 5,
        temperature: 0.1
      },
      {
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        timeout: 10000
      }
    );

    const answer = res.data.choices[0]?.message?.content?.trim() || "YES";
    return answer === "YES";

  } catch (err) {
    console.error(`   AI confirm error: ${err.message}`);
    return true; // AI 挂了默认放行
  }
}

/**
 * 计算仓位大小
 */
function calculateSize(signalStrength, coin) {
  // 信号越强仓位越大
  const base = 10;
  const multiplier = Math.min(signalStrength, 5);
  return Math.round(base * multiplier / 10) * 10 || 10;
}

module.exports = { getSignal, aiConfirm };
