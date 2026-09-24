from pathlib import Path
import json, math, struct, wave, subprocess
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'media'
OUT.mkdir(exist_ok=True)
COLS, ROWS, BANDS, SR, DURATION = 42, 32, 4, 48000, 48
FREQS = [440, 554.365, 659.255, 880]
PATH = []
for r in range(16):
    l, top, right, bottom = r, r, COLS-1-r, ROWS-1-r
    PATH.extend((x, top) for x in range(l, right+1))
    PATH.extend((right, y) for y in range(top+1, bottom+1))
    PATH.extend((x, bottom) for x in range(right-1, l-1, -1))
    PATH.extend((l, y) for y in range(bottom-1, top, -1))
assert len(PATH) == 1344 and len(set(PATH)) == 1344
assert all(abs(a[0]-b[0])+abs(a[1]-b[1]) == 1 for a,b in zip(PATH, PATH[1:]))
ROUTES = [PATH if d%2 == 0 else PATH[::-1] for d in range(BANDS)]
MISSED = [i for i in range(1344) if i % 173 == 97]
assert len(MISSED) == 8

def crc16(data):
    value = 0xffff
    for byte in data:
        value ^= byte << 8
        for _ in range(8):
            value = ((value << 1) ^ (0x1021 if value & 0x8000 else 0)) & 0xffff
    return value

def packet(kind, sender, seq, depth, start, mask):
    # 18 bytes, big endian. Version/type: 0x11 report, 0x12 repair.
    head = struct.pack('>2sBBHHBHI B', b'\xd5\xaa', kind, sender, 1, seq, depth, start, mask, 8)
    assert len(head) == 16
    return head + struct.pack('>H', crc16(head))

def modulate(frame):
    full = b'\xaa'*8 + frame
    bits = np.unpackbits(np.frombuffer(full, dtype=np.uint8))
    freq = np.repeat(np.where(bits, 2200.0, 1200.0), 40)
    phase = 2*np.pi*np.cumsum(freq)/SR
    signal = np.sin(phase)
    edge = 48
    signal[:edge] *= np.linspace(0,1,edge)
    signal[-edge:] *= np.linspace(1,0,edge)
    return signal

EVENTS = []
seq = 0
for depth in range(4):
    for block in range(42):
        seq += 1
        start = block*32
        mask = sum(1 << (31-j) for j in range(32) if start+j not in MISSED)
        frame = packet(0x11, (seq-1)%4+1, seq, depth, start, mask)
        EVENTS.append(dict(t=1+depth*9+block*9/42, end=1+depth*9+block*9/42+208/1200,
                           type='report', sender=(seq-1)%4+1, seq=seq, depth=depth,
                           start=start, mask=mask, hex=frame.hex()))
for depth in range(4):
    for j, index in enumerate(MISSED):
        seq += 1
        frame = packet(0x12, (seq-1)%4+1, seq, depth, index, 0x80000000)
        tm = 37+(depth*8+j)*.25
        EVENTS.append(dict(t=tm, end=tm+208/1200, type='repair', sender=(seq-1)%4+1,
                           seq=seq, depth=depth, start=index, mask=0x80000000, hex=frame.hex()))

audio = np.zeros((DURATION*SR,2), np.float32)
t_all = np.arange(DURATION*SR)/SR
# A restrained synthetic rotor texture, not a recording of an aircraft.
rotor = .007 * (np.sin(2*np.pi*37*t_all) + .25*np.sin(2*np.pi*74*t_all))
rotor *= (.3 + .7*(.5+.5*np.sin(2*np.pi*8*t_all))**4)
fade = np.minimum(1,np.minimum(t_all/.15,(DURATION-t_all)/.3))
audio[:,0] += rotor*fade
audio[:,1] += rotor*fade

def add_signal(signal, at, level=.14, pan=0):
    begin = round(at*SR)
    end = min(len(audio), begin+len(signal))
    signal = signal[:end-begin]
    gains = np.sqrt(np.array([(1-pan)/2,(1+pan)/2]))
    audio[begin:end] += (signal[:,None] * gains[None,:] * level).astype(np.float32)

def tone(freq, at, seconds, level=.10, pan=0, target=None):
    ts = np.arange(round(seconds*SR))/SR
    phases = 2*np.pi*(freq*ts if target is None else freq*ts+(target-freq)*ts*ts/(2*seconds))
    env = np.sin(np.pi*np.linspace(0,1,len(ts)))**2
    add_signal(np.sin(phases)*env,at,level,pan)

for i,f in enumerate([440,660,880]):
    tone(f,.1+i*.19,.14,.16, -.5+i*.5, f*1.16)

for ev in EVENTS:
    frame = bytes.fromhex(ev['hex'])
    x,y = ROUTES[ev['depth']][ev['start']]
    pan = .65*(2*x/41-1)
    add_signal(modulate(frame), ev['t'], .18, pan)
    tone(FREQS[ev['depth']], ev['end']+.003, .031,.18,pan)
    if ev['type'] == 'repair':
        tone(1320, ev['end']+.045,.012,.13,pan)
        tone(1320, ev['end']+.063,.012,.13,pan)

for i,f in enumerate(FREQS):
    tone(f,45.05+i*.18,.28,.18,(-.6+i*.4))
tone(1320,46.08,.12,.11)
tone(1320,46.26,.12,.11)

# Verify all transmitted packet data by demodulating the mixed stereo waveform.
bit_t = np.arange(40)/SR
basis0 = np.exp(-2j*np.pi*1200*bit_t)
basis1 = np.exp(-2j*np.pi*2200*bit_t)
decoded = []
for ev in EVENTS:
    begin = round(ev['t']*SR)
    mono = audio[begin:begin+208*40].sum(axis=1).reshape(-1,40)
    bits = (np.abs(mono@basis1) > np.abs(mono@basis0)).astype(np.uint8)
    raw = np.packbits(bits).tobytes()
    assert raw[:8] == b'\xaa'*8, (ev['seq'], 'preamble')
    assert raw[8:] == bytes.fromhex(ev['hex']), (ev['seq'], 'decode')
    assert crc16(raw[8:-2]) == int.from_bytes(raw[-2:],'big')
    decoded.append(raw[8:])

ledger = np.zeros((4,1344), dtype=bool)
for ev in EVENTS:
    for j in range(32 if ev['type']=='report' else 1):
        if ev['mask'] & (1 << (31-j)):
            ledger[ev['depth'], ev['start']+j] = True
assert ledger.sum() == 5376
peak = float(np.max(np.abs(audio)))
assert peak < .95
with wave.open(str(OUT/'transhopper-audio.wav'),'wb') as f:
    f.setnchannels(2); f.setsampwidth(2); f.setframerate(SR)
    f.writeframes((audio*32767).astype('<i2').tobytes())
manifest = dict(columns=42, rows=32, bands=4, duration=48, path=PATH, missing=MISSED,
                frequencies=FREQS, events=EVENTS, total=5376, sample_rate=SR,
                packet_format='D5AA | version/type:u8 | sender:u8 | epoch:u16 | sequence:u16 | depth:u8 | start:u16 | ack:u32 | TTL:u8 | CRC16:u16')
(OUT/'manifest.json').write_text(json.dumps(manifest,separators=(',',':')))
print(json.dumps(dict(cells_per_band=len(PATH), unique_cells=len(set(PATH)), bands=4,
                     completed_cell_bands=int(ledger.sum()), packets_decoded=len(decoded),
                     initial_missing=32, crc_failures=0, peak=peak, duration=48)))
