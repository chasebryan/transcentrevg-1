import test from 'node:test';
import assert from 'node:assert/strict';
import { BeaconTrack, Tracker } from '../src/core/tracker.js';
import { plan, informationGain } from '../src/core/planner.js';
import { Coverage, ROUTE, CELLS, random, normal } from '../src/core/grid.js';

function measurement(x, y, origin, tick, target = { x: 25.4, y: 11.3 }, rng = () => .5) {
  return { beacon: 101, band: 0, origin, tick, x, y,
    range: Math.hypot(target.x-x,target.y-y) + normal(rng) * .6,
    bearing: Math.atan2(target.y-y,target.x-x) + normal(rng) * .055,
    sigmaRange: .8, sigmaBearing: .08 };
}
test('the circumnavigation route covers every cell exactly once without jumps', () => {
  assert.equal(ROUTE.length, CELLS); assert.equal(new Set(ROUTE).size, CELLS);
  for (let i=1;i<ROUTE.length;i++) assert.equal(Math.abs(ROUTE[i]%42-ROUTE[i-1]%42)+Math.abs(Math.floor(ROUTE[i]/42)-Math.floor(ROUTE[i-1]/42)),1);
});
test('independent noisy observations localise a beacon and preserve cell-scale uncertainty', () => {
  const track=new BeaconTrack(101,0), rng=random(142);
  const views=[[18,5,1],[32,6,2],[34,18,3],[18,20,4]];
  for(let i=0;i<16;i++){const [x,y,id]=views[i%4];track.update(measurement(x+i*.05,y,id,i,undefined,rng));}
  assert.equal(track.status,'confirmed');
  assert.ok(Math.hypot(track.estimate.x-25.4,track.estimate.y-11.3)<1);
  assert.ok(track.estimate.radius95>=Math.SQRT1_2);
  assert.ok(track.estimate.radius95<2.5);
  assert.ok(Math.abs(track.posterior.reduce((a,b)=>a+b,0)-1)<1e-10);
});
test('one repeated viewpoint cannot produce a confirmed track', () => {
  const track=new BeaconTrack(101,0);
  for(let i=0;i<30;i++)track.update(measurement(18,5,1,i));
  assert.notEqual(track.status,'confirmed'); assert.ok(track.weight<1.65);
});
test('a gross outlier is rejected without moving a well-supported estimate', () => {
  const track=new BeaconTrack(101,0), rng=random(43);
  for(let i=0;i<10;i++)track.update(measurement(i%2?32:18,i%2?18:5,i%2+1,i,undefined,rng));
  const before={...track.estimate};
  const result=track.update({...measurement(4,4,3,11),range:2,bearing:-2});
  assert.equal(result.accepted,false);assert.equal(track.estimate.x,before.x);assert.equal(track.estimate.y,before.y);
});
test('the planner stays within the grid and uses posterior uncertainty', () => {
  const tracker=new Tracker();for(let i=0;i<3;i++)tracker.ingest(measurement(18+i,5,1,i));
  const sensor={id:2,x:30,y:12,band:0,cursor:20};
  const track=[...tracker.tracks.values()][0];
  assert.ok(informationGain(track,{x:25,y:18})>0);
  assert.equal(informationGain(track,{x:0,y:0}),0);
  const p=plan(sensor,tracker,new Coverage(),[],12);
  assert.ok(p.x>=.5&&p.x<=41.5&&p.y>=.5&&p.y<=31.5);
});
test('a compact estimate needs five agreeing observations and records delivery time', () => {
  const track = new BeaconTrack(101, 0);
  for (const [i, view] of [[18,5,1], [32,6,2], [34,18,3], [18,20,4]].entries()) {
    const z = measurement(...view, i);
    // Use exact measurements so the test isolates confirmation evidence, not random noise.
    z.range = Math.hypot(25.4-z.x, 11.3-z.y); z.bearing = Math.atan2(11.3-z.y, 25.4-z.x);
    track.update(z);
  }
  assert.ok(track.estimate.radius95 < 2.5);
  assert.equal(track.support, 4); assert.notEqual(track.status, 'confirmed');
  const z = measurement(20, 6, 1, 4);
  z.range = Math.hypot(25.4-z.x, 11.3-z.y); z.bearing = Math.atan2(11.3-z.y, 25.4-z.x);
  track.update(z, 30);
  assert.equal(track.status, 'confirmed'); assert.equal(track.firstConfirmedTick, 30);
});
test('a supported candidate survives a receiver rotation and attracts an independent witness', () => {
  const tracker = new Tracker();
  for (let i=0; i<4; i++) tracker.ingest(measurement(18+i, 5, 1, i));
  const sensor = {id:2, x:28, y:18, band:0, cursor:20};
  assert.equal(tracker.active(90).length, 1);
  const point = plan(sensor, tracker, new Coverage(), [], 90);
  assert.equal(point.target, 101);
  // An exploration slot remains available regardless of a pending candidate.
  assert.equal(plan(sensor, tracker, new Coverage(), [], 96).target, null);
});
