import { encode, decode } from './codec.js';
import { random } from './grid.js';
export class RelayNetwork {
  constructor({ seed = 1, epoch = 1, loss = .04, corruption = .01, hops = 8 } = {}, onDeliver = () => {}) {
    this.epoch = epoch; this.loss = loss; this.corruption = corruption; this.hops = hops;
    this.rng = random(seed ^ 0x7a9b01); this.online = [true, true, true, true, true];
    this.queue = []; this.seen = new Set(); this.sequence = [0, 0, 0, 0, 0];
    this.capture = []; this.events = []; this.onDeliver = onDeliver;
    this.stats = { sent: 0, received: 0, losses: 0, crcRejected: 0, retries: 0, expired: 0, duplicates: 0, stale: 0, overflow: 0, rerouted: 0, captureOmitted: 0 };
  }
  path(origin) {
    const clockwise = [origin];
    while (clockwise.at(-1) !== 1) clockwise.push(clockwise.at(-1) % 4 + 1);
    clockwise.push(0);
    if (clockwise.every(n => this.online[n])) return clockwise;
    const edges = [[1], [0, 2, 4], [3, 1], [4, 2], [1, 3]], queue = [[origin]], seen = new Set([origin]);
    while (queue.length) {
      const path = queue.shift(), last = path.at(-1);
      if (last === 0) return path;
      for (const next of edges[last]) if (this.online[next] && !seen.has(next)) { seen.add(next); queue.push([...path, next]); }
    }
    return null;
  }
  enqueue(measurement, tick) {
    if (this.queue.length >= 128) { this.stats.overflow++; return false; }
    const origin = measurement.origin;
    if (this.sequence[origin] >= 65535) throw new Error('Sequence space exhausted; start a new epoch');
    const packet = { ...measurement, sender: origin, sequence: ++this.sequence[origin], epoch: this.epoch, hops: this.hops };
    encode(packet); // Validate before adding work to the queue.
    const path = this.path(origin);
    this.queue.push({ original: packet, packet, path, leg: 0, due: tick + 1, attempt: 0, waiting: 0 });
    return true;
  }
  retry(item, tick, reason) {
    this.events.push({ tick, type: reason, origin: item.original.origin, sequence: item.original.sequence });
    if (item.attempt >= 2) return;
    this.stats.retries++;
    this.queue.push({ ...item, packet: { ...item.original }, path: this.path(item.original.origin), leg: 0,
      attempt: item.attempt + 1, due: tick + 2 ** (item.attempt + 1), waiting: 0 });
  }
  receive(bytes) {
    let p;
    try { p = decode(bytes); } catch { this.stats.crcRejected++; return false; }
    if (p.epoch !== this.epoch) { this.stats.stale++; return false; }
    const key = `${p.epoch}:${p.origin}:${p.sequence}`;
    if (this.seen.has(key)) { this.stats.duplicates++; return false; }
    // Each mission is bounded to 480 ticks; this cache has a separate hard bound.
    if (this.seen.size >= 8192) { this.stats.overflow++; return false; }
    this.seen.add(key); this.stats.received++; this.onDeliver(p, bytes); return true;
  }
  step(tick) {
    const work = this.queue; this.queue = [];
    for (const item of work) {
      if (item.due > tick) { this.queue.push(item); continue; }
      if (!item.path || item.leg === 0) {
        const path = this.path(item.original.origin);
        if (path && item.path && path.join() !== item.path.join()) this.stats.rerouted++;
        item.path = path;
      }
      if (!item.path || !this.online[item.path[item.leg]] || !this.online[item.path[item.leg + 1]]) {
        if (++item.waiting <= 8) { item.due = tick + 1; this.queue.push(item); }
        else this.retry(item, tick, 'link-down');
        continue;
      }
      if (item.packet.hops <= 0) { this.stats.expired++; this.events.push({ tick, type: 'hop-limit', origin: item.original.origin }); continue; }
      const sender = item.path[item.leg], receiver = item.path[item.leg + 1];
      const wirePacket = { ...item.packet, sender, hops: item.packet.hops - 1 };
      const bytes = encode(wirePacket); this.stats.sent++;
      if (this.rng() < this.loss) { this.stats.losses++; this.retry(item, tick, 'packet-loss'); continue; }
      if (this.rng() < this.corruption) bytes[4 + Math.floor(this.rng() * 26)] ^= 1 << Math.floor(this.rng() * 8);
      this.capture.push({ tick, sender, receiver, bytes: bytes.slice() });
      if (this.capture.length > 1024) { this.capture.shift(); this.stats.captureOmitted++; }
      let received;
      try { received = decode(bytes); } catch { this.stats.crcRejected++; this.retry(item, tick, 'crc-reject'); continue; }
      this.events.push({ tick, type: 'hop', sender, receiver, sequence: received.sequence, band: received.band });
      if (receiver === 0) this.receive(bytes);
      else this.queue.push({ ...item, packet: received, leg: item.leg + 1, due: tick + 1 });
    }
    if (this.events.length > 160) this.events.splice(0, this.events.length - 160);
  }
}
