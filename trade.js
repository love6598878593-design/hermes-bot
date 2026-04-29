require('dotenv').config();
const fetch = require('node-fetch');

const PK = process.env.POLYMARKET_PRIVATE_KEY;
if (!PK) { console.log('❌ 缺少私钥'); process.exit(1); }

async function main() {
  const r = await fetch('https://gamma-api.polymarket.com/markets?limit=100&active=true&closed=false');
  const markets = await r.json();

  const btc = markets.find(m =>
    /btc|bitcoin/i.test((m.slug||'')+(m.question||'')) &&
    /price|above|below|up|down/i.test(m.question||'')
  );
  if (!btc) { console.log('❌ 无市场'); return; }

  const tokens = JSON.parse(btc.clobTokenIds);
  const yesToken = tokens[0];
  console.log('市场:', btc.question);

  const { ClobClient } = require('@polymarket/clob-client');
  const client = new ClobClient({ privateKey: PK, chainId: 137, signatureType: 1 });
  const order = await client.createMarketOrder({ tokenId: yesToken, side: 'buy', size: 1 });
  console.log('✅ 下单结果:', JSON.stringify(order));
}

main().catch(e => console.error('❌', e.message));
