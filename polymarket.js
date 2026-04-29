// 在 polymarket.js 内部找到并替换该函数
function resolveTokenID(markets, coin) {
  if (!markets || !Array.isArray(markets)) return null;
  const keywords = {
    BTC: ["bitcoin"], ETH: ["ethereum"], SOL: ["solana"], 
    XRP: ["xrp"], DOGE: ["dogecoin"], HYPE: ["hyperliquid"], BNB: ["bnb"]
  };
  const kws = keywords[coin] || [coin.toLowerCase()];

  const match = markets.find(m => {
    const title = (m.question || "").toLowerCase();
    return kws.some(kw => title.includes(kw)) && (title.includes("price") || title.includes("above"));
  });

  if (!match || (!match.tokens && !match.outcomes)) return null;

  const tokens = match.tokens || match.outcomes || [];
  return {
    market: match.question,
    yesToken: tokens[0]?.token_id || tokens[0]?.id,
    noToken: tokens[1]?.token_id || tokens[1]?.id
  };
}
