async function placeOrder(tokenId, side, size) {
  if (DRY_RUN) {
    console.log(`🔸 [DRY RUN] ${side} $${size}`);
    return { dryRun: true };
  }

  try {
    const { ClobClient } = require('@polymarket/clob-client');
    const pk = process.env.POLYMARKET_PRIVATE_KEY;
    if (!pk) throw new Error("缺少私钥");

    const client = new ClobClient({
      privateKey: pk,
      chainId: 137,
      signatureType: 1
    });

    const order = await client.createMarketOrder({
      tokenId: tokenId,
      side: side === 'yes' ? 'buy' : 'sell',
      size: size
    });

    console.log(`💰 实盘下单成功: ${side} $${size}`);
    await sendNotification(`💰 *实盘下单成功*\n方向: ${side}\n金额: $${size}`);
    return order;
  } catch (e) {
    console.error('下单失败:', e.message);
    await sendNotification(`❌ *下单失败*\n${e.message}`);
    return null;
  }
}
