 const fetch = require('node-fetch');
sync function sendNotification(msg) {
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
[2026/4/29 15:42] No one Newton: require("dotenv").config();

const {
  sendNotification,
  fetchAllMarkets,
  resolveTokenID,
  getMarketPrices
} = require("./polymarket");

const INTERVAL = 60 * 1000; // 1分钟

async function main() {
  console.log("🤖 Hermes Bot started...\n");

  let cycle = 0;

  setInterval(async () => {
    cycle++;
    console.log(\n🤖 Cycle #${cycle}...);

    try {
      // 1️⃣ 拉市场
      const markets = await fetchAllMarkets();

      if (!markets.length) {
        console.log("❌ 没有获取到市场");
        return;
      }

      // 2️⃣ 获取目标币（这里只是示例）
      const coins = ["bitcoin", "ethereum", "solana"];

      let report = 📊 *Polymarket 市场扫描*\n⏱ Cycle: ${cycle}\n\n;

      for (const coin of coins) {
        try {
          const m = resolveTokenID(markets, coin);

          if (!m) {
            report += ❌ ${coin.toUpperCase()}: Market not found\n;
            continue;
          }

          report += 🪙 *${coin.toUpperCase()}*\n;
          report += • ${m.title}\n;
          report += • YES: \${m.yesToken}\\n;
          report += • NO : \${m.noToken}\\n\n;

        } catch (e) {
          report += ❌ ${coin.toUpperCase()} error\n;
        }
      }

      // 3️⃣ 输出 + 推送
      console.log(report);
      await sendNotification(report);

    } catch (err) {
      console.error("❌ 主循环错误:", err.message);
    }

  }, INTERVAL);
}

main();
[2026/4/29 15:45] No one Newton: require("dotenv").config();
const fetch = require("node-fetch");

const {
  sendNotification
} = require("./polymarket");

// ======================
// CLOB CONFIG
// ======================
const CLOB_HOST = "https://clob.polymarket.com";

// ======================
// 1️⃣ 获取 orderbook
// ======================
async function getOrderBook(tokenId) {
  try {
    const res = await fetch(${CLOB_HOST}/book?token_id=${tokenId});
    return await res.json();
  } catch (e) {
    console.error("orderbook error:", e.message);
    return null;
  }
}

// ======================
// 2️⃣ 下单（limit order）
// ======================
async function placeOrder({ tokenId, price, size, side }) {
  try {
    const payload = {
      token_id: tokenId,
      price: String(price),
      size: String(size),
      side: side, // "buy" | "sell"
      type: "limit"
    };

    const res = await fetch(${CLOB_HOST}/order, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": Bearer ${process.env.PRIVATE_KEY}
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    console.log("📦 Order result:", data);
    return data;

  } catch (e) {
    console.error("placeOrder error:", e.message);
  }
}

// ======================
// 3️⃣ 简单策略（demo）
// ======================
async function strategy(tokenId) {
  const book = await getOrderBook(tokenId);

  if (!book) return;

  const bestBid = book.bids?.[0]?.price;
  const bestAsk = book.asks?.[0]?.price;

  console.log("📊 book:", { bestBid, bestAsk });

  if (!bestBid || !bestAsk) return;

  const mid = (parseFloat(bestBid) + parseFloat(bestAsk)) / 2;

  // 🎯 简单逻辑：低买
  if (mid < 0.45) {
    console.log("🟢 BUY signal");

    await placeOrder({
      tokenId,
      price: mid.toFixed(2),
      size: 10,
      side: "buy"
    });

    await sendNotification(🟢 BUY ${tokenId} @ ${mid});
  }

  // 🔴 高卖
  if (mid > 0.55) {
    console.log("🔴 SELL signal");

    await placeOrder({
      tokenId,
      price: mid.toFixed(2),
      size: 10,
      side: "sell"
    });

    await sendNotification(🔴 SELL ${tokenId} @ ${mid});
  }
}

// ======================
// 4️⃣ 主循环
// ======================
async function main() {
  console.log("🤖 CLOB Trading Bot Started...");

  // 👉 示例 token（你要换成真实 market token）
  const TOKEN_ID = "111833791713605298141350391268557048852627695992567917532719982369837309341050";

  setInterval(async () => {
    try {
      await strategy(TOKEN_ID);
    } catch (e) {
      console.error("cycle error:", e.message);
    }
  }, 5000);
}

main();
