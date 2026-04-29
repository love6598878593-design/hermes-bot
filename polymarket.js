const fetch = require('node-fetch');

const COIN_MAP = {
  bitcoin:  ["btc",  "bitcoin"],
  ethereum: ["eth",  "ethereum"],
  solana:   ["sol", "solana"],
  xrp:      ["xrp", "ripple"],
  doge:     ["doge", "dogecoin"],
  hype:     ["hype", "hyperliquid"],
  bnb:      ["bnb",  "binance"]
};

async function sendNotification(msg) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const cid   = process.env.TELEGRAM_CHAT_ID;

  if (token && cid) {
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: cid,
          text: msg,
          parse_mode: "Markdown"
        })
      });
      console.log("📤 Telegram sent");
    } catch(e) {
      console.error("Telegram error:", e.message);
    }
  } else {
    console.log(`ℹ️ [Console] ${msg}`);
  }
}

function resolveTokenID(markets, coin) {
  if (!markets || !Array.isArray(markets)) return null;

  const names = COIN_MAP[coin.toLowerCase()] || [coin.toLowerCase()];

  const found = markets.find(m => {
    const slug = (m.slug || "").toLowerCase();
    return names.some(n => slug.includes(n));
  });

  if (!found) return null;

  try {
    const outcomes = JSON.parse(found.outcomes || "[]");
    const tokens   = JSON.parse(found.clobTokenIds || "[]");

    if (tokens.length >= 2) {
      return {
        title: found.title || found.slug,
        slug: found.slug,
        yesToken: tokens[0],
        noToken: tokens[1],
        outcomes
      };
    }

    return null;
  } catch (e) {
    return null;
  }
}

async function fetchAllMarkets() {
  try {
    const res = await fetch(
      "https://gamma-api.polymarket.com/markets?limit=500&active=true&closed=false"
    );

    const data = await res.json();
    const active = (Array.isArray(data) ? data : [])
      .filter(m => m.active && !m.closed);

    console.log(`📦 Polymarket: ${active.length} 个活跃市场`);
    return active;

  } catch(e) {
    console.error("fetchAllMarkets error:", e.message);
    return [];
  }
}

module.exports = {
  sendNotification,
  resolveTokenID,
  fetchAllMarkets,
  getMarketPrices: async () => ({})
};
