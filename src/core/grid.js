export const COLS = 42, ROWS = 32, BANDS = 4, CELLS = COLS * ROWS;
export const SENSOR_RANGE = 12;
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const cellPoint = id => ({ x: id % COLS + .5, y: Math.floor(id / COLS) + .5 });
export function spiral() {
  const cells = [];
  for (let r = 0; r < 16; r++) {
    const right = COLS - 1 - r, bottom = ROWS - 1 - r;
    for (let x = r; x <= right; x++) cells.push(r * COLS + x);
    for (let y = r + 1; y <= bottom; y++) cells.push(y * COLS + right);
    for (let x = right - 1; x >= r; x--) cells.push(bottom * COLS + x);
    for (let y = bottom - 1; y > r; y--) cells.push(y * COLS + r);
  }
  return cells;
}
export const ROUTE = spiral();
export function random(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
export function sampleRandom(seed, tick, sensor, beacon) {
  return random((seed ^ Math.imul(tick + 1, 73856093) ^ Math.imul(sensor + 1, 19349663) ^ Math.imul(beacon + 1, 83492791)) >>> 0);
}
export function normal(rng) {
  return Math.sqrt(-2 * Math.log(Math.max(1e-12, rng()))) * Math.cos(2 * Math.PI * rng());
}
export function detectionProbability(r) {
  return r <= SENSOR_RANGE ? .94 * Math.exp(-.5 * (r / 9) ** 2) : 0;
}
export class Coverage {
  constructor() {
    this.probability = Array.from({ length: BANDS }, () => new Float64Array(CELLS));
    this.visits = Array.from({ length: BANDS }, () => new Uint16Array(CELLS));
    this.counts = new Uint16Array(BANDS);
  }
  apply({ x, y, band }) {
    const cells = this.probability[band], visits = this.visits[band];
    const minX = Math.max(0, Math.floor(x - SENSOR_RANGE)), maxX = Math.min(COLS - 1, Math.ceil(x + SENSOR_RANGE));
    const minY = Math.max(0, Math.floor(y - SENSOR_RANGE)), maxY = Math.min(ROWS - 1, Math.ceil(y + SENSOR_RANGE));
    for (let cy = minY; cy <= maxY; cy++) for (let cx = minX; cx <= maxX; cx++) {
      const id = cy * COLS + cx, p = detectionProbability(Math.hypot(cx + .5 - x, cy + .5 - y));
      if (!p) continue;
      const previous = cells[id];
      cells[id] = 1 - (1 - previous) * (1 - p);
      visits[id] = Math.min(65535, visits[id] + 1);
      if (previous < .9 && cells[id] >= .9) this.counts[band]++;
    }
  }
  gain(point, band) {
    let total = 0;
    // A four-cell quadrature keeps planning bounded and never reads scenario truth.
    for (let y = 0; y < ROWS; y += 4) for (let x = 0; x < COLS; x += 4) {
      total += (1 - this.probability[band][y * COLS + x]) * detectionProbability(Math.hypot(x + .5 - point.x, y + .5 - point.y));
    }
    return total;
  }
  get fraction() { return this.counts.reduce((a, b) => a + b, 0) / (CELLS * BANDS); }
}
