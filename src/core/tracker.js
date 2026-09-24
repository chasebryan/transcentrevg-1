import { CELLS, COLS, ROWS, wrapAngle } from './grid.js';
const UNIFORM_LIKELIHOOD = 1 / (Math.hypot(COLS, ROWS) * 2 * Math.PI);
export class BeaconTrack {
  constructor(id, band) {
    this.id = id; this.band = band;
    this.posterior = new Float64Array(CELLS).fill(1 / CELLS);
    this.accepted = 0; this.rejected = 0; this.weight = 0;
    this.observers = new Set(); this.views = []; this.buckets = new Map();
    this.lastSeen = 0; this.lastAccepted = 0; this.consecutiveRejected = 0;
    this.status = 'candidate'; this.history = []; this.measurements = []; this.firstConfirmedTick = null;
    this.summarize();
  }
  summarize() {
    let x = 0, y = 0, entropy = 0, peak = 0;
    for (let i = 0; i < CELLS; i++) {
      const p = this.posterior[i]; x += p * (i % COLS + .5); y += p * (Math.floor(i / COLS) + .5);
      if (p > 0) entropy -= p * Math.log(p);
      if (p > this.posterior[peak]) peak = i;
    }
    let xx = 0, yy = 0, xy = 0;
    const distances = [];
    for (let i = 0; i < CELLS; i++) {
      const dx = i % COLS + .5 - x, dy = Math.floor(i / COLS) + .5 - y, p = this.posterior[i];
      xx += p * dx * dx; yy += p * dy * dy; xy += p * dx * dy;
      if (p > 1e-9) distances.push([Math.hypot(dx, dy), p]);
    }
    distances.sort((a, b) => a[0] - b[0]);
    let mass = 0, radius95 = 0;
    for (const [d, p] of distances) { mass += p; radius95 = d; if (mass >= .95) break; }
    // Each grid hypothesis represents a whole unit cell, not an infinitely precise point.
    radius95 += Math.SQRT1_2;
    this.estimate = { x, y, xx: xx + 1 / 12, yy: yy + 1 / 12, xy, radius95, entropy, peak };
    const support = this.measurements.filter(z => {
      const dx = x - z.x, dy = y - z.y, r = Math.max(.2, Math.hypot(dx, dy));
      const dr = r - z.range, da = wrapAngle(Math.atan2(dy, dx) - z.bearing);
      return dr * dr / (z.sigmaRange ** 2 + 1 / 12) + da * da / (z.sigmaBearing ** 2 + 1 / (12 * r * r)) <= 9.21;
    });
    this.support = support.length;
    const supportingSensors = new Set(support.map(z => z.origin));
    this.supportingObservers = supportingSensors;
    let diversity = 0;
    for (let a = 0; a < support.length; a++) for (let b = a + 1; b < support.length; b++) {
      const u = support[a], v = support[b];
      if (u.origin === v.origin || Math.hypot(u.x - v.x, u.y - v.y) < 3) continue;
      // The sine penalizes collinear views on either side of the estimate.
      const angle = wrapAngle(Math.atan2(u.y - y, u.x - x) - Math.atan2(v.y - y, v.x - x));
      diversity = Math.max(diversity, Math.asin(Math.abs(Math.sin(angle))));
    }
    this.diversity = diversity;
    this.status = this.consecutiveRejected >= 4 ? 'conflict' :
      support.reduce((s,z) => s + z.weight, 0) >= 3 && support.length >= 5 && supportingSensors.size >= 2 && diversity >= Math.PI / 7.2 && radius95 <= 2.5 ? 'confirmed' :
      this.accepted >= 2 ? 'localising' : 'candidate';
  }
  innovation(z) {
    const e = this.estimate, dx = e.x - z.x, dy = e.y - z.y, r = Math.max(.1, Math.hypot(dx, dy));
    const ux = dx / r, uy = dy / r, bx = -dy / (r * r), by = dx / (r * r);
    const a = ux * ux * e.xx + 2 * ux * uy * e.xy + uy * uy * e.yy + z.sigmaRange ** 2;
    const b = bx * bx * e.xx + 2 * bx * by * e.xy + by * by * e.yy + z.sigmaBearing ** 2;
    const c = ux * bx * e.xx + (ux * by + uy * bx) * e.xy + uy * by * e.yy;
    const dr = z.range - r, da = wrapAngle(z.bearing - Math.atan2(dy, dx));
    return (b * dr * dr - 2 * c * dr * da + a * da * da) / Math.max(1e-10, a * b - c * c);
  }
  update(z, receivedTick = z.tick) {
    if (z.band !== this.band || z.beacon !== this.id) throw new Error('Track/measurement mismatch');
    this.lastSeen = Math.max(this.lastSeen, z.tick);
    const nis = this.innovation(z);
    if (this.accepted >= 3 && this.estimate.radius95 < 8 && nis > 16) {
      this.rejected++; this.consecutiveRejected++; this.summarize();
      return { accepted: false, reason: 'innovation-gate', nis };
    }
    const bucket = `${z.origin}:${Math.floor(z.x / 3)}:${Math.floor(z.y / 3)}`;
    const count = this.buckets.get(bucket) || 0;
    const weight = 1 / (count + 1) ** 2;
    this.buckets.set(bucket, count + 1);
    const logs = new Float64Array(CELLS), normalization = 1 / (2 * Math.PI * z.sigmaRange * z.sigmaBearing);
    let maximum = -Infinity;
    for (let i = 0; i < CELLS; i++) {
      const dx = i % COLS + .5 - z.x, dy = Math.floor(i / COLS) + .5 - z.y;
      const dr = (Math.hypot(dx, dy) - z.range) / z.sigmaRange;
      const da = wrapAngle(Math.atan2(dy, dx) - z.bearing) / z.sigmaBearing;
      const likelihood = .92 * normalization * Math.exp(-.5 * (dr * dr + da * da)) + .08 * UNIFORM_LIKELIHOOD;
      logs[i] = Math.log(Math.max(1e-300, this.posterior[i])) + weight * Math.log(likelihood);
      maximum = Math.max(maximum, logs[i]);
    }
    let sum = 0;
    for (let i = 0; i < CELLS; i++) { this.posterior[i] = Math.exp(logs[i] - maximum); sum += this.posterior[i]; }
    for (let i = 0; i < CELLS; i++) this.posterior[i] /= sum;
    this.accepted++; this.weight += weight; this.observers.add(z.origin);
    this.lastAccepted = Math.max(this.lastAccepted, z.tick); this.consecutiveRejected = 0;
    this.measurements.push({ ...z, weight }); if (this.measurements.length > 60) this.measurements.shift();
    this.views.push({ x: z.x, y: z.y, origin: z.origin });
    if (this.views.length > 40) this.views.shift();
    this.summarize();
    if (this.status === 'confirmed' && this.firstConfirmedTick === null) this.firstConfirmedTick = receivedTick;
    this.history.push({ tick: z.tick, x: this.estimate.x, y: this.estimate.y, radius95: this.estimate.radius95 });
    if (this.history.length > 80) this.history.shift();
    return { accepted: true, weight, nis };
  }
  snapshot() {
    return { id: this.id, band: this.band, status: this.status, accepted: this.accepted, rejected: this.rejected,
      support: this.support, supportingObservers: [...this.supportingObservers], firstConfirmedTick: this.firstConfirmedTick,
      effectiveObservations: this.weight, observers: [...this.observers], geometryDegrees: this.diversity * 180 / Math.PI,
      lastSeen: this.lastSeen, estimate: { ...this.estimate } };
  }
}
export class Tracker {
  constructor() { this.tracks = new Map(); }
  ingest(z, receivedTick = z.tick) {
    const key = `${z.band}:${z.beacon}`;
    if (!this.tracks.has(key)) {
      if (this.tracks.size >= 64) return { accepted: false, reason: 'track-limit' };
      this.tracks.set(key, new BeaconTrack(z.beacon, z.band));
    }
    return this.tracks.get(key).update(z, receivedTick);
  }
  active(tick) {
    // Corroborated static candidates survive two full 96-step receiver/band rotations.
    // A single clutter report expires sooner; confirmation still requires fresh independent evidence.
    return [...this.tracks.values()].filter(t => tick - t.lastAccepted <= (t.support >= 2 ? 192 : 80) || t.status === 'confirmed');
  }
  snapshots() { return [...this.tracks.values()].map(t => t.snapshot()); }
}
