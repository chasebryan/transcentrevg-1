import test from 'node:test';
import assert from 'node:assert/strict';
import { encode, decode, crc16, OBSERVATION } from '../src/core/codec.js';
import { RelayNetwork } from '../src/core/relay.js';
import { modulate, decodeRecording, wav, readWav } from '../src/core/modem.js';
import { random, normal } from '../src/core/grid.js';
import { Simulation } from '../src/core/simulation.js';
import { readFile } from 'node:fs/promises';

const packet={type:OBSERVATION,sender:2,origin:2,band:1,hops:8,epoch:4,sequence:1,beacon:110,x:14.5,y:8.5,range:7.2,bearing:-1.45,sigmaRange:1.2,sigmaBearing:.12,quality:190,tick:12};
test('VG-1 encodes measurement values and validates a standard CRC check vector',()=>{
 assert.equal(crc16(new TextEncoder().encode('123456789')),0x29b1);
 assert.deepEqual(decode(encode(packet)),packet);
 const bytes=encode(packet);bytes[18]^=16;assert.throws(()=>decode(bytes),/CRC/);
 assert.throws(()=>encode({...packet,band:4}));
});
test('receiver rejects duplicates and stale epochs',()=>{
 let deliveries=0;const net=new RelayNetwork({epoch:4},()=>deliveries++);
 const bytes=encode(packet);assert.equal(net.receive(bytes),true);assert.equal(net.receive(bytes),false);
 assert.equal(net.receive(encode({...packet,epoch:3,sequence:2})),false);
 assert.equal(deliveries,1);assert.equal(net.stats.duplicates,1);assert.equal(net.stats.stale,1);
});
test('hop limits bound forwarding and a disconnected gateway cannot fabricate delivery',()=>{
 for(const config of [{hops:1},{hops:8,offline:true}]){
  const net=new RelayNetwork({epoch:4,loss:0,corruption:0,hops:config.hops});
  if(config.offline)net.online[1]=false;
  net.enqueue(packet,0);for(let t=1;t<50;t++)net.step(t);
  assert.equal(net.stats.received,0);assert.equal(net.queue.length,0);
 }
});
test('an unavailable relay can be bypassed along the other side of the ring',()=>{
 const net=new RelayNetwork({epoch:4,loss:0,corruption:0});net.online[3]=false;
 assert.deepEqual(net.path(2),[2,1,0]);net.enqueue(packet,0);
 for(let t=1;t<10;t++)net.step(t);assert.equal(net.stats.received,1);
});
test('manifest-free FSK decoding recovers frames at an unknown sample offset with noise',()=>{
 const frames=[encode(packet),encode({...packet,sequence:2}),encode({...packet,sequence:3})];
 const source=readWav(wav(frames)), pcm=new Float32Array(source.length+137), rng=random(100);
 pcm.set(source,137);for(let i=0;i<pcm.length;i++)pcm[i]+=.009*normal(rng);
 const decoded=decodeRecording(pcm);
 assert.deepEqual(decoded.packets.map(x=>x.packet.sequence),[1,2,3]);
});
test('a corrupted audio frame is rejected while the following valid frame is recovered',()=>{
 const bad=encode(packet);bad[12]^=32;
 const result=decodeRecording(readWav(wav([bad,encode({...packet,sequence:2})])));
 assert.deepEqual(result.packets.map(x=>x.packet.sequence),[2]);
});
test('a lossy relay capture survives the complete packet-to-WAV-to-decoder path', () => {
 const sim = new Simulation({limit:90, loss:.15, corruption:.1}).run();
 const frames = sim.network.capture.map(c=>c.bytes);
 const expected = frames.flatMap(frame=>{try{return [decode(frame)];}catch{return [];}});
 assert.ok(expected.length > 0 && expected.length < frames.length);
 const result = decodeRecording(readWav(wav(frames)));
 assert.deepEqual(result.packets.map(r=>r.packet), expected);
});
test('the original 48-second recording decodes all 200 frames without its manifest', async () => {
 const file = await readFile(new URL('../media/transhopper-audio.wav', import.meta.url));
 const result = decodeRecording(readWav(file.buffer.slice(file.byteOffset, file.byteOffset+file.byteLength)));
 assert.equal(result.packets.length, 200); assert.ok(result.packets.every(r=>r.packet.legacy));
});
