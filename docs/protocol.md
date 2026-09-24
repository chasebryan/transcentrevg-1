# Transhopper demonstration protocol

This document describes the bytes and sounds present in the supplied demonstration. It is an experimental format, not an aviation communications standard.

## Grid and route

The logical horizontal grid has 42 columns and 32 rows. Internal coordinates are zero-based; the visual labels run from C01 to C42 and R01 to R32. Four symbolic altitude bands, D0–D3, reuse the same horizontal grid.

For each ring `r = 0…15`, visit its top edge from left to right, right edge downward, bottom edge from right to left, and left edge upward, without duplicating corners. Continue to the next inner ring. This produces 1,344 unique, orthogonally adjacent cells. D0 and D2 use this route; D1 and D3 use its reversal.

Packet offsets refer to the route index within the named depth band, rather than a row-major cell ID. `media/manifest.json` contains the forward path and all expected packet bytes.

## Audio framing

- Sample rate: 48,000 Hz, stereo.
- Symbol rate: 1,200 bits per second, 40 samples per bit.
- Binary zero: 1,200 Hz; binary one: 2,200 Hz.
- Bits are transmitted most significant first, with continuous carrier phase inside each packet.
- Preamble: eight bytes of `AA`, followed by the 18-byte frame below.
- Total: 208 bits, approximately 173.33 ms per burst.
- Stereo pan indicates the starting column of the reported route segment. Position is also represented by the packet data; panning is only an audible cue.

All multibyte integers are unsigned and big-endian.

| Frame offset | Length | Field |
| --- | --- | --- |
| 0 | 2 bytes | Synchronization word `D5 AA` |
| 2 | 1 byte | Version/type: `11` initial report, `12` repair report (hex) |
| 3 | 1 byte | Sender ID, 1–4 |
| 4 | 2 bytes | Scan epoch, 1 in this demonstration |
| 6 | 2 bytes | Sequence number, 1–200 |
| 8 | 1 byte | Depth band, 0–3 |
| 9 | 2 bytes | Starting route index, 0–1343 |
| 11 | 4 bytes | Acknowledgment mask |
| 15 | 1 byte | Reserved hop limit, initialized to 8 |
| 16 | 2 bytes | CRC-16/CCITT-FALSE over frame bytes 0–15 |

CRC parameters: polynomial `1021`, initial value `FFFF`, no input or output reflection, final XOR `0000` (hex).

For an initial report, bit 31 acknowledges the starting route index, bit 30 the following index, and so on through bit 0. A zero leaves that cell unconfirmed. A repair report acknowledges only its starting index with mask `80000000`. The receiver's ledger is monotonic: a later missing acknowledgment does not erase an earlier valid confirmation.

The byte stream is not encrypted or authenticated. A CRC detects accidental corruption; it does not establish sender identity. The current demo does not relay a frame across multiple machines or decrement its hop limit. A future implementation must define those behaviors separately. [RFC 9171 §4.4.3](https://www.rfc-editor.org/rfc/rfc9171.html#section-4.4.3) is a reference for the general use of hop counts to bound forwarding loops; this custom format is not an implementation of that RFC.

## Timeline

| Time | Action |
| --- | --- |
| 0–1 seconds | Startup chirp |
| 1–10 seconds | D0 inward scan; 42 reports |
| 10–19 seconds | D1 outward scan; 42 reports |
| 19–28 seconds | D2 inward scan; 42 reports |
| 28–37 seconds | D3 outward scan; 42 reports |
| 37–45 seconds | 32 repair reports |
| 45–48 seconds | Completion tones |

Within each band, the deliberately unconfirmed route indices are 97, 270, 443, 616, 789, 962, 1135, and 1308. Reports are applied after their burst finishes. Initial coverage reaches 5,344 records; repair brings it to 5,376.

The verification utility uses the known packet timings in the manifest. It checks the preamble, decoded bytes, CRC, and reconstructed coverage ledger. It does not implement unknown-start synchronization or certify operation through a noisy physical channel.
