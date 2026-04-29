function resolveTokenID(markets, coin) {
  if (!markets || !Array.isArray(markets)) return null;

  const keywords = {
    BTC: ["bitcoin"],
    ETH: ["ethereum"],
    SOL: ["solana"],
    XRP: ["xrp"],
    DOGE: ["dogecoin"],
    HYPE: ["hyperliquid"],
    BNB: ["bnb"]
  };

  const kws = keywords[coin] || [coin.toLowerCase()];

  // 第一步：模糊匹配相关市场
  const match = markets.find(m => {
    const title = (m.question || "").toLowerCase();
    return kws.some(kw => title.includes(kw)) &&
           (title.includes("price") || title.includes("above") || title.includes("below"));
  });

  if (!match) {
    // 第二步：如果没有精确匹配，尝试只按关键词匹配
    const fallback = markets.find(m => {
      const title = (m.question || "").toLowerCase();
      return kws.some(kw => title.includes(kw));
    });
    if (!fallback) return null;
    return resolveFromMatch(fallback);
  }

  return resolveFromMatch(match);
}

// 辅助函数：从匹配的市场中提取 token 信息
function resolveFromMatch(market) {
  if (!market) return null;

  // 优先使用 tokens，其次 outcomes
  let tokens = market.tokens || market.outcomes || [];

  // 如果 tokens/outcomes 是对象，尝试提取数组
  if (!Array.isArray(tokens)) {
    tokens = Object.values(tokens);
  }

  if (tokens.length < 2) return null;

  // 查找 Yes/No token
  let yesToken = null;
  let noToken = null;

  for (const t of tokens) {
    const outcome = (t.outcome || t.label || "").toLowerCase();
    const id = t.token_id || t.id || t.tokenId || null;

    if (outcome === "yes" || outcome === "up") {
      yesToken = id;
    } else if (outcome === "no" || outcome === "down") {
      noToken = id;
    }
  }

  // 如果找不到明确的 Yes/No，默认取前两个
  if (!yesToken) yesToken = tokens[0]?.token_id || tokens[0]?.id || tokens[0]?.tokenId;
  if (!noToken) noToken = tokens[1]?.token_id || tokens[1]?.id || tokens[1]?.tokenId;

  return {
    market: market.question || market.title,
    token0: yesToken,
    token1: noToken,
    yesToken: yesToken,
    noToken: noToken
  };
}

module.exports = { resolveTokenID };
