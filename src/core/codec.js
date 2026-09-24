import { COLS, ROWS, BANDS } from './grid.js';
export const FRAME_BYTES = 32, VERSION = 0x21;
export const OBSERVATION = 1, SCAN = 2;
export function crc16(bytes) {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let j = 0; j < 8; j++) crc = ((crc << 1) ^ ((crc & 0x8000) ? 0x1021 : 0)) & 0xffff;
  }
  return crc;
}
function valid(p) {
  for (const key of ['type','sender','origin','band','hops','epoch','sequence','beacon','x','y','range','bearing','sigmaRange','sigmaBearing','quality','tick']) {
    if (!Number.isFinite(p[key])) throw new Error('Invalid field: ' + key);
  }
  const ints = ['type','sender','origin','band','hops','epoch','sequence','beacon','quality','tick'];
  if (ints.some(key => !Number.isInteger(p[key]))) throw new Error('Integer field required');
  if (![OBSERVATION, SCAN].includes(p.type) || p.sender < 1 || p.sender > 4 || p.origin < 1 || p.origin > 4 || p.band < 0 || p.band >= BANDS || p.hops < 0 || p.hops > 16) throw new Error('Invalid header');
  if (p.epoch < 0 || p.epoch > 65535 || p.sequence < 0 || p.sequence > 65535 || p.tick < 0 || p.tick > 65535 || p.beacon < 0 || p.beacon > 65535 || p.quality < 0 || p.quality > 255) throw new Error('Out-of-range integer');
  if (p.type === OBSERVATION && p.beacon === 0) throw new Error('Observation requires a beacon identifier');
  if (p.x < 0 || p.x > COLS || p.y < 0 || p.y > ROWS || p.range < 0 || p.range > 60 || Math.abs(p.bearing) > Math.PI + .0001 || p.sigmaRange < .001 || p.sigmaRange > 20 || p.sigmaBearing < .001 || p.sigmaBearing > 3.14) throw new Error('Invalid measurement');
}
export function encode(p) {
  valid(p);
  const bytes = new Uint8Array(FRAME_BYTES), v = new DataView(bytes.buffer);
  v.setUint16(0, 0xd5aa); v.setUint8(2, VERSION); v.setUint8(3, p.type);
  v.setUint8(4, p.sender); v.setUint8(5, p.origin); v.setUint8(6, p.band); v.setUint8(7, p.hops);
  v.setUint16(8, p.epoch); v.setUint16(10, p.sequence); v.setUint16(12, p.beacon);
  v.setUint16(14, Math.round(p.x * 100)); v.setUint16(16, Math.round(p.y * 100));
  v.setUint16(18, Math.round(p.range * 100)); v.setInt16(20, Math.round(p.bearing * 10000));
  v.setUint16(22, Math.round(p.sigmaRange * 1000)); v.setUint16(24, Math.round(p.sigmaBearing * 10000));
  v.setUint8(26, p.quality); v.setUint8(27, 0); v.setUint16(28, p.tick);
  v.setUint16(30, crc16(bytes.subarray(0, 30)));
  return bytes;
}
export function decode(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== FRAME_BYTES) throw new Error('Expected a 32-byte VG-1 frame');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint16(0) !== 0xd5aa || v.getUint8(2) !== VERSION || v.getUint8(27) !== 0) throw new Error('Unknown frame format');
  if (v.getUint16(30) !== crc16(bytes.subarray(0, 30))) throw new Error('CRC mismatch');
  const p = {
    type: v.getUint8(3), sender: v.getUint8(4), origin: v.getUint8(5), band: v.getUint8(6), hops: v.getUint8(7),
    epoch: v.getUint16(8), sequence: v.getUint16(10), beacon: v.getUint16(12),
    x: v.getUint16(14) / 100, y: v.getUint16(16) / 100, range: v.getUint16(18) / 100, bearing: v.getInt16(20) / 10000,
    sigmaRange: v.getUint16(22) / 1000, sigmaBearing: v.getUint16(24) / 10000, quality: v.getUint8(26), tick: v.getUint16(28)
  };
  valid(p); return p;
}
export const hex = bytes => Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('');
