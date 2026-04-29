const fetch = require('node-fetch');

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
    } catch(e) {}
  } else {
    console.log(`ℹ️ [Console] ${msg}`);
  }
}

async function fetchAllMarkets() {
  try {
    const res = await fetch(
      "https://gamma-api.polymarket.com/markets?limit=500&active=true&closed=false"
    );
    const data = await res.json();
    const active = (Array.isArray(data) ? data : []).filter(m => m.active && !m.closed);

    console.log(`\n📦 共 ${active.length} 个活跃市场\n`);

    // ============ 诊断：列出所有 slug ============
    const allSlugs = active.map(m => m.slug || "").filter(Boolean);
    
    // 找包含币种关键词的
    const keywords = ["btc", "bitcoin", "eth", "ethereum", "sol", "solana", "xrp", "ripple", "doge", "dogecoin", "hype", "hyperliquid", "bnb", "binance"];
    
    console.log("=== 包含币种关键词的市场 ===");
    const cryptoMarkets = active.filter(m => {
      const slug = (m.slug || "").toLowerCase();
      const title = (m.title || "").toLowerCase();
      const combined = slug + " " + title;
      return keywords.some(kw => combined.includes(kw));
    });

    if (cryptoMarkets.length === 0) {
      console.log("❌ 没有任何加密货币相关市场！");
    } else {
      cryptoMarkets.forEach(m => {
        console.log(`  📝 ${m.title}`);
        console.log(`     slug: ${m.slug}`);
        console.log(`     outcomes: ${m.outcomes}`);
        console.log(`     tokens: ${m.clobTokenIds}`);
        console.log("");
      });
    }

    console.log(`\n=== 所有市场 slug 一览（前50个）===`);
    allSlugs.slice(0, 50).forEach(s => console.log(`  ${s}`));
    
    console.log(`\n=== slug 中包含 "5m" 或 "up" 或 "down" 的 ===`);
    const shortTerm = active.filter(m => {
      const s = (m.slug || "").toLowerCase();
      return s.includes("5m") || s.includes("-up-") || s.includes("-down-");
    });
    console.log(`共 ${shortTerm.length} 个`);
    shortTerm.forEach(m => console.log(`  ${m.title} | ${m.slug}`));

    return active;
  } catch (e) {
    console.error("❌", e.message);
    return [];
  }
}

async function getMarketPrices(markets) {
  console.log("ℹ️ 诊断模式，不做匹配");
  return {};
}

module.exports = {
  sendNotification,
  fetchAllMarkets,
  getMarketPrices
};
