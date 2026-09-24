import { COLS, ROWS, BANDS, CELLS, Coverage, random, sampleRandom, normal, detectionProbability, wrapAngle, clamp, distance } from './grid.js';
import { OBSERVATION, SCAN } from './codec.js';
import { Tracker } from './tracker.js';
import { plan } from './planner.js';
import { RelayNetwork } from './relay.js';

export function makeScenario(seed, perBand = 2) {
  const rng = random(seed), beacons = [];
  for (let band = 0; band < BANDS; band++) for (let j = 0; j < perBand; j++) {
    beacons.push({ id: 100 + band * 10 + j, band, x: 3 + rng() * (COLS - 6), y: 3 + rng() * (ROWS - 6) });
  }
  return beacons;
}
function observation(sensor, beacon, tick, seed, outliers) {
  const rng = sampleRandom(seed, tick, sensor.id, beacon.id), r = distance(sensor, beacon);
  if (rng() > detectionProbability(r)) return null;
  const sigmaRange = 1.15 * (1 + .025 * r), sigmaBearing = .12 * (1 + .02 * r);
  let range = clamp(r + normal(rng) * sigmaRange, 0, 60);
  let bearing = wrapAngle(Math.atan2(beacon.y - sensor.y, beacon.x - sensor.x) + normal(rng) * sigmaBearing);
  if (rng() < outliers) { range = 2 + rng() * 28; bearing = rng() * Math.PI * 2 - Math.PI; }
  return { type: OBSERVATION, origin: sensor.id, band: sensor.band, beacon: beacon.id, x: sensor.x, y: sensor.y,
    range, bearing, sigmaRange, sigmaBearing, quality: Math.round(255 * detectionProbability(r)), tick };
}
export class Simulation {
  constructor(options = {}) {
    this.config = { seed: 73, epoch: 1, mode: 'adaptive', loss: .04, corruption: .01, outliers: .08, hops: 8, limit: 360, ...options };
    if (!Number.isInteger(this.config.seed) || !Number.isInteger(this.config.epoch) || this.config.epoch < 0 || this.config.epoch > 65535 || !['adaptive', 'coverage'].includes(this.config.mode)) throw new Error('Invalid mission configuration');
    for (const name of ['loss','corruption','outliers']) if (!Number.isFinite(this.config[name]) || this.config[name] < 0 || this.config[name] > 1) throw new Error('Invalid ' + name);
    if (!Number.isInteger(this.config.hops) || this.config.hops < 1 || this.config.hops > 16 || !Number.isInteger(this.config.limit) || this.config.limit < 1 || this.config.limit > 480) throw new Error('Invalid mission bounds');
    this.tick = 0; this.coverage = new Coverage(); this.tracker = new Tracker(); this.controls = []; this.timeline = [];
    this.latest = null; this.deliveredAudio = []; this.status = 'ready';
    // Scenario truth belongs exclusively to the observation generator and evaluator.
    // Neither Tracker nor plan() receives this array.
    this.truth = makeScenario(this.config.seed);
    const starts = [[1.5,1.5],[40.5,1.5],[40.5,30.5],[1.5,30.5]];
    this.sensors = starts.map(([x,y], i) => ({ id: i + 1, x, y, band: i, cursor: i * 336, waypoint: null, online: true, trail: [], lastSent: new Map() }));
    this.network = new RelayNetwork(this.config, (p, bytes) => {
      if (p.type === SCAN) this.coverage.apply(p);
      else {
        const result = this.tracker.ingest(p, this.tick); this.latest = { ...p, ...result };
        this.deliveredAudio.push(bytes);
        if (this.deliveredAudio.length > 8) this.deliveredAudio.shift();
      }
    });
  }
  setOnline(id, online) {
    if (!Number.isInteger(id) || id < 1 || id > 4) throw new Error('Invalid relay');
    this.sensors[id - 1].online = !!online; this.network.online[id] = !!online;
    this.controls.push({ tick: this.tick, type: 'online', id, value: !!online });
  }
  step() {
    if (this.tick >= this.config.limit) { this.status = 'finished'; return false; }
    this.tick++; this.status = 'running';
    for (const sensor of this.sensors) {
      if (!sensor.online) continue;
      const band = (sensor.id - 1 + Math.floor((this.tick - 1) / 24)) % BANDS;
      if (band !== sensor.band) sensor.waypoint = null;
      sensor.band = band;
      if (!sensor.waypoint || this.tick % 6 === 1 || distance(sensor, sensor.waypoint) < .4) {
        sensor.waypoint = plan(sensor, this.tracker, this.coverage, this.sensors, this.tick, this.config.mode);
      }
      const d = distance(sensor, sensor.waypoint), step = Math.min(1, d);
      if (d > 0) { sensor.x += (sensor.waypoint.x - sensor.x) / d * step; sensor.y += (sensor.waypoint.y - sensor.y) / d * step; }
      sensor.trail.push({ x: sensor.x, y: sensor.y, band }); if (sensor.trail.length > 60) sensor.trail.shift();
      if ((this.tick + sensor.id) % 4 === 0) this.network.enqueue({ type: SCAN, origin: sensor.id, band, beacon: 0,
        x: sensor.x, y: sensor.y, range: 12, bearing: 0, sigmaRange: 1, sigmaBearing: .1, quality: 255, tick: this.tick }, this.tick);
      for (const beacon of this.truth) {
        if (beacon.band !== band || this.tick - (sensor.lastSent.get(beacon.id) ?? -100) < 6) continue;
        const z = observation(sensor, beacon, this.tick, this.config.seed, this.config.outliers);
        if (z) { this.network.enqueue(z, this.tick); sensor.lastSent.set(beacon.id, this.tick); }
      }
      // Occasional decoded clutter, with identifiers shared across receivers.
      const clutter = sampleRandom(this.config.seed, this.tick, sensor.id, 65000);
      if (clutter() < .018) this.network.enqueue({ type: OBSERVATION, origin: sensor.id, band, beacon: 60000 + Math.floor(clutter() * 3),
        x: sensor.x, y: sensor.y, range: 2 + clutter() * 10, bearing: clutter() * 2 * Math.PI - Math.PI,
        sigmaRange: 1.5, sigmaBearing: .2, quality: 100, tick: this.tick }, this.tick);
    }
    this.network.step(this.tick);
    if (this.tick % 12 === 0) this.timeline.push({ tick: this.tick, coverage: this.coverage.fraction,
      confirmed: this.tracker.snapshots().filter(t => t.status === 'confirmed').length });
    if (this.tick === this.config.limit) this.status = 'finished';
    return true;
  }
  run(ticks = this.config.limit) { for (let n = 0; n < ticks; n++) if (!this.step()) break; return this; }
  evaluate() {
    const tracks = this.tracker.snapshots(), ids = new Set(this.truth.map(t => `${t.band}:${t.id}`));
    const matches = this.truth.map(beacon => {
      const track = tracks.find(t => t.band === beacon.band && t.id === beacon.id);
      return { id: beacon.id, band: beacon.band, detected: !!track, confirmed: track?.status === 'confirmed',
        error: track ? Math.hypot(track.estimate.x - beacon.x, track.estimate.y - beacon.y) : null,
        radius95: track?.estimate.radius95 ?? null, firstConfirmedTick: track?.firstConfirmedTick ?? null,
        containsTruth95: track ? Math.hypot(track.estimate.x - beacon.x, track.estimate.y - beacon.y) <= track.estimate.radius95 : false };
    });
    const errors = matches.filter(t => t.confirmed).map(t => t.error).sort((a,b) => a-b);
    const medianError = errors.length ? (errors[Math.floor((errors.length-1)/2)] + errors[Math.floor(errors.length/2)]) / 2 : null;
    return { total: this.truth.length, detected: matches.filter(t => t.detected).length, confirmed: matches.filter(t => t.confirmed).length,
      falseConfirmed: tracks.filter(t => t.status === 'confirmed' && !ids.has(`${t.band}:${t.id}`)).length,
      falseEverConfirmed: tracks.filter(t => t.firstConfirmedTick !== null && !ids.has(`${t.band}:${t.id}`)).length,
      medianError, matches };
  }
  report() {
    return { format: 'TranscentreVG-1/mission-v1', config: { ...this.config }, tick: this.tick, status: this.status,
      controls: this.controls, coverage: { fraction: this.coverage.fraction, threshold: .9, counts: Array.from(this.coverage.counts), total: CELLS * BANDS },
      tracks: this.tracker.snapshots(), network: { ...this.network.stats, queued: this.network.queue.length },
      timeline: this.timeline, evaluation: this.evaluate(),
      scope: 'Synthetic static-beacon model. Posterior radii are model-based, not calibrated real-world guarantees.' };
  }
}
