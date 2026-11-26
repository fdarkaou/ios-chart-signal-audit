export function diffReports(current, previous) {
  if (!previous || !Array.isArray(previous.items)) {
    return null;
  }

  const prevMap = new Map(previous.items.map((item) => [String(item.storeId), item]));
  const currMap = new Map(current.items.map((item) => [String(item.storeId), item]));

  const entered = [];
  const exited = [];
  const rankMovers = [];
  const adRamps = [];
  const organicSpikes = [];
  const driverShifts = [];

  for (const item of current.items) {
    const prev = prevMap.get(String(item.storeId));
    if (!prev) {
      entered.push({
        storeId: item.storeId,
        name: item.name,
        rank: item.rank,
        movement: item.movement,
        driver: item.driver,
        driverLabel: item.driverLabel,
      });
      continue;
    }

    if (typeof item.rank === "number" && typeof prev.rank === "number") {
      const rankGain = prev.rank - item.rank;
      if (rankGain !== 0) {
        rankMovers.push({
          storeId: item.storeId,
          name: item.name,
          previousRank: prev.rank,
          rank: item.rank,
          rankGain,
        });
      }
    }

    const prevLive = prev.paid?.liveAds ?? null;
    const currLive = item.paid?.liveAds ?? null;
    if (currLive !== null && (prevLive === null || currLive !== prevLive)) {
      const delta = prevLive === null ? currLive : currLive - prevLive;
      if (delta !== 0) {
        adRamps.push({
          storeId: item.storeId,
          name: item.name,
          previousLiveAds: prevLive,
          liveAds: currLive,
          delta,
        });
      }
    }

    const prevViews = prev.organic?.views ?? null;
    const currViews = item.organic?.views ?? null;
    if (currViews !== null && (prevViews === null || currViews > prevViews)) {
      const delta = prevViews === null ? currViews : currViews - prevViews;
      if (delta >= 50_000) {
        organicSpikes.push({
          storeId: item.storeId,
          name: item.name,
          previousViews: prevViews,
          views: currViews,
          delta,
        });
      }
    }

    if (prev.driver !== item.driver) {
      driverShifts.push({
        storeId: item.storeId,
        name: item.name,
        from: prev.driver,
        to: item.driver,
      });
    }
  }

  for (const prev of previous.items) {
    if (!currMap.has(String(prev.storeId))) {
      exited.push({
        storeId: prev.storeId,
        name: prev.name,
        previousRank: prev.rank,
        driver: prev.driver,
      });
    }
  }

  rankMovers.sort((a, b) => Math.abs(b.rankGain) - Math.abs(a.rankGain));
  adRamps.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  organicSpikes.sort((a, b) => b.delta - a.delta);

  return {
    previousDay: previous.snapshot?.day || previous.generatedAt || null,
    currentDay: current.snapshot?.day || current.generatedAt || null,
    entered,
    exited,
    rankMovers,
    adRamps,
    organicSpikes,
    driverShifts,
  };
}
