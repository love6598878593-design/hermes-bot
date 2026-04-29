# 先确认你已经登录 Railway CLI
railway login

# 链接到项目
railway link

# 直接进入 Railway 容器执行修复
railway run "cat > /app/polymarket.js << 'ENDOFFILE'
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const COIN_MAP = {
  bitcoin:  [\"btc\",  \"bitcoin\"],
  ethereum: [\"eth\",  \"ethereum\"],
  solana:   [\"sol\", \"solana\"]
};

const WEIGHTS = { bitcoin: 5, btc: 3, ethereum: 5, eth: 3, solana: 5, sol: 3 };

let marketCache = [];
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000;
const STATE_FILE = path.join('/tmp', 'hermes_trade_state.json');
let hasTraded = {};
let lastTradeTime = {};
const COOLDOWN = 10 * 60 * 1000;
const DRY_RUN = (process.env.DRY_RUN || 'true') !== 'false';

function loadTradeState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}
function saveTradeState(s) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(s)); } catch {}
}
const savedTrade = loadTradeState();
hasTraded = savedTrade.hasTraded || {};
lastTradeTime = savedTrade.lastTradeTime || {};

function safeJSON(x, fallback = []) {
  try { if (!x) return fallback; if (Array.isArray(x)) return x; return JSON.parse(x); } catch { return fallback; }
}

function normalizePrice(p) {
  let num = Number(p);
  if (isNaN(num) || num <= 0) return null;
  if (num > 10000) return num / 1000000;
  if (num > 1) return num / 100;
  return num;
}

async function sendNotification(msg) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const cid   = process.env.TELEGRAM_CHAT_ID;
  if (token && cid) {
    try {
      await fetch(\`https://api.telegram.org/bot\${token}/sendMessage\`, {
        method: \"POST\",
        headers: { \"Content-Type\": \"application/json\" },
        body: JSON.stringify({ chat_id: cid, text: msg, parse_mode: \"Markdown\" })
      });
      console.log(\"📤 Telegram sent\");
    } catch(e) { console.error(\"Telegram error:\", e.message); }
  } else { console.log(\`ℹ️ [Console] \${msg}\`); }
}

async function getOrderBook(tokenId) {
  if (!tokenId) return null;
  try {
    const res = await fetch(\`https://clob.polymarket.com/book?token_id=\${tokenId}\`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return { bestBid: data.bids?.[0]?.price || null, bestAsk: data.asks?.[0]?.price || null };
  } catch (e) { return null; }
}

async function getBalance() {
  return { balance: \"离线\", currency: \"USDC\" };
}

async function placeOrder(tokenId, side, size) {
  if (DRY_RUN) return { dryRun: true };
  return null;
}

async function safeTrade(coin, yesToken, noToken, currentProb) {
  return null;
}

function resolveMarket(markets, coin) {
  const names = COIN_MAP[coin.toLowerCase()] || [coin.toLowerCase()];
  const list = (markets && markets.length > 0) ? markets :
    (Date.now() - cacheTimestamp < CACHE_TTL ? marketCache : []);
  
  const BLOCK = /2026|2027|2028|before.gta|world.cup|fifa|uefa|stanley|nba|nhl|premier.league|champions.league|election|president|senate|congress|oscars|grammy|movie|album|celebrity|netherlands|solanke|megaeth|prison|divorce|box.office|sentenced/i;
  
  let candidates = list.filter(m => {
    const text = \`\${m.slug || \"\"} \${m.question || m.title || \"\"}\`.toLowerCase();
    return names.some(k => text.includes(k));
  });
  
  candidates = candidates.filter(m => {
    const text = \`\${m.slug || \"\"} \${m.question || m.title || \"\"}\`.toLowerCase();
    return !BLOCK.test(text);
  });
  
  if (!candidates.length) return null;
  
  const scored = candidates.map(m => {
    const text = \`\${m.slug || \"\"} \${m.question || m.title || \"\"}\`.toLowerCase();
    let score = 0;
    for (const k of names) { if (text.includes(k)) score += (WEIGHTS[coin.toLowerCase()] || 2); }
    if (/price|above|below|up\\\\b|down\\\\b|today|tomorrow|this.week/i.test(text)) score += 5;
    return { m, score };
  }).sort((a, b) => b.score - a.score);
  
  const found = scored[0].m;
  const tokens = safeJSON(found.clobTokenIds || found.outcomes);
  if (!tokens || tokens.length < 2) return null;
  
  let yesPrice = null, noPrice = null;
  if (Array.isArray(found.outcomePrices)) {
    yesPrice = normalizePrice(found.outcomePrices[0]);
    noPrice  = normalizePrice(found.outcomePrices[1]);
  }
  
  return { title: found.question || found.title || found.slug, slug: found.slug, yesToken: tokens[0], noToken: tokens[1], yesPrice, noPrice };
}

async function fetchAllMarkets() {
  try {
    const res = await fetch(\"https://gamma-api.polymarket.com/markets?limit=500&active=true&closed=false\");
    const data = await res.json();
    const active = (Array.isArray(data) ? data : []).filter(m => m.active && !m.closed);
    marketCache = active;
    cacheTimestamp = Date.now();
    console.log(\`📦 Polymarket: \${active.length} 个活跃市场\`);
    return active;
  } catch(e) { return marketCache; }
}

module.exports = { sendNotification, getOrderBook, getBalance, placeOrder, safeTrade, resolveMarket, fetchAllMarkets, normalizePrice };
ENDOFFILE"

# 重启服务
railway run "pkill -f 'node server.js'"
