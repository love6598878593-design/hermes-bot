const axios = require('axios');

async function getTodayExpiringMarkets() {
  // 获取北京时间今天的起止时间（UTC）
  const now = new Date();
  const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  
  const start = new Date(beijingTime);
  start.setHours(0, 0, 0, 0);
  const startUTC = new Date(start.getTime() - 8 * 60 * 60 * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
  
  const end = new Date(beijingTime);
  end.setHours(23, 59, 59, 999);
  const endUTC = new Date(end.getTime() - 8 * 60 * 60 * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
  
  console.log(`查询范围: ${startUTC} ~ ${endUTC}`);
  
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
    
    const markets = response.data;
    console.log(`\n找到 ${markets.length} 个今天结算的项目:\n`);
    
    if (markets.length === 0) {
      console.log('无今天结算的项目');
      return;
    }
    
    markets.forEach((m, idx) => {
      console.log(`${idx + 1}. ${m.question}`);
      console.log(`   到期: ${m.end_date_iso}`);
      console.log(`   24h交易量: $${parseFloat(m.volume24hr || 0).toLocaleString()}`);
      console.log(`   市场URL: https://polymarket.com/event/${m.slug || m.id}\n`);
    });
    
    return markets;
    
  } catch (error) {
    console.error('请求失败:', error.message);
    return [];
  }
}

// 执行
getTodayExpiringMarkets();
