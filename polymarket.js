const fetch = require('node-fetch');

async function sendNotification(msg) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const cid   = process.env.TELEGRAM_CHAT_ID;

  if (token && cid) {
    try {
      await fetch(https://api.telegram.org/bot${token}/sendMessage, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: cid,
          text: msg,
          parse_mode: "Markdown"
        })
      });
    } catch(e) {
      console.error("Telegram error:", e.message);
    }
  } else {
    console.log(ℹ️ [Console] ${msg});
  }
}

function resolveTokenID(markets, keyword) {
  if (!markets || !Array.isArray(markets)) return null;

  const found = markets.find(m =>
    m.slug &&
    m.slug.toLowerCase().includes(keyword.toLowerCase())
  );

  if (!found) return null;

  try {
    const outcomes = JSON.parse(found.outcomes || "[]");
    const tokens   = JSON.parse(found.clobTokenIds || "[]");

    if (tokens.length >= 2) {
      return {
        title: found.title,
        slug: found.slug,
        yesToken: tokens[0],
        noToken: tokens[1],
        outcomes
      };
    }
  } catch (e) {
    return null;
  }

  return null;
}

async function fetchAllMarkets() {
  try {
    const res = await fetch(
      "https://gamma-api.polymarket.com/markets?limit=500&active=true&closed=false"
    );

    const data = await res.json();

    const active = (Array.isArray(data) ? data : [])
      .filter(m => m.active && !m.closed);

    console.log(📦 Polymarket: ${active.length} 个活跃市场);

    // 👉 打印前20个，避免刷屏
    active.slice(0, 20).forEach(m => {
      console.log(- ${m.slug});
    });

    return active;

  } catch(e) {
    console.error("fetchAllMarkets error:", e.message);
    return [];
  }
}

async function getMarketPrices(markets) {
  const result = {};

  const targets = ["bitcoin", "ethereum", "solana"];

  for (const t of targets) {
    const m = resolveTokenID(markets, t);

    if (!m) {
      result[t] = "Market not found";
      continue;
    }

    result[t] = {
      title: m.title,
      yesToken: m.yesToken,
      noToken: m.noToken
    };
  }

  return result;
}

module.exports = {
  sendNotification,
  resolveTokenID,
  fetchAllMarkets,
  getMarketPrices
};
