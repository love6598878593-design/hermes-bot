require('dotenv').config();
const axios = require('axios');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

let lastPushHash = '';
let lastPushTime = 0;

async function sendTelegram(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('❌ Telegram未配置');
    return false;
  }
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML'
    });
    console.log('✅ Telegram推送成功');
    return true;
  } catch (e) {
    console.error('❌ 推送失败:', e.response?.data || e.message);
    return false;
  }
}

async function getTodayExpiringMarkets() {
  const now = new Date();
  const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  
  const start = new Date(beijingTime);
  start.setHours(0, 0, 0, 0);
  const startUTC = new Date(start.getTime() - 8 * 60 * 60 * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
  
  const end = new Date(beijingTime);
  end.setHours(23, 59, 59, 999);
  const endUTC = new Date(end.getTime() - 8 * 60 * 60 * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
  
  console.log(`📅 查询范围: ${startUTC} ~ ${endUTC}`);
  
  try {
    const response = await axios.get('https://gamma-api.polymarket.com/markets', {
      params: {
        closed: 'false',
        end_date_min: startUTC,
        end_date_max: endUTC,
        order: 'volume24hr',
        ascending: 'false',
        limit: 50
      },
      timeout: 15000
    });
    
    let markets = response.data;
    console.log(`📊 API返回 ${markets.length} 个市场`);
    
    // 过滤条件：
    // 1. 交易量 >= 500
    // 2. 有有效的 end_date_iso
    // 3. 有 clobTokenIds
    const filtered = markets.filter(m => {
      const volume = parseFloat(m.volume24hr || 0);
      const hasValidDate = m.end_date_iso && m.end_date_iso !== '' && !isNaN(new Date(m.end_date_iso).getTime());
      const hasTokenId = m.clobTokenIds && m.clobTokenIds.length > 0;
      return volume >= 500 && hasValidDate && hasTokenId;
    });
    
    // 按交易量排序，取前10
    filtered.sort((a, b) => parseFloat(b.volume24hr || 0) - parseFloat(a.volume24hr || 0));
    const top10 = filtered.slice(0, 10);
    
    console.log(`💰 过滤后: ${filtered.length} 个有效市场，推送前 ${top10.length} 个`);
    console.log(`❌ 过滤掉 ${markets.length - filtered.length} 个无效市场（无日期或无token）`);
    
    return top10;
  } catch (e) {
    console.error('❌ API错误:', e.message);
    return [];
  }
}

async function getMarketProbability(tokenId) {
  if (!tokenId) return null;
  try {
    const res = await axios.get(`https://clob.polymarket.com/last-trade-price?token_id=${tokenId}`, {
      timeout: 5000
    });
    const price = parseFloat(res.data.price || 0);
    return price > 0 ? Math.round(price * 100) : null;
  } catch (e) {
    return null;
  }
}

async function main() {
  console.log(`\n[${new Date().toISOString()}] 🔍 开始扫描...`);
  
  const markets = await getTodayExpiringMarkets();
  
  if (markets.length === 0) {
    console.log('📭 今日无有效到期项目');
    return;
  }
  
  const hashParts = markets.map(m => `${m.id}:${Math.floor(parseFloat(m.volume24hr || 0) / 1000)}`);
  const currentHash = hashParts.join('|');
  const now = Date.now();
  
  if (currentHash === lastPushHash && (now - lastPushTime) < 30 * 60 * 1000) {
    console.log('⏸️ 内容无变化且未满30分钟，跳过推送');
    return;
  }
  
  lastPushHash = currentHash;
  lastPushTime = now;
  
  // 获取概率
  const enriched = [];
  for (const m of markets) {
    const tokenId = m.clobTokenIds?.[0];
    const prob = await getMarketProbability(tokenId);
    enriched.push({
      question: m.question,
      prob: prob,
      volume: parseFloat(m.volume24hr || 0).toLocaleString(),
      slug: m.slug || m.id,
      endDate: new Date(m.end_date_iso).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
    });
  }
  
  // 分批推送
  const batchSize = 5;
  for (let i = 0; i < enriched.length; i += batchSize) {
    const batch = enriched.slice(i, i + batchSize);
    let msg = `🔥 <b>Polymarket 今日到期项目</b> ${i/batchSize + 1}/${Math.ceil(enriched.length/batchSize)}\n\n`;
    
    for (const m of batch) {
      const probText = m.prob !== null ? `${m.prob}%` : '获取中';
      const probIcon = m.prob !== null && m.prob >= 70 ? '📈' : (m.prob !== null && m.prob <= 30 ? '📉' : '⚖️');
      
      msg += `${probIcon} <b>${m.question}</b>\n`;
      msg += `   概率: ${probText} | 交易量: $${m.volume}\n`;
      msg += `   到期: ${m.endDate}\n`;
      msg += `   🔗 https://polymarket.com/event/${m.slug}\n\n`;
    }
    
    await sendTelegram(msg);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log(`✅ 已推送 ${enriched.length} 个项目`);
}

console.log('🚀 Polymarket 到期监控启动');
console.log(`⏱️ 检查间隔: 30分钟`);
console.log(`💰 最低交易量: $500`);
console.log(`📊 推送条件: 有效日期 + 有效Token + 交易量前10`);
console.log(`🤖 Telegram: ${TELEGRAM_BOT_TOKEN ? '已配置 ✅' : '未配置 ❌'}\n`);

main();
setInterval(main, 30 * 60 * 1000);

process.on('SIGTERM', () => {
  console.log('\n👋 监控已停止');
  process.exit(0);
});
