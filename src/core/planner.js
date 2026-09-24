import { ROUTE, COLS, ROWS, CELLS, clamp, cellPoint, detectionProbability, distance, wrapAngle } from './grid.js';
export function informationGain(track, observer) {
  const e = track.estimate, dx = e.x - observer.x, dy = e.y - observer.y, r = Math.hypot(dx, dy);
  if (r < 2 || r > 12) return 0;
  const ux = dx / r, uy = dy / r, bx = -dy / (r * r), by = dx / (r * r);
  const sr = 1.15 * (1 + .025 * r), sa = .12 * (1 + .02 * r);
  const a = ux * ux / sr ** 2 + bx * bx / sa ** 2;
  const b = uy * uy / sr ** 2 + by * by / sa ** 2;
  const c = ux * uy / sr ** 2 + bx * by / sa ** 2;
  const determinant = 1 + e.xx * a + e.yy * b + 2 * e.xy * c + Math.max(0, e.xx * e.yy - e.xy ** 2) * Math.max(0, a * b - c ** 2);
  return .5 * Math.log(Math.max(1, determinant));
}
export function plan(sensor, tracker, coverage, peers, tick, mode = 'adaptive') {
  let best = null;
  const scorePoint = (p, gain, reason, target = null) => {
    const travel = distance(sensor, p);
    const crowding = peers.filter(other => other.id !== sensor.id && other.band === sensor.band && other.waypoint && distance(other.waypoint, p) < 3).length;
    // Modest hysteresis prevents replanning from repeatedly abandoning a useful approach.
    const commitment = target !== null && sensor.waypoint?.target === target ? 1.35 : 1;
    const score = gain * commitment / (1 + .14 * travel) / (1 + crowding * 1.8);
    if (!best || score > best.score) best = { ...p, score, reason, target };
  };
  // Reserve regular exploration slots so an uncertain or spurious candidate cannot monopolize the search.
  const allowRevisit = mode === 'adaptive' && Math.floor(tick / 8) % 3 !== 0;
  if (allowRevisit) for (const track of tracker.active(tick)) {
    if (track.band !== sensor.band || track.status === 'confirmed' || track.status === 'conflict') continue;
    const e = track.estimate;
    // High uncertainty alone is not evidence: diffuse, contradictory clutter must not outrank a corroborated candidate.
    const coherence = Math.min(1, track.support / 3) * track.support / Math.max(1, track.accepted);
    if (!coherence) continue;
    for (const radius of [4, 7, 10]) for (let k = 0; k < 12; k++) {
      const a = k * Math.PI / 6;
      const p = { x: clamp(e.x + Math.cos(a) * radius, .5, COLS - .5), y: clamp(e.y + Math.sin(a) * radius, .5, ROWS - .5) };
      let diversity = 1;
      if (track.views.length) {
        const view = track.views[track.views.length - 1], old = Math.atan2(view.y - e.y, view.x - e.x);
        diversity = .5 + Math.abs(Math.sin(wrapAngle(a - old)));
      }
      // Compact estimates can still need an independent witness; pure entropy gain misses that need.
      const evidenceGap = Math.max(.15, (5 - track.support) / 5);
      const needsWitness = track.supportingObservers.size < 2;
      const independentView = track.supportingObservers.has(sensor.id) ? .5 : 1.5;
      const geometryGap = Math.max(0, 1 - track.diversity / (Math.PI / 7.2));
      const evidenceValue = evidenceGap + (needsWitness ? 1 : geometryGap);
      const freshness = 1 / (1 + Math.max(0, tick - track.lastAccepted) / 96);
      const gain = (informationGain(track, p) * diversity + 1.5 * evidenceValue * independentView) * detectionProbability(distance(p, e)) * freshness * coherence;
      scorePoint(p, 15 * gain, 'Reduce uncertainty', track.id);
    }
  }
  for (let j = 0; j < 20; j++) {
    const index = (sensor.cursor + j * 53) % CELLS, p = cellPoint(ROUTE[index]);
    const gain = coverage.gain(p, sensor.band);
    scorePoint(p, gain, 'Expand coverage');
  }
  if (!best || best.score < .001) {
    sensor.cursor = (sensor.cursor + 1) % CELLS;
    best = { ...cellPoint(ROUTE[sensor.cursor]), score: 0, reason: 'Circumnavigation', target: null };
  }
  if (best.reason === 'Expand coverage') sensor.cursor = (sensor.cursor + 29) % CELLS;
  return best;
}
