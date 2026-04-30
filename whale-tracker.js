require('dotenv').config();
const axios = require('axios');
const fs = require('fs');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// 配置
const TOP_N = 50;
const MIN_PROFIT_USD = 0;      // 不按盈利过滤，全显示
const CHECK_INTERVAL_MIN = 60; // 分钟
const STATE_FILE = '/tmp/whale_top50.json';

// 工具：发送 Telegram
async function sendTelegram(msg) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return false;
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: msg,
      parse_mode: 'HTML'
    });
    console.log('✅ 推送成功');
    return true;
  } catch (e) {
    console.error('❌ 推送失败:', e.message);
    return false;
  }
}

// 从 API 获取真实 TOP 50 钱包
async function fetchRealTopWallets() {
  const url = 'https://data-api.polymarket.com/v1/leaderboard?category=OVERALL&timePeriod=MONTH&orderBy=PNL&limit=50';
  const res = await axios.get(url, { timeout: 15000 });
  const list = res.data;

  return list.map(item => ({
    rank: item.rank,
    address: item.proxyWallet,
    name: item.userName || item.proxyWallet.slice(0, 10) + '…',
    pnl: parseFloat(item.pnl || 0),
    vol: parseFloat(item.vol || 0)
  }));
}

// 保存状态到文件
function saveState(wallets) {
  const toSave = {
    date: new Date().toISOString().split('T')[0],
    wallets: wallets.map(w => ({
      address: w.address,
      name: w.name,
      pnl: w.pnl
    }))
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(toSave, null, 2));
  console.log('💾 状态已保存');
}

// 加载上次状态
function loadPreviousState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch (e) {}
  return null;
}

// 分析变化（新上榜 / 掉出榜单 / 盈利大幅变化）
function analyzeChanges(current, previous) {
  if (!previous || !previous.wallets) return null;

  const prevMap = new Map();
  for (const p of previous.wallets) prevMap.set(p.address, p);

  const newWallets = [];
  const droppedWallets = [];
  const profitChanges = [];

  for (const c of current) {
    const old = prevMap.get(c.address);
    if (!old) {
      newWallets.push(c);
    } else {
      const change = c.pnl - old.pnl;
      if (Math.abs(change) > 1000) {
        profitChanges.push({ ...c, oldPnl: old.pnl, change });
      }
    }
  }

  const currentSet = new Set(current.map(c => c.address));
  for (const p of previous.wallets) {
    if (!currentSet.has(p.address)) droppedWallets.push(p);
  }

  return { newWallets, droppedWallets, profitChanges };
}

// 生成变化日报
function formatDailyReport(current, previous, analysis) {
  const today = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  let msg = `📊 <b>Polymarket 月度盈利 TOP50 日报</b>\n📅 ${today}\n💰 统计对象：真实链上地址\n\n`;

  if (analysis.newWallets.length) {
    msg += `🆕 <b>新上榜 (${analysis.newWallets.length})</b>\n`;
    for (const w of analysis.newWallets.slice(0, 5)) {
      msg += `  • ${w.name}\n    💰 $${w.pnl.toLocaleString()}\n`;
    }
    if (analysis.newWallets.length > 5) msg += `  … 等${analysis.newWallets.length}个\n`;
    msg += `\n`;
  }

  if (analysis.droppedWallets.length) {
    msg += `📉 <b>掉出榜单 (${analysis.droppedWallets.length})</b>\n`;
    for (const w of analysis.droppedWallets.slice(0, 5)) {
      msg += `  • ${w.name}\n    💰 $${w.pnl.toLocaleString()}\n`;
    }
    if (analysis.droppedWallets.length > 5) msg += `  … 等${analysis.droppedWallets.length}个\n`;
    msg += `\n`;
  }

  if (analysis.profitChanges.length) {
    msg += `📈 <b>盈利大幅变动 (变化 > $1,000)</b>\n`;
    const sorted = [...analysis.profitChanges].sort((a,b) => b.change - a.change);
    for (const c of sorted.slice(0, 5)) {
      const icon = c.change > 0 ? '🟢 +' : '🔴 ';
      msg += `  • ${c.name}: ${icon}$${Math.abs(c.change).toLocaleString()}\n`;
    }
    msg += `\n`;
  }

  msg += `🏆 <b>当前 TOP5</b>\n`;
  for (let i = 0; i < Math.min(5, current.length); i++) {
    const w = current[i];
    msg += `${i+1}. <b>${w.name}</b> +$${w.pnl.toLocaleString()}\n`;
  }

  if (!analysis.newWallets.length && !analysis.droppedWallets.length && !analysis.profitChanges.length) {
    msg += `✅ 今日无变化，TOP50 榜单稳定。\n`;
  }

  return msg;
}

// 生成完整榜单（周一或首次）
function formatFullList(wallets) {
  const today = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  let msg = `🏆 <b>Polymarket 月度盈利 TOP50</b>\n📅 ${today}\n\n`;
  for (let i = 0; i < wallets.length; i++) {
    const w = wallets[i];
    msg += `${i+1}. <b>${w.name}</b> +$${w.pnl.toLocaleString()}\n`;
    if ((i + 1) % 20 === 0 && i + 1 !== wallets.length) msg += '\n';
  }
  return msg;
}

// 主逻辑
async function main() {
  console.log(`[${new Date().toISOString()}] 🔍 抓取真实 TOP50 钱包...`);
  const currentWallets = await fetchRealTopWallets();

  const previous = loadPreviousState();
  const analysis = analyzeChanges(currentWallets, previous);

  // 推送变化日报
  if (analysis) {
    const dailyMsg = formatDailyReport(currentWallets, previous, analysis);
    await sendTelegram(dailyMsg);
  } else {
    await sendTelegram(`📊 Polymarket 月度盈利 TOP50 监控启动\n✅ 首次运行，明日开始推送变化`);
  }

  // 周一 或 首次运行时推送完整榜单
  const isMonday = new Date().getDay() === 1;
  const isFirstRun = !previous;
  if (isMonday || isFirstRun) {
    console.log('📋 推送完整榜单...');
    const fullMsg = formatFullList(currentWallets);
    await sendTelegram(fullMsg);
  }

  saveState(currentWallets);
  console.log('✅ 日报推送完成');
}

// 启动定时器
console.log('🐋 真实 Polymarket 聪明钱追踪器启动');
console.log(`⏱️ 检查间隔: ${CHECK_INTERVAL_MIN} 分钟`);
main();
setInterval(main, CHECK_INTERVAL_MIN * 60 * 1000);
