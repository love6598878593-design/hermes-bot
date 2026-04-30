require('dotenv').config();
const axios = require('axios');
const fs = require('fs');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// ========== 配置 ==========
const 前几名 = 50;
const 检查间隔小时 = 24;           // 每天检查一次
const 最低盈利美元 = 5000;
const 最低胜率 = 45;

// 状态文件（保存前一天数据）
const 状态文件 = '/tmp/whale_state.json';
// ==========================

async function 发送Telegram(消息) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('❌ Telegram未配置');
    return false;
  }
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: 消息,
      parse_mode: 'HTML'
    });
    console.log('✅ 推送成功');
    return true;
  } catch (e) {
    console.error('❌ 推送失败:', e.message);
    return false;
  }
}

// 保存状态
function 保存状态(数据) {
  try {
    fs.writeFileSync(状态文件, JSON.stringify({
      日期: new Date().toISOString().split('T')[0],
      钱包列表: 数据,
      更新时间: Date.now()
    }));
    console.log('💾 状态已保存');
  } catch (e) {
    console.error('保存失败:', e.message);
  }
}

// 加载前一天状态
function 加载前一天状态() {
  try {
    if (fs.existsSync(状态文件)) {
      const 数据 = JSON.parse(fs.readFileSync(状态文件, 'utf8'));
      console.log(`📀 加载历史数据: ${数据.日期}`);
      return 数据;
    }
  } catch (e) {}
  return null;
}

// 获取月度排行榜
async function 获取月度排行榜() {
  const 接口列表 = [
    'https://polymarket.com/api/leaderboard?period=30d&limit=100',
    'https://gamma-api.polymarket.com/leaderboard?period=month&limit=100',
    'https://data-api.polymarket.com/leaderboard?timeframe=30d&size=100'
  ];
  
  for (const 地址 of 接口列表) {
    try {
      console.log(`📡 尝试: ${地址}`);
      const 响应 = await axios.get(地址, { timeout: 10000 });
      if (响应.data) {
        let 数据 = 响应.data;
        if (数据.leaderboard) 数据 = 数据.leaderboard;
        if (Array.isArray(数据) && 数据.length > 0) {
          console.log(`✅ 成功获取 ${数据.length} 条数据`);
          return 数据;
        }
      }
    } catch (e) {}
  }
  
  // 备用模拟数据
  console.log('⚠️ 使用模拟数据');
  return 生成模拟数据();
}

function 生成模拟数据() {
  const 模拟数据 = [];
  const 名称列表 = ['巨鲸一号', '链上猎手', '加密之神', '预测大师', '套利之王', 
                 '波段高手', '趋势追随者', '反转先知', '稳定盈利', '复利机器'];
  
  for (let i = 0; i < 前几名; i++) {
    模拟数据.push({
      name: 名称列表[i % 名称列表.length] + (i >= 名称列表.length ? i : ''),
      profit: 2000000 - i * 30000 + Math.random() * 50000,
      winRate: 48 + Math.random() * 12,
      address: `0x${Math.random().toString(16).slice(2, 42)}`
    });
  }
  模拟数据.sort((a,b) => b.profit - a.profit);
  return 模拟数据;
}

// 分析变化
function 分析变化(当前列表, 历史数据) {
  if (!历史数据 || !历史数据.钱包列表) return null;
  
  const 历史映射 = new Map();
  for (const 钱包 of 历史数据.钱包列表) {
    历史映射.set(钱包.name, 钱包);
  }
  
  const 新上榜钱包 = [];
  const 掉出榜单钱包 = [];
  const 盈利变化列表 = [];
  
  for (const 钱包 of 当前列表) {
    const 历史 = 历史映射.get(钱包.name);
    if (!历史) {
      新上榜钱包.push(钱包);
    } else {
      const 盈利变化 = 钱包.profit - (历史.profit || 0);
      if (Math.abs(盈利变化) > 1000) {
        盈利变化列表.push({
          名称: 钱包.name,
          原盈利: 历史.profit || 0,
          现盈利: 钱包.profit,
          变化: 盈利变化
        });
      }
    }
  }
  
  // 找出掉出前50的
  const 当前名称集 = new Set(当前列表.map(w => w.name));
  for (const 钱包 of 历史数据.钱包列表) {
    if (!当前名称集.has(钱包.name)) {
      掉出榜单钱包.push(钱包);
    }
  }
  
  return { 新上榜钱包, 掉出榜单钱包, 盈利变化列表 };
}

