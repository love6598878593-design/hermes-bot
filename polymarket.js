const fetch = require('node-fetch');

// ✅ 扩展币种映射表
const COIN_MAP = {
  btc:  ["btc",  "bitcoin"],
  eth:  ["eth",  "ethereum"],
  sol:  ["sol",  "solana"],
  xrp:  ["xrp",  "ripple"],
  doge: ["doge", "dogecoin"],
  hype: ["hype", "hyperliquid"],
  bnb:  ["bnb",  "binance"]
};

// ======================= Notify =======================
async function sendNotification(msg) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const cid   = process.env.TELEGRAM_CHAT_ID;
  if (token && cid) {
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: cid, text: msg, parse_mode: "Markdown" })
      });
    } catch(e) { console.error("❌ TG err:", e.message); }
  } else {
    console.log(`ℹ️ [Console] ${msg}`);
  }
}

// ======================= Token resolver =======================
function resolveTokenID(markets, coin) {
  if (!markets || !Array.isArray(markets)) return null;
  const names = COIN_MAP[coin.toLowerCase()] || [coin.toLowerCase()];

  // ✅ 全文语义匹配（question + slug + description）
  const match = markets.find(m => {
    const text = [
      m.question, m.title, m.slug, m.eventSlug, m.description
    ].filter(Boolean).join(" ").toLowerCase();

    return names.some(n => text.includes(n));
  });

  if (!match) return null;

  let tokens = match.tokens || match.outcomes || [];
  if (!Array.isArray(tokens)) tokens = Object.values(tokens);
  if (tokens.length < 2) {
    console.warn(`⚠️ ${coin} 匹配到市场但无足够 outcomes`);
    return null;
  }

  const yesId = tokens[0]?.token_id || tokens[0]?.id || tokens[0]?.tokenId;
  const noId  = tokens[1]?.token_id || tokens[1]?.id || tokens[1]?.tokenId;

  return {
    market: match.question || match.title || match.slug,
    yesToken: yesId,
    noToken: noId
  };
}

// ======================= Fetch markets =======================
async function fetchAllMarkets() {
  try {
    const res = await fetch("https://gamma-api.polymarket.com/events?limit=500&active=true&closed=false");
    const data = await res.json();

    // ✅ 只保留活跃市场
    const active = (Array.isArray(data) ? data : []).filter(m => m.active && !m.closed);

    console.log(`📦 Polymarket: ${active.length} 个活跃市场`);

    // ✅ 打印前 10 个市场（看清真实结构）
    active.slice(0, 10).forEach(m => {
      console.log({
        question: m.question,
        slug: m.slug,
        outcomes: (m.outcomes || []).slice(0, 2)
      });
    });

    return active;
  } catch (e) {
    console.error("❌ fetchAllMarkets 失败:", e.message);
    return [];
  }
}

// ======================= Get prices for coins =======================
async function getMarketPrices(markets) {
  const coins = ["BTC", "ETH", "SOL", "XRP", "DOGE", "HYPE", "BNB"];
  const res = {};
  for (const c of coins) {
    const r = resolveTokenID(markets, c);
    if (r) { console.log(`✅ ${c}: ${r.market}`); res[c] = r; }
    else   { console.log(`❌ ${c}: Market not found`); }
  }
  return res;
}

// ======================= Exports =======================
module.exports = {
  sendNotification,
  resolveTokenID,
  fetchAllMarkets,
  getMarketPrices
};
