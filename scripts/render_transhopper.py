from pathlib import Path
import json, math, bisect, subprocess, wave, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parents[1]
WORK=ROOT/'media'
M=json.loads((WORK/'manifest.json').read_text())
PATH=M['path']; ROUTES=[PATH,PATH[::-1],PATH,PATH[::-1]]
EV=M['events']; MISSING=M['missing']
W,H,FPS,DURATION=1280,1360,24,48
BG=(7,17,23); FG=(219,237,234); MUTED=(135,167,174)
GRID=(28,48,58); KNOWN=(100,232,176); RETRY=(248,183,99)
FILL=(22,67,57); MISSFILL=(82,56,32)
FONT=os.environ.get('TRANSHOPPER_FONT', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
MONO=os.environ.get('TRANSHOPPER_MONO_FONT', '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf')
fonts={s:ImageFont.truetype(FONT,s) for s in [16,18,20,22,24,28,32,42,58]}
mono={s:ImageFont.truetype(MONO,s) for s in [16,18,20,22,26,28]}
GX,GY,CELL=94,244,26
GW,GH=42*CELL,32*CELL
BASE=Image.new('RGB',(W,H),BG)
d=ImageDraw.Draw(BASE)
d.text((58,42),'TRANSHOPPER',font=fonts[58],fill=FG)
d.text((61,118),'GRIDLOCK / AUDIBLE RELAY STUDY',font=mono[20],fill=MUTED)
d.text((1220,49),'42 × 32',font=fonts[42],fill=KNOWN,anchor='ra')
d.text((1220,111),'4 DEPTH BANDS',font=mono[18],fill=MUTED,anchor='ra')
d.line((58,163,1222,163),fill=GRID,width=2)
for col in [1,7,14,21,28,35,42]:
    d.text((GX+(col-.5)*CELL,GY-27),f'{col:02d}',font=mono[16],fill=MUTED,anchor='mm')
for row in [1,8,16,24,32]:
    d.text((GX-21,GY+(row-.5)*CELL),f'{row:02d}',font=mono[16],fill=MUTED,anchor='rm')
for y in range(32):
    for x in range(42):
        d.rectangle((GX+x*CELL+2,GY+y*CELL+2,GX+(x+1)*CELL-3,GY+(y+1)*CELL-3),fill=(12,28,36))
for r in range(16):
    d.rectangle((GX+(r+.5)*CELL,GY+(r+.5)*CELL,GX+(41.5-r)*CELL,GY+(31.5-r)*CELL),outline=(23,40,49),width=1)
outer=(GX-17,GY-14,GX+GW+17,GY+GH+15)
d.rectangle(outer,outline=GRID,width=1)
nodes=[(outer[0],outer[1]),(outer[2],outer[1]),(outer[2],outer[3]),(outer[0],outer[3])]
for i,(x,y) in enumerate(nodes):
    d.ellipse((x-6,y-6,x+6,y+6),fill=MUTED)
    if i==0:d.text((x-13,y),'R1',font=mono[18],fill=FG,anchor='rm')
    elif i==1:d.text((x+13,y),'R2',font=mono[18],fill=FG,anchor='lm')
    else:d.text((x,y+29),'R'+str(i+1),font=mono[18],fill=FG,anchor='mm')
d.text((GX+GW/2,GY+GH+44),'FLAT PLAN VIEW  /  SYMBOLIC DEPTHS D0–D3',font=mono[16],fill=MUTED,anchor='mm')

ENDS=[e['end'] for e in EV]
STARTS=[e['t'] for e in EV]
states=[]
ledger=np.zeros((4,1344),np.uint8)
states.append(ledger.copy())
for e in EV:
    for j in range(32 if e['type']=='report' else 1):
        ledger[e['depth'],e['start']+j]=1 if e['mask']&(1<<(31-j)) else 2
    states.append(ledger.copy())

with wave.open(str(WORK/'transhopper-audio.wav'),'rb') as f:
    audio=np.frombuffer(f.readframes(f.getnframes()),dtype='<i2').reshape(-1,2).mean(axis=1)/32768

def drawframe(t):
    im=BASE.copy();d=ImageDraw.Draw(im)
    state=states[bisect.bisect_right(ENDS,t)]
    counts=(state==1).sum(axis=1)
    cur=max(0,bisect.bisect_right(STARTS,t)-1); e=EV[cur]
    if t<1:band,index,phase=0,0,'ACQUIRE / STARTUP CHIRP'
    elif t<37:
        band=min(3,int((t-1)//9));index=min(1343,int((t-1-9*band)/9*1344))
        phase=f'D{band} / '+('CIRCULATE OUTWARD' if band%2 else 'CIRCULATE INWARD')
    elif t<45:
        j=min(31,int((t-37)*4));band=j//8;index=MISSING[j%8]
        phase='RETRY / CLOSE UNCONFIRMED CELLS'
    else:band,index,phase=3,1343,'COMPLETE / EVERY CELL ACKNOWLEDGED'
    color=RETRY if 37<=t<45 else KNOWN
    d.text((60,186),phase,font=mono[20],fill=color)
    d.text((1220,184),f'{int(counts.sum()):,} / 5,376',font=mono[22],fill=FG,anchor='ra')
    for i,value in enumerate(state[band]):
        if not value:continue
        x,y=ROUTES[band][i];x0,y0=GX+x*CELL,GY+y*CELL
        d.rectangle((x0+2,y0+2,x0+CELL-3,y0+CELL-3),fill=FILL if value==1 else MISSFILL)
        if value==2:
            d.line((x0+8,y0+8,x0+CELL-9,y0+CELL-9),fill=RETRY,width=2)
            d.line((x0+CELL-9,y0+8,x0+8,y0+CELL-9),fill=RETRY,width=2)
    if 1<=t<37:
        points=[]
        for i in range(max(0,index-26),index+1):
            x,y=ROUTES[band][i];points.append((GX+(x+.5)*CELL,GY+(y+.5)*CELL))
        if len(points)>1:d.line(points,fill=KNOWN,width=3)
    if t<45:
        x,y=ROUTES[band][index];cx,cy=GX+(x+.5)*CELL,GY+(y+.5)*CELL
        d.rectangle((cx-11,cy-11,cx+11,cy+11),outline=FG,width=2)
        angle=t*22;dx,dy=math.cos(angle)*15,math.sin(angle)*15
        d.line((cx-dx,cy-dy,cx+dx,cy+dy),fill=FG,width=2)
        d.ellipse((cx-3,cy-3,cx+3,cy+3),fill=FG)
    # A token moves around the logical relay circuit, separate from the scan cursor.
    if 1<=t<45:
        sender=e['sender']-1; fraction=max(0,min(1,(t-e['t'])/(e['end']-e['t'])))
        a,b=nodes[sender],nodes[(sender+1)%4]
        px=a[0]+(b[0]-a[0])*fraction;py=a[1]+(b[1]-a[1])*fraction
        d.line((*a,px,py),fill=KNOWN,width=2)
        d.ellipse((px-5,py-5,px+5,py+5),fill=FG)
        d.ellipse((a[0]-9,a[1]-9,a[0]+9,a[1]+9),outline=KNOWN,width=2)
    for k in range(4):
        bx=60+k*298;by=1149
        d.text((bx,by),f'D{k}  {round(M["frequencies"][k])} Hz',font=mono[18],fill=FG if k==band else MUTED)
        d.text((bx,by+29),f'{int(counts[k]):,} / 1,344',font=mono[18],fill=FG)
        d.rectangle((bx,by+58,bx+254,by+63),fill=GRID)
        if counts[k]:d.rectangle((bx,by+58,bx+254*counts[k]/1344,by+63),fill=KNOWN)
    x,y=ROUTES[e['depth']][e['start']]
    packet_line=(f'R{e["sender"]} → R{e["sender"]%4+1}   D{e["depth"]}   C{x+1:02d} R{y+1:02d}   SEQ {e["seq"]:03d}' if t>=1 else 'HELLO / SYNCHRONIZE RELAY CIRCUIT')
    d.text((60,1246),packet_line,font=mono[20],fill=FG)
    d.text((1220,1246),f'{int(t):02d} / 48 s',font=mono[20],fill=MUTED,anchor='ra')
    # Display the real audio amplitude in a moving 0.6-second window.
    center=int(t*48000); start=max(0,center-14400);end=min(len(audio),center+14400)
    samples=audio[start:end];n=240
    if len(samples)>=n:
        size=len(samples)//n; chunks=samples[:size*n].reshape(n,size)
        amp=np.sqrt(np.mean(chunks*chunks,axis=1))
        for i,a in enumerate(amp):
            xx=61+i*4.82;hh=min(15,float(a)*130)
            d.line((xx,1303-hh,xx,1303+hh),fill=KNOWN if t<45 else MUTED,width=2)
    d.text((60,1330),'SIMULATED COVERAGE · NO GEOGRAPHIC OR ALTITUDE UNITS',font=mono[16],fill=MUTED)
    return im

drawframe(18).save(WORK/'preview.png')
output=WORK/'Transhopper-42x32.mp4'
cmd=['ffmpeg','-y','-hide_banner','-loglevel','error','-f','rawvideo','-vcodec','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-',
     '-i',str(WORK/'transhopper-audio.wav'),'-c:v','libx264','-preset','fast','-crf','20','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k',
     '-af','volume=1.8','-t',str(DURATION),'-movflags','+faststart',str(output)]
proc=subprocess.Popen(cmd,stdin=subprocess.PIPE)
try:
    for frame in range(DURATION*FPS):
        proc.stdin.write(drawframe(frame/FPS).tobytes())
        if frame%(FPS*8)==0:print(f'Rendered {frame//FPS:02d} / {DURATION} seconds',flush=True)
finally:proc.stdin.close()
status=proc.wait()
if status:raise RuntimeError(f'ffmpeg exited {status}')
print(str(output),flush=True)
