# TranscentreVG-1 technical notes

VG-1 adds an evidence-driven beacon acquisition engine to Transhopper. The flat grid remains 42 columns by 32 rows. Each of four depth labels has a separate coverage map and independent beacon tracks. All distances below are symbolic grid cells, and time is measured in simulation steps.

## Data flow and boundaries

1. The scenario generator creates two static beacons per band. Four receivers move at most one cell per step and rotate through bands every 24 steps.
2. The measurement generator produces noisy range/bearing observations and occasional shared-identifier clutter. Detection probability is `0.94 * exp(-0.5 * (range / 9)^2)` within 12 cells, and zero beyond that range.
3. A measurement is quantised into a VG-1 frame. The relay network applies loss, corruption, hop limits, retries, and routing before the collector receives it.
4. Only a valid, previously unseen, current-epoch observation can update the tracker. Only a received scan report can update coverage.
5. The planner sees track posteriors, coverage, receiver state, and other waypoints. It has no scenario truth input. Truth is used separately for synthetic evaluation and the optional visual overlay.

The simulation passes encoded bytes between logical relays. FSK synthesis and decoding provide an independently tested audio representation of those bytes; a physical acoustic or RF channel is not simulated between each hop.

## Localisation and confirmation

`src/core/tracker.js` maintains a discrete posterior over all 1,344 cell centres for each `(band, beacon identifier)`. Updates use a mixture of 92% Gaussian range/bearing likelihood and 8% uniform clutter likelihood. Likelihoods are combined in log space, then normalised.

Reports from the same receiver and the same 3 × 3 position bucket receive weights `1 / (repeat_count + 1)^2`. This keeps repeated views from creating unlimited apparent independent evidence. Sensor error is assumed independent between distinct viewpoints in the model; correlated real sensor biases have not been calibrated.

After at least three accepted reports, an estimate with radius below eight cells rejects an observation whose normalised innovation exceeds 16. Four consecutive rejects put the track in `conflict`. Rejected reports do not move its posterior. A later consistent report can restore the estimate's status.

The reported position is the posterior mean. Covariance includes a `1/12` cell-quantisation variance on each axis. The radius encloses 95% of the discrete posterior mass about that mean, plus half a cell's diagonal. It describes this model's posterior, not a frequentist guarantee. If the posterior has multiple modes, the mean can fall between them; the probability heatmap exposes this ambiguity.

Accepted reports are checked again against the current estimate. A supporting report has joint squared range/bearing residual at most 9.21 after including cell-resolution variance. Confirmation requires all of the following:

- At least five supporting reports and a combined supporting weight of at least three.
- At least two distinct supporting receivers.
- A pair of supporting views from different receivers, separated by at least three cells and by at least 25° around the estimate. Opposite, collinear views do not qualify.
- Model radius at most 2.5 cells and no current conflict.

Tracks can lose confirmation as evidence changes. `firstConfirmedTick` records when the collector first obtained sufficient evidence, including delivery delay. Measurement timestamps remain separate. The benchmark counts false tracks ever confirmed as well as those confirmed at the final step.

The grid discretisation, fixed static-beacon assumption, and innovation gate can limit recovery from an initially incorrect compact estimate. Moving beacons require a motion model, process noise, and explicit reassociation or track reinitialisation; these are not claimed by this version.

## Search planning

`src/core/planner.js` proposes observer positions on rings four, seven, and ten cells from each unresolved estimate. It uses a local Gaussian/Fisher-information approximation to rank expected uncertainty reduction. The approximation is a heuristic, particularly for broad or multimodal posteriors.

Scores also account for missing supporting observations, missing independent receivers, deficient angular geometry, expected detection at the proposed range, and age. A coherence factor discounts diffuse or contradictory evidence, so a large covariance alone cannot monopolise the search. Travel and competing same-band reservations reduce the score. A small preference for the current candidate discourages repeatedly abandoning useful approaches.

One in every three eight-step planning windows reserves exploration. Exploration scores candidate cells from a nested rectangular route by uncovered detection opportunity. Replanning normally occurs every six steps, on band changes, or at a reached waypoint. The route itself visits every cell once; the adaptive receiver paths select points from it and are not guaranteed to traverse every cell during a finite mission.

A candidate with at least two supporting reports remains eligible for 192 steps since its latest accepted measurement, spanning two complete receiver/band rotations. Weaker candidates expire after 80 steps. Confirmed tracks remain visible. Track storage is bounded at 64 records per mission; expired display candidates retain their records and cannot create unbounded storage.

## Coverage and completion

Coverage combines received scan opportunities as `1 - product(1 - detection_probability)`. A cell counts as covered at probability at least 0.9. The total denominator is 5,376 cell-band combinations. This assumes independent opportunities and contains no correction for correlated misses, obstructions, or radio range.

Coverage is distinct from beacon evidence. A scan acknowledgement cannot confirm a beacon. The UI stops after 300 steps even when candidates remain unresolved. API missions are limited to 480 steps. Completion indicates the configured run ended, not that all physical signals have been discovered.

## Relay behaviour

