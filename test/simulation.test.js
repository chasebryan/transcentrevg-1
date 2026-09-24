import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/core/simulation.js';
test('a seeded mission is deterministic',()=>{
 const a=new Simulation({limit:60}).run().report(),b=new Simulation({limit:60}).run().report();
 assert.deepEqual(a,b);
});
test('coverage and evidence only arrive through the receiver, and recover after reconnection',()=>{
 const sim=new Simulation({limit:180});sim.setOnline(1,false);sim.run(60);
 assert.equal(sim.coverage.fraction,0);assert.equal(sim.tracker.tracks.size,0);
 sim.setOnline(1,true);sim.run(120);
 assert.ok(sim.coverage.fraction>0);assert.ok(sim.tracker.tracks.size>0);
});
test('zero delivery probability produces no discoveries or coverage claims',()=>{
 const sim=new Simulation({loss:1,limit:90}).run();
 assert.equal(sim.tracker.tracks.size,0);assert.equal(sim.coverage.fraction,0);
 assert.ok(sim.network.stats.losses>0);assert.ok(sim.network.queue.length<=128);
});
