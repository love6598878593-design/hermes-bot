require('dotenv').config();
const axios = require('axios');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

let lastPushHash = '';
let lastPushTime = 0;

async function sendTelegram(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('Telegram未配置');
    return false;
  }
  try {
    await axios.post('https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/sendMessage', {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML'
    });
    console.log('Telegram推送成功');
    return true;
  } catch (e) {
    console.error('推送失败:', e.response?.data || e.message);
    return false;
  }
}

async function getExpiringMarkets(daysAhead) {
  daysAhead = daysAhead || 7;
  const now = new Date();
  const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  
  const start = new Date(beijingTime);
  start.setHours(0, 0, 0, 0);
  let startUTC = new Date(start.getTime() - 8 * 60 * 60 * 1000);
  let startUTCStr = startUTC.toISOString().replace(/\.\d+Z$/, 'Z');
  
  const end = new Date(beijingTime);
  end.setDate(end.getDate() + daysAhead);
  end.setHours(23, 59, 59, 999);
  let endUTC = new Date(end.getTime() - 8 * 60 * 60 * 1000);
  let endUTCStr = endUTC.toISOString().replace(/\.\d+Z$/, 'Z');
  
  console.log('查询范围: ' + startUTCStr + ' ~ ' + endUTCStr);
  
  try {
    const response = await axios.get('https://gamma-api.polymarket.com/markets', {
      params: {
        closed: 'false',
        end_date_min: startUTCStr,
        end_date_max: endUTCStr,
        order: 'volume24hr',
        ascending: 'false',
        limit: 100
      },
      timeout: 15000
    });
    
    let markets = response.data;
    console.log('API返回 ' + markets.length + ' 个市场');
    
    let filtered = [];
    for (let i = 0; i < markets.length; i++) {
      let m = markets[i];
      let volume = parseFloat(m.volume24hr || 0);
      let hasValidDate = m.end_date_iso && m.end_date_iso !== '' && !isNaN(new Date(m.end_date_iso).getTime());
      let hasTokenId = m.clobTokenIds && m.clobTokenIds.length > 0;
      if (volume >= 500 && hasValidDate && hasTokenId) {
        filtered.push(m);
      }
    }
    
    filtered.sort(function(a, b) {
      let dateA = new Date(a.end_date_iso);
      let dateB = new Date(b.end_date_iso);
      if (dateA.getTime() === dateB.getTime()) {
        return parseFloat(b.volume24hr || 0) - parseFloat(a.volume24hr || 0);
      }
      return dateA - dateB;
    });
    
    let top20 = filtered.slice(0, 20);
    console.log('有效市场: ' + filtered.length + ' 个，推送前 ' + top20.length + ' 个');
    
    return top20;
  } catch (e) {
    console.error('API错误:', e.message);
    return [];
  }
}

async function getMarketProbability(tokenId) {
  if (!tokenId) return null;
  try {
    let res = await axios.get('https://clob.polymarket.com/last-trade-price?token_id=' + tokenId, {
      timeout: 5000
    });
    let price = parseFloat(res.data.price || 0);
    return price > 0 ? Math.round(price * 100) : null;
  } catch (e) {
    return null;
  }
}

async function main() {
  console.log('\n[' + new Date().toISOString() + '] 开始扫描...');
  
  let markets = await getExpiringMarkets(7);
  
  if (markets.length === 0) {
    console.log('未来7天无有效到期项目');
    return;
  }
  
  let hashParts = [];
  for (let i = 0; i < markets.length; i++) {
    let m = markets[i];
    hashParts.push(m.id + ':' + Math.floor(parseFloat(m.volume24hr || 0) / 1000));
  }
  let currentHash = hashParts.join('|');
  let now = Date.now();
  
  if (currentHash === lastPushHash && (now - lastPushTime) < 30 * 60 * 1000) {
    console.log('内容无变化且未满30分钟，跳过推送');
    return;
  }
  
  lastPushHash = currentHash;
  lastPushTime = now;
  
  let enriched = [];
  for (let i = 0; i < markets.length; i++) {
    let m = markets[i];
    let tokenId = m.clobTokenIds && m.clobTokenIds[0];
    let prob = tokenId ? await getMarketProbability(tokenId) : null;
    enriched.push({
      question: m.question,
      prob: prob,
      volume: parseFloat(m.volume24hr || 0).toLocaleString(),
      slug: m.slug || m.id,
      endDate: new Date(m.end_date_iso).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
    });
  }
  
  let batchSize = 5;
  for (let i = 0; i < enriched.length; i += batchSize) {
    let batch = enriched.slice(i, i + batchSize);
    let msg = '🔥 Polymarket 未来7天到期项目 ' + (i/batchSize + 1) + '/' + Math.ceil(enriched.length/batchSize) + '\n\n';
    
    for (let j = 0; j < batch.length; j++) {
      let m = batch[j];
      let probText = m.prob !== null ? m.prob + '%' : '获取中';
      let probIcon = (m.prob !== null && m.prob >= 70) ? '📈' : ((m.prob !== null && m.prob <= 30) ? '📉' : '⚖️');
      
      msg += probIcon + ' ' + m.question + '\n';
      msg += '   概率: ' + probText + ' | 交易量: $' + m.volume + '\n';
      msg += '   到期: ' + m.endDate + '\n';
      msg += '   🔗 https://polymarket.com/event/' + m.slug + '\n\n';
    }
    
    await sendTelegram(msg);
    await new Promise(function(resolve) { setTimeout(resolve, 1000); });
  }
  
  console.log('已推送 ' + enriched.length + ' 个项目');
}

console.log('Polymarket 到期监控启动');
console.log('检查间隔: 30分钟');
console.log('最低交易量: $500');

main();
setInterval(main, 30 * 60 * 1000);

process.on('SIGTERM', function() {
  console.log('监控已停止');
  process.exit(0);
});
