# VG-1 release verification

## Automated checks

`npm test` passes 18 tests on Node.js 24. The package supports Node.js 20 or newer; other versions were not separately exercised for this release.

The suite covers:

- A continuous circumnavigation route containing every grid cell exactly once.
- Noisy multiview localisation, cell-resolution uncertainty, repeated-view discounting, and gross-outlier rejection.
- Five-observation confirmation, actual collector confirmation time, candidate retention, independent-witness revisits, and reserved exploration.
- CRC and measurement round trips, duplicate and stale-epoch rejection, hop budgets, disconnected-gateway behaviour, and fallback routing.
- Unknown audio sample alignment with additive noise, corrupted-frame rejection, and recovery of the following valid frame.
- The complete lossy relay → captured bytes → WAV → decoder path: 388 valid frames recovered from 428 captured frames, with decoded fields matching every valid source frame.
- All 200 original Transhopper frames decoded from the 48-second recording without a manifest.
- Seed reproducibility, gateway outage/reconnection, and zero-delivery missions producing no coverage or beacon discoveries.

## Benchmarks

`npm run benchmark` runs 48 missions: 12 development and 12 held-out seeds, each with both the coverage and adaptive planners. See [benchmark.json](benchmark.json) for every result and [the technical notes](transcentrevg-1.md#reproducible-evaluation) for methodology and limits.

| Cohort | Planner | Confirmed | False ever confirmed | Median error, cells | Median first confirmation, steps |
| --- | --- | ---: | ---: | ---: | ---: |
| Development | Coverage | 96 / 96 | 0 | 0.397 | 83 |
| Development | Adaptive | 96 / 96 | 0 | 0.383 | 70 |
| Held out | Coverage | 96 / 96 | 0 | 0.418 | 81.5 |
| Held out | Adaptive | 96 / 96 | 0 | 0.397 | 74.5 |

Times include relay delivery. Zero false confirmations in these samples is not a universal false-positive bound. The adaptive mode has slightly less final coverage; the README reports that tradeoff.

## Browser verification

A headless Chromium session exercised the served application at widths of 1,440, 390, and 320 pixels. Checks covered run/pause, new missions, relay outage/recovery, depth and candidate selection, JSON export, WAV export, worker decoding, malformed WAV input, invalid seeds, and responsive rendering. No JavaScript errors remained. A transient zero-width canvas during responsive layout was fixed, and narrow candidate cards were changed to a single column.

The browser decoder recovered 478 valid hop frames from the default mission's 120-step capture and all 200 frames of the legacy recording. Audio encoding and decoding were verified numerically; physical speaker/microphone operation, real rotor noise, and other browser engines were not tested. The desktop image in the README is an actual application screenshot.
