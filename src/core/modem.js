import { FRAME_BYTES, decode, crc16 } from './codec.js';
export const SAMPLE_RATE = 48000, BIT_SAMPLES = 40, PREAMBLE_BYTES = 8;
const TABLE = [1200, 2200].map(f => ({ c: Float64Array.from({ length: 240 }, (_, i) => Math.cos(2 * Math.PI * f * i / SAMPLE_RATE)), s: Float64Array.from({ length: 240 }, (_, i) => Math.sin(2 * Math.PI * f * i / SAMPLE_RATE)) }));
export function modulate(frame) {
  const bytes = new Uint8Array(PREAMBLE_BYTES + frame.length); bytes.fill(0xaa, 0, PREAMBLE_BYTES); bytes.set(frame, PREAMBLE_BYTES);
  const pcm = new Float32Array(bytes.length * 8 * BIT_SAMPLES); let phase = 0, index = 0;
  for (const byte of bytes) for (let bit = 7; bit >= 0; bit--) {
    const frequency = byte & 1 << bit ? 2200 : 1200;
    for (let j = 0; j < BIT_SAMPLES; j++, index++) {
      phase += 2 * Math.PI * frequency / SAMPLE_RATE;
      const envelope = Math.min(1, index / 32, (pcm.length - 1 - index) / 32);
      pcm[index] = .35 * Math.sin(phase) * envelope;
    }
  }
  return pcm;
}
function demodulateBytes(pcm, start, count) {
  const bytes = new Uint8Array(count);
  for (let bit = 0; bit < count * 8; bit++) {
    let c0 = 0, s0 = 0, c1 = 0, s1 = 0;
    for (let k = 0; k < BIT_SAMPLES; k++) {
      const n = start + bit * BIT_SAMPLES + k, sample = pcm[n] || 0, phase = n % 240;
      c0 += sample * TABLE[0].c[phase]; s0 += sample * TABLE[0].s[phase];
      c1 += sample * TABLE[1].c[phase]; s1 += sample * TABLE[1].s[phase];
    }
    const value = c1 * c1 + s1 * s1 > c0 * c0 + s0 * s0 ? 1 : 0;
    bytes[bit >> 3] |= value << (7 - (bit & 7));
  }
  return bytes;
}
export function decodeRecording(pcm, progress = () => {}) {
  if (!(pcm instanceof Float32Array) || pcm.length > SAMPLE_RATE * 600) throw new Error('Expected at most 10 minutes of 48 kHz audio');
  const words = new Uint32Array(BIT_SAMPLES), counts = new Uint16Array(BIT_SAMPLES);
  let c0 = 0, s0 = 0, c1 = 0, s1 = 0, origin = 0, rejectedCandidates = 0;
  const packets = [];
  for (let n = 0; n < pcm.length; n++) {
    const phase = n % 240, value = pcm[n];
    c0 += value * TABLE[0].c[phase]; s0 += value * TABLE[0].s[phase];
    c1 += value * TABLE[1].c[phase]; s1 += value * TABLE[1].s[phase];
    if (n - origin >= BIT_SAMPLES) {
      const old = pcm[n - BIT_SAMPLES], oldPhase = (n - BIT_SAMPLES) % 240;
      c0 -= old * TABLE[0].c[oldPhase]; s0 -= old * TABLE[0].s[oldPhase];
      c1 -= old * TABLE[1].c[oldPhase]; s1 -= old * TABLE[1].s[oldPhase];
    }
    if (n - origin < BIT_SAMPLES - 1) continue;
    const start = n - BIT_SAMPLES + 1, lane = start % BIT_SAMPLES;
    const e0 = c0 * c0 + s0 * s0, e1 = c1 * c1 + s1 * s1;
    words[lane] = ((words[lane] << 1) | (e1 > e0 ? 1 : 0)) >>> 0;
    counts[lane] = Math.min(65535, counts[lane] + 1);
    if (counts[lane] >= 80 && words[lane] === 0xaaaad5aa && Math.max(e0, e1) > .002) {
      const beginning = start - 79 * BIT_SAMPLES;
      if (beginning < origin) continue;
      const prefix = demodulateBytes(pcm, beginning, 11), legacy = [0x11, 0x12].includes(prefix[10]);
      const size = legacy ? 18 : FRAME_BYTES, length = (PREAMBLE_BYTES + size) * 8 * BIT_SAMPLES;
      if (beginning + length > pcm.length) continue;
      const bytes = demodulateBytes(pcm, beginning, PREAMBLE_BYTES + size), frame = bytes.slice(PREAMBLE_BYTES);
      try {
        if (!bytes.subarray(0, PREAMBLE_BYTES).every(b => b === 0xaa)) throw new Error('Preamble');
        let packet;
        if (legacy) {
          const v = new DataView(frame.buffer);
          if (crc16(frame.subarray(0, 16)) !== v.getUint16(16)) throw new Error('CRC');
          packet = { legacy: true, type: frame[2], origin: frame[3], epoch: v.getUint16(4), sequence: v.getUint16(6), band: frame[8], offset: v.getUint16(9), mask: v.getUint32(11) };
        } else packet = decode(frame);
        packets.push({ time: beginning / SAMPLE_RATE, packet, bytes: frame });
        n = beginning + length - 1; origin = n + 1;
        c0 = s0 = c1 = s1 = 0; words.fill(0); counts.fill(0);
      } catch { rejectedCandidates++; }
    }
    if (n % 1048576 === 0) progress(n / pcm.length);
  }
  progress(1); return { packets, rejectedCandidates, duration: pcm.length / SAMPLE_RATE };
}
export function wav(frames) {
  const gap = 960, lengths = frames.map(f => (f.length + PREAMBLE_BYTES) * 8 * BIT_SAMPLES + gap);
  const samples = lengths.reduce((a,b) => a+b, 0), buffer = new ArrayBuffer(44 + samples * 2), v = new DataView(buffer);
  const text = (at, s) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF'); v.setUint32(4, 36 + samples * 2, true); text(8, 'WAVE'); text(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, SAMPLE_RATE, true); v.setUint32(28, SAMPLE_RATE * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); text(36, 'data'); v.setUint32(40, samples * 2, true);
  let offset = 44;
  frames.forEach(frame => { const pcm = modulate(frame); for (const value of pcm) { v.setInt16(offset, Math.round(value * 32767), true); offset += 2; } offset += gap * 2; });
  return buffer;
}
export function readWav(buffer) {
  const v = new DataView(buffer), name = at => String.fromCharCode(...new Uint8Array(buffer, at, 4));
  if (buffer.byteLength < 44 || name(0) !== 'RIFF' || name(8) !== 'WAVE') throw new Error('Not a RIFF WAVE file');
  let format, data;
  for (let at = 12; at + 8 <= v.byteLength;) {
    const id = name(at), size = v.getUint32(at + 4, true), begin = at + 8;
    if (begin + size > v.byteLength) throw new Error('Truncated WAV chunk');
    if (id === 'fmt ' && size >= 16) format = { encoding: v.getUint16(begin, true), channels: v.getUint16(begin + 2, true), rate: v.getUint32(begin + 4, true), bits: v.getUint16(begin + 14, true) };
    if (id === 'data') data = { begin, size };
    at = begin + size + (size % 2);
  }
  if (!format || !data || format.encoding !== 1 || ![1,2].includes(format.channels) || format.rate !== SAMPLE_RATE || format.bits !== 16) throw new Error('Use 48 kHz, 16-bit PCM WAV, mono or stereo');
  const count = Math.floor(data.size / (format.channels * 2));
  if (count > SAMPLE_RATE * 600) throw new Error('Recording exceeds 10 minutes');
  const pcm = new Float32Array(count);
  for (let n = 0; n < count; n++) { let value = 0; for (let c = 0; c < format.channels; c++) value += v.getInt16(data.begin + (n * format.channels + c) * 2, true) / 32768; pcm[n] = value / format.channels; }
  return pcm;
}
