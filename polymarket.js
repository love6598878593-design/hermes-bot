async function fetchAllMarkets(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedMarkets && (now - cachedTime) < CACHE_TTL) {
    return cachedMarkets;
  }

  try {
    const res = await axios.get(`${POLYMARKET_API}/markets`, {
      params: { limit: 500 }, // 暂时去掉 closed 参数，改为手动过滤
      timeout: 15000
    });

    // 更加稳健的数据提取逻辑
    let rawData = res.data;
    if (rawData.data && Array.isArray(rawData.data)) rawData = rawData.data;
    else if (rawData.markets && Array.isArray(rawData.markets)) rawData = rawData.markets;
    
    if (!Array.isArray(rawData)) {
        console.error("   ❌ Unexpected API response format:", JSON.stringify(res.data).substring(0, 100));
        return cachedMarkets || [];
    }

    // 修复：放宽过滤条件，有些市场可能没有 active 字段
    const markets = rawData.filter(m => 
      m.closed === false && 
      m.active !== false
    );

    // 如果过滤后是 0，尝试不过滤，看看原始数据里有什么
    if (markets.length === 0 && rawData.length > 0) {
        console.log(`   ⚠️ Warning: Filtering reduced ${rawData.length} to 0. Using raw data.`);
        cachedMarkets = rawData;
    } else {
        cachedMarkets = markets;
    }

    console.log(`   📦 Fetched ${cachedMarkets.length} active markets`);
    cachedTime = now;
    return cachedMarkets;

  } catch (err) {
    console.error(`   Fetch markets error: ${err.message}`);
    return cachedMarkets || [];
  }
}
