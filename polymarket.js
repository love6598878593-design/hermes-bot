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

  const match = markets.find(m => {
    const text = [
      m.title, m.question, m.slug, m.eventSlug, m.description
    ].filter(Boolean).join(" ").toLowerCase();
    return names.some(n => text.includes(n));
  });

  if (!match) return null;

  // ✅ 新接口返回 clobTokenIds 或 outcomes
  let tokens = match.clobTokenIds || match.outcomes || [];
  if (!Array.isArray(tokens)) tokens = Object.values(tokens);
  
  // ✅ 过滤出 Yes/No（有时是字符串数组）
  const yes = tokens.find(t => {
    const s = (typeof t === "string" ? t : (t.outcome || t.label || "")).toLowerCase();
    return s === "yes" || s === "up";
  });
  const no = tokens.find(t => {
    const s = (typeof t === "string" ? t : (t.outcome || t.label || "")).toLowerCase();
    return s === "no" || s === "down";
  });

  return {
    market: match.title || match.question || match.slug,
    yesToken: typeof yes === "string" ? yes : (yes?.token_id || yes?.id || yes?.tokenId),
    noToken:  typeof no  === "string" ? no  : (no?.token_id  || no?.id  || no?.tokenId),
    rawTokens: tokens.slice(0, 4)  // 调试用
  };
}

// ======================= Fetch markets（换接口） =======================
async function fetchAllMarkets() {
  try {
    // ✅ 换用 /markets 接口（返回完整 token 数据）
    const res = await fetch(
      "https://gamma-api.polymarket.com/markets?limit=500&active=true&closed=false"
    );
    const data = await res.json();
    const active = (Array.isArray(data) ? data : []).filter(m => m.active && !m.closed);

    console.log(`📦 Polymarket: ${active.length} 个活跃市场`);

    // ✅ 打印前 5 个，看清新结构
    active.slice(0, 5).forEach(m => {
      console.log({
        title: m.title || m.question,
        slug: m.slug,
        outcomes: (m.outcomes || []).slice(0, 2),
        clobTokenIds: (m.clobTokenIds || []).slice(0, 2)
      });
    });

    return active;
  } catch (e) {
    console.error("❌ fetchAllMarkets 失败:", e.message);
    return [];
  }
}

// ======================= Get prices =======================
async function getMarketPrices(markets) {
  const coins = ["BTC", "ETH", "SOL", "XRP", "DOGE", "HYPE", "BNB"];
  const res = {};
  for (const c of coins) {
    const r = resolveTokenID(markets, c);
    if (r) {
      console.log(`✅ ${c}: ${r.market} | tokens: ${JSON.stringify(r.rawTokens)}`);
      res[c] = r;
    } else {
      console.log(`❌ ${c}: Market not found`);
    }
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
