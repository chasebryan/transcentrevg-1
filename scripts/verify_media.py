"""Decode the demo's known packet windows and verify its coverage ledger.

This verifies an aligned synthetic recording, not an arbitrary noisy radio link.
"""
from pathlib import Path
import argparse
import json
import struct
import subprocess
import wave
import numpy as np

ROOT = Path(__file__).resolve().parents[1]

def crc16(data):
    value = 0xffff
    for byte in data:
        value ^= byte << 8
        for _ in range(8):
            value = ((value << 1) ^ (0x1021 if value & 0x8000 else 0)) & 0xffff
    return value

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--video', action='store_true', help='Verify the AAC track in the MP4 using FFmpeg.')
    args = parser.parse_args()
    manifest = json.loads((ROOT/'media/manifest.json').read_text())
    if args.video:
        data = subprocess.check_output(['ffmpeg','-v','error','-i',str(ROOT/'media/Transhopper-42x32.mp4'),
                                       '-map','0:a:0','-f','f32le','-ac','2','-ar','48000','-'])
        audio = np.frombuffer(data,dtype='<f4').reshape(-1,2).sum(axis=1)
    else:
        with wave.open(str(ROOT/'media/transhopper-audio.wav'),'rb') as f:
            if (f.getnchannels(),f.getsampwidth(),f.getframerate()) != (2,2,48000):
                raise ValueError('Expected 48 kHz stereo 16-bit PCM')
            audio = np.frombuffer(f.readframes(f.getnframes()),dtype='<i2').reshape(-1,2).astype(float).sum(axis=1)
    time = np.arange(40)/48000
    basis0 = np.exp(-2j*np.pi*1200*time)
    basis1 = np.exp(-2j*np.pi*2200*time)
    ledger = np.zeros((4,1344),dtype=bool)
    failures = []
    for ev in manifest['events']:
        start = round(ev['t']*48000)
        signal = audio[start:start+208*40].reshape(-1,40)
        bits = (np.abs(signal@basis1)>np.abs(signal@basis0)).astype(np.uint8)
        packet = np.packbits(bits).tobytes()
        payload = packet[8:]
        if packet[:8] != b'\xaa'*8 or payload.hex() != ev['hex'] or crc16(payload[:-2]) != int.from_bytes(payload[-2:],'big'):
            failures.append(ev['seq'])
            continue
        sync,kind,sender,epoch,seq,depth,offset,mask,ttl,checksum = struct.unpack('>2sBBHHBHIBH',payload)
        for bit in range(32 if kind==0x11 else 1):
            if mask & (1<<(31-bit)):
                ledger[depth,offset+bit] = True
    report = dict(source='MP4/AAC' if args.video else 'WAV/PCM',packets=len(manifest['events']),
                  failed_packets=failures,acknowledged_cell_bands=int(ledger.sum()))
    print(json.dumps(report,indent=2))
    if failures or int(ledger.sum()) != 5376:
        raise SystemExit(1)

if __name__ == '__main__':
    main()