Receivers form the logical ring R1–R2–R3–R4–R1. R1 connects to collector 0. Reports prefer clockwise routing; a breadth-first fallback finds an available route on the other side of the ring. R1 remains a single gateway, so its loss disconnects the collector.

Each hop updates the sender, decrements the hop budget, and recomputes the CRC. The collector rejects stale epochs and duplicate `(epoch, origin, sequence)` tuples. A failed frame can be retried twice after the original attempt with bounded backoff. A missing link waits at most eight steps before retrying. These retries use simulation knowledge of failure; this version has no over-the-air ACK protocol.

The queue holds at most 128 reports and the duplicate cache at most 8,192 tuples. Sequence exhaustion requires a new epoch. Capture retains at most 1,024 hop frames; event history retains 160 entries. Captured frames include intermediate-hop traffic and duplicates, and packets still queued at the mission horizon are not counted as delivered.

## VG-1 frame format

All multibyte values use big-endian order. The frame is 32 bytes, preceded in audio by eight `0xAA` preamble bytes. CRC is CRC-16/CCITT-FALSE: polynomial `0x1021`, initial `0xFFFF`, no reflection, no final XOR. The standard `123456789` check value is `0x29B1`.

| Byte offset | Bytes | Field | Representation |
| --- | ---: | --- | --- |
| 0 | 2 | Sync | `0xD5AA` |
| 2 | 1 | Version | `0x21` |
| 3 | 1 | Type | 1 = observation, 2 = scan |
| 4 | 1 | Sending relay | 1–4 |
| 5 | 1 | Origin receiver | 1–4 |
| 6 | 1 | Depth band | 0–3 |
| 7 | 1 | Remaining hops | 0–16 |
| 8 | 2 | Mission epoch | Unsigned integer |
| 10 | 2 | Origin sequence | Unsigned integer |
| 12 | 2 | Beacon identifier | Nonzero for observations |
| 14 | 2 | Receiver x | Cells × 100 |
| 16 | 2 | Receiver y | Cells × 100 |
| 18 | 2 | Measured range | Cells × 100 |
| 20 | 2 | Measured bearing | Signed radians × 10,000 |
| 22 | 2 | Range standard deviation | Cells × 1,000 |
| 24 | 2 | Bearing standard deviation | Radians × 10,000 |
| 26 | 1 | Quality metadata | 0–255; not used as a truth hint by the tracker |
| 27 | 1 | Reserved | Must be zero |
| 28 | 2 | Observation step | Unsigned integer |
| 30 | 2 | CRC | Computed over bytes 0–29 |

Positions are receiver positions. The frame carries measured range and bearing, never a true beacon coordinate. CRC is an accidental-error check, not authentication or spoofing protection.

## Audio

`src/core/modem.js` emits phase-continuous binary FSK at 1,200 bit/s: 1,200 Hz for zero and 2,200 Hz for one. Samples are 48 kHz, giving 40 samples per bit; bytes are transmitted most-significant bit first. Export inserts a 20 ms gap between frames. A VG-1 frame plus preamble takes approximately 267 ms before that gap.

The decoder scans 40 timing alignments with a sliding two-frequency correlator, seeks preamble/sync, and validates frame length, version, and CRC. It also recognises original 18-byte Transhopper frames. It does not need a manifest or known packet offsets. Incorrect candidate alignments may each fail validation, so rejected timing hypotheses are not an exact count of corrupted transmitted packets.

WAV input must be 48 kHz, 16-bit PCM, mono or stereo. Stereo channels are averaged. The decoder is bounded to ten minutes; the browser additionally limits file size to 64 MiB. Sample-clock drift, frequency offset, severe multipath, rotor noise, and arbitrary compressed recordings are outside the verified audio model.

At accelerated mission playback, the audible monitor skips observation frames when the previous audio frame is still playing. This does not drop estimator inputs or captured records. Export serialises captured frames into diagnostic audio rather than preserving simulation event timing or simultaneous channels.

## Reproducible evaluation

`npm run benchmark` writes [benchmark.json](benchmark.json). The 12 development seeds informed the implementation. The 12 holdout seeds were fixed before their first execution and did not inform planner tuning. Each planner uses the same tracker, measurement-error model, seed set, and 300-step budget. Measurement draws are keyed to seed, step, receiver, and beacon. Paths differ, so actual observations and relay traffic differ between modes.

Both cohorts contain 96 true beacons per planner. The benchmark reports detection and confirmation counts, false current and historical confirmations, final position error, confirmation time including relay delay, coverage, and empirical containment by the model radius. Error and timing summaries are conditional on final confirmation; confirmation counts must be considered alongside them. A false beacon is a confirmed identifier absent from scenario truth; coordinate error is reported separately.

In the held-out set, 95 of 96 adaptive confirmed positions contained the true point within their model radius, compared with 94 of 96 for the coverage baseline. This small model-generated sample is not a field calibration study. The original Transhopper had no comparable localisation estimator; the reported comparison is between two VG-1 planning modes, not a claimed accuracy measurement of the legacy animation.
