const fetch = require('node-fetch');

// ============================================================
// 发送通知（Telegram 或 Console Fallback）
// ============================================================
async function sendNotification(message) {
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

  if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    try {
      await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: "Markdown",
          }),
        }
      );
      console.log(`📤 Telegram 已发送: ${message.slice(0, 50)}...`);
    } catch (err) {
      console.error("❌ Telegram 发送失败:", err.message);
    }
  } else {
    console.log(`ℹ️ [Console Fallback]: ${message}`);
  }
}

// ============================================================
// 辅助函数：从匹配的市场中提取 token 信息
// ============================================================
function resolveFromMatch(market) {
  if (!market) return null;
  let tokens = market.tokens || market.outcomes || [];
  if (!Array.isArray(tokens)) tokens = Object.values(tokens);
  if (tokens.length < 2) return null;

  let yesToken = null;
  let noToken = null;

  for (const t of tokens) {
    const outcome = (t.outcome || t.label || t.title || "").toLowerCase();
    const id = t.token_id || t.id || t.tokenId || null;
    if (outcome === "yes" || outcome === "up") yesToken = id;
    else if (outcome === "no" || outcome === "down") noToken = id;
  }

  if (!yesToken) yesToken = tokens[0]?.token_id || tokens[0]?.id || tokens[0]?.tokenId;
  if (!noToken) noToken = tokens[1]?.token_id || tokens[1]?.id || tokens[1]?.tokenId;

  return {
    market: market.question || market.title || market.slug,
    token0: yesToken,
    token1: noToken,
    yesToken: yesToken,
    noToken: noToken
  };
}

// ============================================================
// 核心函数：根据币种解析 Polymarket Token ID
// ============================================================
function resolveTokenID(markets, coin) {
  if (!markets || !Array.isArray(markets)) return null;

  const keywords = {
    BTC: ["btc", "bitcoin"],
    ETH: ["eth", "ethereum"],
    SOL: ["sol", "solana"],
    XRP: ["xrp"],
    DOGE: ["doge", "dogecoin"],
    HYPE: ["hype", "hyperliquid"],
    BNB: ["bnb"]
  };

  const kws = keywords[coin] || [coin.toLowerCase()];

  // 第一步：匹配 Up/Down 类型市场
  const match = markets.find(m => {
    const title = (m.question || m.title || "").toLowerCase();
    const slug = (m.slug || m.eventSlug || "").toLowerCase();
    const combined = title + " " + slug;
    return kws.some(kw => combined.includes(kw)) &&
           (combined.includes("up") || combined.includes("down") || combined.includes("updown"));
  });

  if (match) return resolveFromMatch(match);

  // 第二步：回退，不限类型
  const fallback = markets.find(m => {
    const title = (m.question || m.title || "").toLowerCase();
    const slug = (m.slug || m.eventSlug || "").toLowerCase();
    const combined = title + " " + slug;
    return kws.some(kw => combined.includes(kw));
  });

  return fallback ? resolveFromMatch(fallback) : null;
}

// ============================================================
// 获取市场价格
// ============================================================
async function getMarketPrices(markets) {
  const coins = ["BTC", "ETH", "SOL", "XRP", "DOGE", "HYPE", "BNB"];
  const results = {};

  for (const coin of coins) {
    const resolved = resolveTokenID(markets, coin);
    if (resolved) {
      console.log(`✅ ${coin}: ${resolved.market}`);
      results[coin] = resolved;
    } else {
      console.log(`❌ ${coin}: Market not found`);

      // 调试：列出包含关键词的市场
      const kws = {
        BTC: ["btc", "bitcoin"], ETH: ["eth", "ethereum"], SOL: ["sol", "solana"],
        XRP: ["xrp"], DOGE: ["doge", "dogecoin"], HYPE: ["hype", "hyperliquid"], BNB: ["bnb"]
      }[coin] || [coin.toLowerCase()];

      const debugMatches = markets.filter(m => {
        const combined = (m.question || m.title || "").toLowerCase() + " " +
                         (m.slug || m.eventSlug || "").toLowerCase();
        return kws.some(kw => combined.includes(kw));
      });

      if (debugMatches.length > 0) {
        console.log(`   🔍 找到 ${debugMatches.length} 个相关市场但未匹配类型:`);
        debugMatches.slice(0, 3).forEach(m => {
          console.log(`      📝 ${m.question || m.title || m.slug}`);
          console.log(`      🏷️ slug: ${m.slug || m.eventSlug || "无"}`);
          console.log(`      🎫 outcomes: ${JSON.stringify((m.outcomes || m.tokens || []).slice(0, 3))}`);
        });
      } else {
        console.log(`   ⚠️ 未找到任何包含 [${kws.join(", ")}] 的市场`);
      }
    }
  }

  return results;
}

// ============================================================
// 获取 Polymarket 数据
// ============================================================
async function fetchPolymarkets() {
  try {
    const res = await fetch("https://gamma-api.polymarket.com/events?limit=1000&closed=false");
    const data = await res.json();
    console.log(`   📦 Polymarket: 成功解析 ${data.length} 个市场`);
    return data;
  } catch (err) {
    console.error("❌ Polymarket 获取失败:", err.message);
    return [];
  }
}

// ============================================================
// 导出
// ============================================================
module.exports = {
  sendNotification,
  resolveTokenID,
  resolveFromMatch,
  getMarketPrices,
  fetchPolymarkets
};
