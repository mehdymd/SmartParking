export function findNearestSlot(slots, entrancePx, pixelsPerMeter) {
  const available = slots.filter(s => s.status === 'available');
  if (available.length === 0) return null;

  const withDist = available.map(s => ({
    ...s,
    dist: Math.hypot(s.cx - entrancePx.x, s.cy - entrancePx.y)
  }));

  withDist.sort((a, b) => a.dist - b.dist);
  return withDist[0];
}
