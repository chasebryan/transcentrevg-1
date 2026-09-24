import { Simulation } from '../src/core/simulation.js';
import { writeFile } from 'node:fs/promises';

// Development seeds informed implementation. Holdout seeds were fixed before their first run.
const cohorts = {
  development: [11, 29, 47, 73, 101, 137, 173, 211, 251, 307, 359, 419],
  holdout: [503, 557, 601, 653, 701, 757, 809, 853, 907, 953, 1009, 1061],
};
const config = { limit: 300, loss: .04, corruption: .01, outliers: .08 };
const rows = [];
for (const [cohort, seeds] of Object.entries(cohorts)) {
  for (const seed of seeds) for (const mode of ['coverage', 'adaptive']) {
    const sim = new Simulation({ ...config, seed, mode }).run();
    rows.push({ cohort, seed, mode, ...sim.evaluate(), coverage: sim.coverage.fraction });
  }
}
function median(values) {
  values.sort((a, b) => a - b);
  return values.length ? (values[Math.floor((values.length - 1) / 2)] + values[Math.floor(values.length / 2)]) / 2 : null;
}
function summary(cohort, mode) {
  const group = rows.filter(r => r.cohort === cohort && r.mode === mode);
  const confirmed = group.reduce((s, r) => s + r.confirmed, 0), total = group.reduce((s, r) => s + r.total, 0);
  const matches = group.flatMap(r => r.matches.filter(t => t.confirmed));
  const errors = matches.map(t => t.error).sort((a, b) => a - b);
  return {
    missions: group.length, totalBeacons: total, detected: group.reduce((s, r) => s + r.detected, 0), confirmed,
    falseConfirmed: group.reduce((s, r) => s + r.falseConfirmed, 0),
    falseEverConfirmed: group.reduce((s, r) => s + r.falseEverConfirmed, 0), confirmationRate: confirmed / total,
    medianError: median([...errors]), p90Error: errors[Math.ceil(errors.length * .9) - 1] ?? null,
    medianFirstConfirmation: median(matches.map(t => t.firstConfirmedTick)),
    meanCoverage: group.reduce((s, r) => s + r.coverage, 0) / group.length,
    contained95: matches.filter(t => t.containsTruth95).length,
  };
}
const report = {
  version: 'TranscentreVG-1', config,
  scenario: '8 static beacons; four symbolic depth bands; keyed measurement noise; shared-ID clutter; both planners use the same tracker',
  cohorts, summaries: Object.fromEntries(Object.keys(cohorts).map(name => [name,
    Object.fromEntries(['coverage', 'adaptive'].map(mode => [mode, summary(name, mode)]))])), rows,
};
await writeFile(new URL('../docs/benchmark.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.summaries, null, 2));
