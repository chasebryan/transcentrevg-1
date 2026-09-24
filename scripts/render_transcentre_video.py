"""Render the actual VG-1 engine state as a 60-second, full-HD audible demo."""
from pathlib import Path
import argparse, bisect, json, math, os, shutil, subprocess, tempfile, wave
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--work-dir', type=Path, help='Retain intermediate data and review stills here')
args = parser.parse_args()
work = args.work_dir or Path(tempfile.mkdtemp(prefix='transcentre-video-'))
work.mkdir(parents=True, exist_ok=True)
subprocess.run(['node', str(ROOT/'scripts/build_transcentre_video.mjs'), str(work)], check=True)
data = json.loads((work/'frames.json').read_text())
frames = data['frames']; W,H,FPS,DURATION = 1920,1080,data['fps'],data['duration']
GX,GY,CELL = 80,226,22
GW,GH = 42*CELL,32*CELL
BG=(8,16,21); PANEL=(15,27,32); FG=(227,239,229); MUTED=(134,165,151)
GREEN=(177,235,195); AMBER=(239,187,103); LINE=(41,62,60); CYAN=(147,210,221)
font_path=os.environ.get('TRANSHOPPER_FONT','/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
mono_path=os.environ.get('TRANSHOPPER_MONO_FONT','/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf')
fonts={s:ImageFont.truetype(font_path,s) for s in [15,16,17,18,19,20,22,23,24,26,28,30,32,34,36,40,42,46,52]}
mono={s:ImageFont.truetype(mono_path,s) for s in [14,15,16,17,18,19,20,21,22,24,26,28,30,34,36,40,44,48]}
with wave.open(str(work/'audio.wav'),'rb') as stream:
    pcm=np.frombuffer(stream.readframes(stream.getnframes()),dtype='<i2').astype(np.float32)/32768
AUDIO_TIMES=[e['time'] for e in data['audio']]
chapters=[('Acquire the signal.', 'A precise estimate still needs independent evidence.'),
          ('Build independent support.', 'Different receivers turn a candidate into a confirmed beacon.'),
          ('Return for a better view.', 'The planner revisits candidates that lack useful geometry.'),
          ('Keep searching every depth.', 'Confirmation and modelled area coverage stay separate.'),
          ('Refine the evidence.', 'Valid reports sharpen position estimates as the search continues.')]
BASE=Image.new('RGB',(W,H),BG); d=ImageDraw.Draw(BASE)
d.text((57,31),'TRANSCENTRE',font=fonts[42],fill=FG)
d.rounded_rectangle((407,34,523,82),radius=6,outline=GREEN,width=2)
d.text((465,57),'VG-1',font=mono[26],fill=GREEN,anchor='mm')
d.text((59,101),'BEACON ACQUISITION / ENGINE DEMONSTRATION',font=mono[18],fill=MUTED)
d.text((1861,41),'42 × 32  /  FOUR DEPTH BANDS',font=mono[24],fill=FG,anchor='ra')
d.line((58,139,1862,139),fill=LINE,width=2)
d.line((1031,163,1031,1030),fill=LINE,width=1)
for col in [1,7,14,21,28,35,42]: d.text((GX+(col-.5)*CELL,209),f'{col:02d}',font=mono[14],fill=MUTED,anchor='mm')
for row in [1,8,16,24,32]: d.text((GX-13,GY+(row-.5)*CELL),f'{row:02d}',font=mono[14],fill=MUTED,anchor='rm')
d.rectangle((GX-1,GY-1,GX+GW,GY+GH),outline=LINE)
for x,label,color in [(80,'Received scan coverage',GREEN),(375,'Location probability',AMBER),(662,'95% model radius',FG)]:
    if x==662:d.ellipse((x,951,x+13,964),outline=color,width=1)
    else:d.rectangle((x,952,x+12,964),fill=color)
    d.text((x+22,947),label,font=fonts[16],fill=MUTED)
d.line((58,1041,1862,1041),fill=LINE)
d.text((60,1052),'SYNTHETIC STATIC BEACONS  ·  SYMBOLIC CELLS  ·  SEED 73',font=mono[15],fill=MUTED)
d.text((1860,1052),'UNCERTAINTY-DRIVEN ACQUISITION',font=mono[15],fill=MUTED,anchor='ra')

def text(draw,xy,value,size=20,color=FG,anchor=None,fixed=False):
    draw.text(xy,str(value),font=(mono if fixed else fonts)[size],fill=color,anchor=anchor)

def rounded(draw,box,fill=PANEL,outline=LINE,radius=10):
    draw.rounded_rectangle(box,radius=radius,fill=fill,outline=outline,width=1)

last_grid_tick=-1; cached_grid=None

def drawframe(time):
    global last_grid_tick,cached_grid
    progress=max(0,min(300,(time-data['intro'])*data['stepsPerSecond']))
    tick=int(progress); fraction=progress-tick; s=frames[tick]; nxt=frames[min(300,tick+1)]
    band=s['band']; selected=s['selected']; final=time>=53
    im=BASE.copy(); draw=ImageDraw.Draw(im)
    status='MISSION REVIEW' if final else 'ACQUIRING' if tick else 'READY'
    text(draw,(1860,101),f'{status}  /  STEP {tick:03d} OF 300  /  {int(time):02d} / 60 s',18,MUTED,'ra',True)
    for b in range(4):
        x=80+b*81; active=b==band
        rounded(draw,(x,160,x+67,193),(37,70,54) if active else PANEL,GREEN if active else LINE,5)
        text(draw,(x+33,176),f'D{b}',19,GREEN if active else MUTED,'mm',True)
    text(draw,(1004,169),'MEASUREMENTS ONLY',16,MUTED,'ra',True)
    if tick != last_grid_tick:
        grid=Image.new('RGB',(GW,GH),BG); gd=ImageDraw.Draw(grid)
        for cell,p in enumerate(s['coverage']):
            a=p/255; color=(int(13+a*23),int(27+a*46),int(31+a*23))
            if s['probability'] and s['probability'][cell]>5:
                a=.88*s['probability'][cell]/255
                color=tuple(int(color[j]*(1-a)+AMBER[j]*a) for j in range(3))
            x=(cell%42)*CELL; y=(cell//42)*CELL
            gd.rectangle((x+1,y+1,x+CELL-2,y+CELL-2),fill=color)
        cached_grid=grid; last_grid_tick=tick
    grid=cached_grid.copy(); gd=ImageDraw.Draw(grid)
    for sensor in s['sensors']:
        line=[]
        for p in sensor['trail']:
            if p['band']==band:line.append((p['x']*CELL,p['y']*CELL))
            elif len(line)>1:gd.line(line,fill=(69,105,93),width=2);line=[]
            else:line=[]
        if len(line)>1:gd.line(line,fill=(69,105,93),width=2)
    if selected:
        e=selected['estimate']; x=e['x']*CELL; y=e['y']*CELL; r=e['radius95']*CELL
        for a in range(0,360,12):gd.arc((x-r,y-r,x+r,y+r),a,a+6,fill=AMBER,width=2)
    for t in s['tracks']:
        if t['band']!=band:continue
        e=t['estimate']; x=e['x']*CELL; y=e['y']*CELL; color=GREEN if t['status']=='confirmed' else AMBER
        gd.ellipse((x-4,y-4,x+4,y+4),fill=color)
        if t['id']==s['focusId']:gd.ellipse((x-11,y-11,x+11,y+11),outline=FG,width=2)
        tx=x+12 if x<GW-115 else x-12; anchor='la' if x<GW-115 else 'ra'
        gd.text((tx,max(1,y-22)),f'B{t["id"]}',font=mono[14],fill=color,anchor=anchor,stroke_width=2,stroke_fill=BG)
    for sensor in s['sensors']:
        if sensor['band']!=band:continue
        next_sensor=nxt['sensors'][sensor['id']-1]
        mix=fraction if next_sensor['band']==band else 0
        x=(sensor['x']+(next_sensor['x']-sensor['x'])*mix)*CELL
        y=(sensor['y']+(next_sensor['y']-sensor['y'])*mix)*CELL
        goal=sensor['waypoint']
        if goal:
            ex=goal['x']*CELL;ey=goal['y']*CELL
            for j in range(0,20,2):
                gd.line((x+(ex-x)*j/20,y+(ey-y)*j/20,x+(ex-x)*(j+1)/20,y+(ey-y)*(j+1)/20),fill=(89,123,121),width=1)
            gd.ellipse((ex-3,ey-3,ex+3,ey+3),outline=CYAN)
        gd.rounded_rectangle((x-4,y-9,x+4,y+9),radius=3,fill=CYAN)
        rotor=time*15+sensor['id'];rx=math.cos(rotor)*15;ry=math.sin(rotor)*15
        gd.line((x-rx,y-ry,x+rx,y+ry),fill=FG,width=2)
        gd.text((min(GW-36,x+12),min(GH-19,y+9)),f'R{sensor["id"]}',font=mono[15],fill=CYAN,stroke_width=2,stroke_fill=BG)
    im.paste(grid,(GX,GY))
    # Received coverage in every band remains visible while the main view changes.
    for b in range(4):
        x=80+b*240;p=s['counts'][b]/1344
        text(draw,(x,984),f'D{b}',17,GREEN if b==band else MUTED,fixed=True)
        text(draw,(x+206,984),f'{p*100:.1f}%',17,FG,'ra',True)
        draw.rounded_rectangle((x,1013,x+206,1019),radius=2,fill=LINE)
        if p:draw.rounded_rectangle((x,1013,x+int(206*p),1019),radius=2,fill=GREEN)
    chapter=0 if tick<=60 else 1 if tick<=120 else 2 if tick<=180 else 3 if tick<=240 else 4
    title,caption=chapters[chapter]
    if final:title='A run backed by evidence.';caption='Final values below are the synthetic evaluation for this run.'
    text(draw,(1070,167),'ACQUISITION LOGIC' if not final else 'SYNTHETIC EVALUATION',16,GREEN,fixed=True)
    text(draw,(1070,197),title,36)
    # Deliberate two-line copy stays inside the full-HD sidebar.
    captions={0:['A precise estimate still needs','independent evidence.'],1:['Different receivers turn a candidate','into a confirmed beacon.'],2:['The planner revisits candidates','that lack useful geometry.'],3:['Confirmation and modelled area','coverage stay separate.'],4:['Valid reports sharpen estimates','as the search continues.']}
    lines=['Final results for this seeded run.','Model accuracy is not a field guarantee.'] if final else captions[chapter]
    for i,line in enumerate(lines):text(draw,(1071,249+i*26),line,20,MUTED)
    values=[('CONFIRMED',str(s['confirmed'])),('MODEL COVERAGE',f'{s["fraction"]*100:.1f}%'),('VALID REPORTS',str(s['network']['received']))]
    for j,(label,value) in enumerate(values):
        x=1070+j*267;rounded(draw,(x,322,x+248,425))
        text(draw,(x+18,336),label,15,MUTED,fixed=True);text(draw,(x+18,364),value,40,GREEN if j==0 else FG,fixed=True)
    rounded(draw,(1070,445,1852,789))
    if not final:
        text(draw,(1093,463),f'FOCUS  B{s["focusId"]} / D{band}',20,MUTED,fixed=True)
        tag=selected['status'].upper() if selected else 'AWAITING REPORTS'
        text(draw,(1828,463),tag,18,GREEN if tag=='CONFIRMED' else AMBER,'ra',True)
        if selected:
            e=selected['estimate']; support=selected['support']; receivers=len(selected['supportingObservers']); geometry=selected['geometryDegrees']
            text(draw,(1093,508),f'({e["x"]:.2f}, {e["y"]:.2f})',34,fixed=True)
            text(draw,(1828,521),'ESTIMATED POSITION / CELLS',15,MUTED,'ra',True)
            metrics=[('Agreeing observations',f'{support}  /  minimum 5',support>=5),('Independent receivers',f'{receivers}  /  minimum 2',receivers>=2),('View separation',f'{geometry:.1f}°  /  minimum 25°',geometry>=25),('95% model radius',f'{e["radius95"]:.2f} cells  /  maximum 2.5',e['radius95']<=2.5)]
            for j,(label,value,ok) in enumerate(metrics):
                yy=567+j*42;draw.ellipse((1095,yy+7,1103,yy+15),fill=GREEN if ok else AMBER)
                text(draw,(1115,yy),label,19,MUTED);text(draw,(1828,yy),value,18,GREEN if ok else AMBER,'ra',True)
            text(draw,(1093,753),f'{selected["rejected"]} outliers rejected  ·  Repeated viewpoints discounted',17,MUTED)
        else:
            text(draw,(1093,536),'Waiting for a validated measurement.',28)
            text(draw,(1093,591),'The tracker receives range and bearing.',22,MUTED)
            text(draw,(1093,627),'No true beacon positions enter its estimate.',22,MUTED)
    else:
        result=data['report']['evaluation']
        text(draw,(1093,465),'THIS RUN / 300 STEPS',19,MUTED,fixed=True)
        text(draw,(1093,505),f'{result["confirmed"]} / {result["total"]}',52,GREEN)
        text(draw,(1380,520),'synthetic beacons confirmed',22)
        for y,label,value in [(579,'False beacons ever confirmed',str(result['falseEverConfirmed'])),(629,'Median final position error',f'{result["medianError"]:.3f} cells'),(679,'Relayed reports received',str(s['network']['received']))]:
            text(draw,(1093,y),label,22,MUTED);text(draw,(1828,y),value,24,FG,'ra',True)
        text(draw,(1093,745),'Unresolved clutter remains unconfirmed.',19,MUTED)
    rounded(draw,(1070,810,1852,927))
    text(draw,(1093,826),'RELAY TRANSPORT',17,MUTED,fixed=True)
    text(draw,(1828,826),f'{s["network"]["crcRejected"]} CRC rejects  /  {s["network"]["retries"]} retries',17,MUTED,'ra',True)
    event_index=bisect.bisect_right(AUDIO_TIMES,time)-1
    event=data['audio'][event_index] if event_index>=0 else None
    active=event is not None and 0<=time-event['time']<.267
    if event:
        p=event['packet'];text(draw,(1093,865),f'R{p["origin"]} → COLLECTOR   B{p["beacon"]} / D{p["band"]}   SEQ {p["sequence"]:03d}',22,GREEN if active else FG,fixed=True)
    else:text(draw,(1093,865),'R1–R2–R3–R4 ring → collector',22,FG,fixed=True)
    text(draw,(1070,945),'AUDIBLE PACKETS / 1,200–2,200 Hz FSK',16,MUTED,fixed=True)
    text(draw,(1852,945),'RECEIVING' if active else 'MONITOR',16,GREEN if active else MUTED,'ra',True)
    center=int(time*48000); segment=pcm[max(0,center-1200):min(len(pcm),center+1200)]
    if len(segment)>160:
        size=len(segment)//160;amp=np.sqrt(np.mean(segment[:size*160].reshape(160,size)**2,axis=1))
        for j,a in enumerate(amp):
            x=1072+j*4.85;h=max(1,min(20,float(a)*110));draw.line((x,999-h,x,999+h),fill=GREEN if active else LINE,width=2)
    return im

for time in [5,18,29,44,57]:drawframe(time).save(work/f'review-{time:02d}.png')
output=ROOT/'media/TranscentreVG-1.mp4'
command=['ffmpeg','-y','-hide_banner','-loglevel','error','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-',
         '-i',str(work/'audio.wav'),'-c:v','libx264','-preset','fast','-crf','20','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k',
         '-t',str(DURATION),'-movflags','+faststart','-metadata','title=TranscentreVG-1 — Evidence-driven beacon acquisition',str(output)]
process=subprocess.Popen(command,stdin=subprocess.PIPE)
try:
    for frame in range(DURATION*FPS):
        process.stdin.write(drawframe(frame/FPS).tobytes())
        if frame%(FPS*5)==0:print(f'Rendered {frame//FPS:02d} / {DURATION} seconds',flush=True)
finally:process.stdin.close()
if process.wait():raise RuntimeError('Video encoding failed')
subprocess.run(['ffmpeg','-y','-v','error','-i',str(output),'-vn','-ac','1','-ar','48000','-c:a','pcm_s16le',str(work/'aac-roundtrip.wav')],check=True)
verification=subprocess.check_output(['node',str(ROOT/'scripts/build_transcentre_video.mjs'),'--verify',str(work/'aac-roundtrip.wav'),str(work/'manifest.json')],text=True)
manifest=json.loads((work/'manifest.json').read_text());manifest['verification']=json.loads(verification)
(ROOT/'media/TranscentreVG-1-video.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(verification.strip(),flush=True);print(output,flush=True)
if not args.work_dir:shutil.rmtree(work)
