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

async function getExpiringMarkets(daysAhead = 7) {
  const now = new Date();
  const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  
  // 今天开始
  const start = new Date(beijingTime);
  start.setHours(0, 0, 0, 0);
  const startUTC = new Date(start.getTime() - 8 * 60 * 60 * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
  
  // daysAhead 天后结束
  const end = new Date(beijingTime);
  end.setDate(end.getDate() + daysAhead);
  end.setHours(23, 59, 59, 999);
  const endUTC = new Date(end.getTime() - 8 * 60 * 60 * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
  
  console.log(`📅 查询范围: ${startUTC} ~ ${endUTC} (未来${daysAhead}天)`);
  
  try {
    const response = await axios.get('https://gamma-api.polymarket.com/markets', {
      params: {
        closed: 'false',
        end_date_min: startUTC,
        end_date_max: endUTC,
        order: 'volume24hr',
        ascending: 'false',
        limit: 100
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
    
    // 按到期时间排序（最近的在前），交易量作为次要排序
    filtered.sort((a, b) => {
      const dateA = new Date(a.end_date_iso);
      const dateB = new Date(b.end_date_iso);
      if (dateA.getTime() === dateB.getTime()) {
        return parseFloat(b.volume24hr || 0) - parseFloat(a.volume24hr || 0);
      }
      return dateA - dateB;
    });
    
    // 取前20个
    const top20 = filtered.slice(0, 20);
    
    console.log(`💰 有效市场: ${filtered.length} 个，推送前 ${top20.length} 个`);
    console.log(`❌ 过滤掉 ${markets.length - filtered.length} 个无效市场`);
    
    return top20;
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
  
  const markets = await getExpiringMarkets(7);  // 未来7天
  
  if (markets.length === 0) {
    console.log('📭 未来7天无有效到期项目');
    return;
  }
  
  const hashParts = markets.map(m => `${m
