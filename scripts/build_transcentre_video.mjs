import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Simulation } from '../src/core/simulation.js';
import { modulate, decodeRecording, readWav, SAMPLE_RATE } from '../src/core/modem.js';
import { decode, hex } from '../src/core/codec.js';

if (process.argv[2] === '--verify') {
  const raw = await readFile(process.argv[3]);
  const manifest = JSON.parse(await readFile(process.argv[4], 'utf8'));
  const result = decodeRecording(readWav(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)));
  assert.deepEqual(result.packets.map(p => hex(p.bytes)), manifest.audio.map(p => p.hex));
  assert.ok(result.packets.every((p, i) => Math.abs(p.time - manifest.audio[i].time) < .05));
  console.log(JSON.stringify({ validPackets: result.packets.length, duration: result.duration, crcAndTiming: 'PASS' }));
  process.exit(0);
}
const work = path.resolve(process.argv[2]);
await mkdir(work, { recursive: true });
const duration = 60, intro = 3, stepsPerSecond = 6, fps = 24;
const sim = new Simulation({ seed: 73, limit: 300 });
const frames = [], audio = [], pcm = new Float32Array(duration * SAMPLE_RATE);
let nextAudio = intro;
function snapshot() {
  const tick = sim.tick, band = tick <= 60 ? 1 : tick <= 120 ? 0 : tick <= 180 ? 1 : tick <= 240 ? 2 : 3;
  const focusId = band === 1 ? tick <= 60 ? 110 : 111 : band === 0 ? 100 : band === 2 ? 120 : 130;
  const selected = sim.tracker.tracks.get(`${band}:${focusId}`);
  const peak = selected ? Math.max(...selected.posterior) : 1;
  const tracks = sim.tracker.active(tick).map(t => t.snapshot());
  frames.push({ tick, band, focusId, tracks, selected: selected?.snapshot() ?? null,
    probability: selected ? Array.from(selected.posterior, p => Math.round(255 * Math.pow(p / peak, .55))) : [],
    coverage: Array.from(sim.coverage.probability[band], p => Math.round(p * 255)),
    counts: Array.from(sim.coverage.counts), fraction: sim.coverage.fraction,
    confirmed: tracks.filter(t => t.status === 'confirmed').length,
    network: { ...sim.network.stats }, latest: sim.latest,
    sensors: sim.sensors.map(s => ({ id: s.id, x: s.x, y: s.y, band: s.band, waypoint: s.waypoint, trail: s.trail.slice(-32) })) });
}
snapshot();
while (sim.step()) {
  const t = intro + sim.tick / stepsPerSecond;
  const received = sim.deliveredAudio.splice(0);
  if (received.length && t >= nextAudio) {
    const bytes = received.at(-1), samples = modulate(bytes), at = Math.round(t * SAMPLE_RATE);
    for (let n = 0; n < samples.length; n++) pcm[at + n] = samples[n] * .64;
    audio.push({ time: t, tick: sim.tick, hex: hex(bytes), packet: decode(bytes) });
    nextAudio = t + samples.length / SAMPLE_RATE + .10;
  }
  snapshot();
}
const buffer = Buffer.alloc(44 + pcm.length * 2);
buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
buffer.writeUInt32LE(SAMPLE_RATE, 24); buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(pcm.length * 2, 40);
for (let i = 0; i < pcm.length; i++) buffer.writeInt16LE(Math.round(pcm[i] * 32767), 44 + 2 * i);
const manifest = { format: 'TranscentreVG-1/video-v1', duration, fps, width: 1920, height: 1080, intro, stepsPerSecond,
  source: 'Unmodified VG-1 Simulation, seed 73; display selection has no effect on planning.',
  audioScope: 'Selected received observation frames at their displayed delivery times; gaps prevent overlap. No added music.',
  motion: 'Receiver positions are interpolated for display between exact simulation steps.',
  audio, report: sim.report() };
await writeFile(path.join(work, 'frames.json'), JSON.stringify({ ...manifest, frames }));
await writeFile(path.join(work, 'audio.wav'), buffer);
await writeFile(path.join(work, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ snapshots: frames.length, packets: audio.length, confirmed: manifest.report.evaluation.confirmed, duration }));