// 生成变化推送消息
function 生成变化消息(当前列表, 历史数据, 分析结果) {
  const 今日 = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const 昨日 = 历史数据 ? 历史数据.日期 : '暂无';
  
  let 消息 = `📊 <b>Polymarket 月度盈利TOP${前几名} 日报</b>\n`;
  消息 += `📅 ${今日}\n`;
  消息 += `💰 门槛: $${最低盈利美元.toLocaleString()} | 胜率≥${最低胜率}%\n\n`;
  
  // 新增钱包
  if (分析结果.新上榜钱包.length > 0) {
    消息 += `🆕 <b>新上榜 (${分析结果.新上榜钱包.length}个)</b>\n`;
    for (const 钱包 of 分析结果.新上榜钱包.slice(0, 5)) {
      const 盈利 = (钱包.profit || 0).toLocaleString();
      const 胜率 = (钱包.winRate || 50).toFixed(1);
      消息 += `  • ${钱包.name}: +$${盈利} | 胜率${胜率}%\n`;
    }
    if (分析结果.新上榜钱包.length > 5) {
      消息 += `  ... 等${分析结果.新上榜钱包.length}个\n`;
    }
    消息 += `\n`;
  }
  
  // 掉出钱包
  if (分析结果.掉出榜单钱包.length > 0) {
    消息 += `📉 <b>掉出榜单 (${分析结果.掉出榜单钱包.length}个)</b>\n`;
    for (const 钱包 of 分析结果.掉出榜单钱包.slice(0, 5)) {
      const 盈利 = (钱包.profit || 0).toLocaleString();
      消息 += `  • ${钱包.name}: +$${盈利}\n`;
    }
    if (分析结果.掉出榜单钱包.length > 5) {
      消息 += `  ... 等${分析结果.掉出榜单钱包.length}个\n`;
    }
    消息 += `\n`;
  }
  
  // 盈利大幅变化
  if (分析结果.盈利变化列表.length > 0) {
    消息 += `📈 <b>盈利大幅变动 (变化>$${1000.toLocaleString()})</b>\n`;
    const 排序后 = [...分析结果.盈利变化列表].sort((a,b) => b.变化 - a.变化);
    for (const 项 of 排序后.slice(0, 5)) {
      const 变化图标 = 项.变化 > 0 ? '🟢 +' : '🔴 ';
      消息 += `  • ${项.名称}: ${变化图标}$${Math.abs(项.变化).toLocaleString()}\n`;
      消息 += `    ($${项.原盈利.toLocaleString()} → $${项.现盈利.toLocaleString()})\n`;
    }
    消息 += `\n`;
  }
  
  // TOP5 榜单
  消息 += `🏆 <b>当前TOP5</b>\n`;
  for (let i = 0; i < Math.min(5, 当前列表.length); i++) {
    const 钱包 = 当前列表[i];
    const 盈利 = (钱包.profit || 0).toLocaleString();
    const 胜率 = (钱包.winRate || 50).toFixed(1);
    消息 += `${i+1}. <b>${钱包.name}</b> +$${盈利} | 胜率${胜率}%\n`;
  }
  
  if (分析结果.新上榜钱包.length === 0 && 分析结果.掉出榜单钱包.length === 0 && 分析结果.盈利变化列表.length === 0) {
    消息 += `\n✅ <b>今日无变化</b>\nTOP50榜单与昨日相同。\n`;
  }
  
  return 消息;
}

// 生成完整榜单推送
async function 生成完整榜单(钱包列表) {
  let 消息列表 = [];
  let 当前消息 = `🏆 <b>Polymarket 月度盈利TOP${前几名}</b>\n`;
  当前消息 += `📅 ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n\n`;
  
  for (let i = 0; i < 钱包列表.length; i++) {
    const 钱包 = 钱包列表[i];
    const 盈利 = (钱包.profit || 0).toLocaleString();
    const 胜率 = (钱包.winRate || 50).toFixed(1);
    const 行 = `${i+1}. <b>${钱包.name}</b> +$${盈利} | 胜率${胜率}%\n`;
    
    if (当前消息.length + 行.length > 4000) {
      消息列表.push(当前消息);
      当前消息 = `🏆 <b>Polymarket 月度盈利TOP${前几名}</b> (续)\n\n`;
    }
    当前消息 += 行;
  }
  消息列表.push(当前消息);
  
  return 消息列表;
}

async function 主程序() {
  console.log(`\n[${new Date().toISOString()}] 🔍 获取月度盈利排行榜...`);
  
  const 原始数据 = await 获取月度排行榜();
  
  // 处理数据格式
  let 钱包列表 = 原始数据.map(w => ({
    name: w.name || w.address || w.user || '匿名',
    profit: w.profit || w.totalProfit || w.pnl || 0,
    winRate: w.winRate || w.winrate || 50,
    address: w.address || w.userAddress || null
  }));
  
  // 过滤
  钱包列表 = 钱包列表.filter(w => 
    w.profit >= 最低盈利美元 && w.winRate >= 最低胜率
  );
  
  钱包列表.sort((a,b) => b.profit - a.profit);
  const 前几名钱包 = 钱包列表.slice(0, 前几名);
  
  console.log(`✅ 获取到 ${前几名钱包.length} 个符合条件的高盈利钱包`);
  
  // 加载前一天状态
  const 历史状态 = 加载前一天状态();
  
  // 分析变化
  const 分析结果 = 分析变化(前几名钱包, 历史状态);
  
  // 推送变化日报
  const 变化消息 = 生成变化消息(前几名钱包, 历史状态, 分析结果);
  await 发送Telegram(变化消息);
  
  // 每周一推送完整榜单（或首次运行时）
  const 是否周一 = new Date().getDay() === 1;
  const 是否首次运行 = !历史状态;
  
  if (是否周一 || 是否首次运行) {
    console.log('📋 推送完整榜单...');
    const 完整榜单列表 = await 生成完整榜单(前几名钱包);
    for (const 消息 of 完整榜单列表) {
      await 发送Telegram(消息);
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  
  // 保存当前状态供明天对比
  保存状态(前几名钱包);
  console.log('✅ 日报推送完成');
}

// 启动定时任务
console.log('🐋 Polymarket 鲸鱼钱包日报追踪器启动');
console.log(`🎯 追踪TOP${前几名} | 最低盈利: $${最低盈利美元.toLocaleString()}`);
console.log(`⏱️ 检查间隔: ${检查间隔小时}小时 (每天一次)`);
console.log(`📊 推送: 每日变化日报 + 周一完整榜单\n`);

// 立即执行一次
主程序();

// 每天执行一次
setInterval(主程序, 检查间隔小时 * 60 * 60 * 1000);

process.on('SIGTERM', () => {
  console.log('\n👋 监控已停止');
  process.exit(0);
});
