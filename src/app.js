import { Simulation } from './core/simulation.js';
import { modulate, wav, SAMPLE_RATE } from './core/modem.js';
import { GridMap } from './ui/map.js';
const $=id=>document.getElementById(id);
const map=new GridMap($('grid'));
let simulation=new Simulation({limit:300}),band=0,selectedKey=null,running=false,frame=0,lastTime=0,accumulator=0,audio=null,gain=null,audioUntil=0,monitorSkipped=0,epoch=1,worker=null;
const candidateButtons=new Map();
const bars=[];
for(let d=0;d<4;d++){
 const wrap=document.createElement('div'),label=document.createElement('div'),name=document.createElement('span'),value=document.createElement('span'),track=document.createElement('div'),fill=document.createElement('div');
 label.className='progress-label';name.textContent='D'+d;value.textContent='0%';label.append(name,value);track.className='track';fill.className='fill';track.append(fill);wrap.append(label,track);$('band-progress').append(wrap);bars.push({value,fill});
}
function selected(){return selectedKey?simulation.tracker.tracks.get(selectedKey):null;}
function announce(message){$('announcement').textContent=message;}
function setBand(value){band=value;for(const b of document.querySelectorAll('[data-band]')){const active=Number(b.dataset.band)===band;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));}if(selected()?.band!==band)selectedKey=null;render();}
function audioPacket(bytes){
 if(!$('sound').checked||!audio||audio.state!=='running')return;
 if(audio.currentTime<audioUntil){monitorSkipped++;return;}
 const pcm=modulate(bytes),buffer=audio.createBuffer(1,pcm.length,SAMPLE_RATE);buffer.copyToChannel(pcm,0);
 const node=audio.createBufferSource();node.buffer=buffer;node.connect(gain);node.start();audioUntil=audio.currentTime+buffer.duration+.07;
}
function render(){
 const tracks=simulation.tracker.active(simulation.tick),visible=tracks.filter(t=>t.band===band).sort((a,b)=>(b.status==='confirmed')-(a.status==='confirmed')||a.estimate.radius95-b.estimate.radius95);
 if(!selected()&&visible.length)selectedKey=`${band}:${visible[0].id}`;
 const keys=new Set(visible.map(t=>`${t.band}:${t.id}`));
 for(const [key,button] of candidateButtons)if(!keys.has(key)){button.remove();candidateButtons.delete(key);}
 $('candidates').querySelector('.empty')?.remove();
 if(!visible.length){const p=document.createElement('p');p.className='empty';p.textContent=simulation.tick?'No recent candidate in this band. Continue scanning or inspect another depth.':'Awaiting independent observations. Start acquisition to build the evidence map.';$('candidates').append(p);}
 for(const track of visible){
  const key=`${band}:${track.id}`;let b=candidateButtons.get(key);
  if(!b){b=document.createElement('button');b.className='candidate';b.innerHTML='<strong></strong><span class="pill"></span><small></small><span class="number"></span>';b.addEventListener('click',()=>{selectedKey=key;render();});candidateButtons.set(key,b);}
  b.classList.toggle('active',key===selectedKey);b.setAttribute('aria-pressed',String(key===selectedKey));b.querySelector('strong').textContent='B'+track.id;
  const pill=b.querySelector('.pill');pill.textContent=track.status;pill.className='pill '+track.status;b.querySelector('small').textContent=track.support+' supporting · D'+band;
  b.querySelector('.number').textContent='r95 '+track.estimate.radius95.toFixed(1);$('candidates').append(b);
 }
 $('candidate-count').textContent=String(visible.length).padStart(2,'0');
 const t=selected();
 $('selected-name').textContent=t?`B${t.id} / D${t.band}`:'No candidate selected';
 $('position').textContent=t?`${t.estimate.x.toFixed(2)}, ${t.estimate.y.toFixed(2)}`:'—';
 $('radius').textContent=t?t.estimate.radius95.toFixed(2)+' cells':'—';$('support').textContent=t?`${t.support} / ${t.accepted} accepted`:'—';
 $('geometry').textContent=t?(t.diversity*180/Math.PI).toFixed(1)+'°':'—';$('rejected').textContent=t?String(t.rejected):'—';
 $('estimate-note').textContent=t?(t.status==='confirmed'?'Corroborated by independent viewpoints. The radius describes this model’s posterior, not a field-calibrated guarantee.':t.status==='conflict'?'Recent observations conflict with the estimate. Confirmation is withheld.':'Needs at least five agreeing observations, two sensors, 25° view separation, and radius ≤ 2.5 cells.'):'Confirmation requires five agreeing observations, two sensors, separated viewpoints, and a compact posterior.';
 $('confirmed').textContent=String(tracks.filter(t=>t.status==='confirmed').length);$('track-summary').textContent=tracks.length+' active candidates';
 $('coverage').innerHTML=(simulation.coverage.fraction*100).toFixed(1)+'<span>%</span>';$('reports').textContent=String(simulation.network.stats.received);
 const stats=simulation.network.stats;$('radio-summary').textContent=`${stats.crcRejected} CRC rejects · ${stats.retries} retries`;
 $('step').innerHTML=String(simulation.tick).padStart(3,'0')+'<span> / '+simulation.config.limit+'</span>';
 $('monitor-summary').textContent=!$('sound').checked?'Audible monitor muted':monitorSkipped?`${monitorSkipped} fast-playback audio frames skipped`:'Validated observation packets';
 $('status').textContent=running?'ACQUIRING':simulation.status==='finished'?'RUN COMPLETE':simulation.tick?'PAUSED':'READY';$('status-dot').classList.toggle('running',running);
 $('epoch').textContent='EPOCH '+String(epoch).padStart(4,'0');
 for(let d=0;d<4;d++){const p=simulation.coverage.counts[d]/1344;bars[d].value.textContent=(p*100).toFixed(0)+'%';bars[d].fill.style.transform=`scaleX(${p})`;}
 for(const b of document.querySelectorAll('[data-relay]')){const online=simulation.network.online[Number(b.dataset.relay)];b.setAttribute('aria-pressed',String(online));b.querySelector('span').textContent=online?'Online':'Offline';}
 if(simulation.latest){const z=simulation.latest;$('latest').textContent=`R${z.origin} → collector · B${z.beacon} / D${z.band} · ${z.range.toFixed(2)} cells / ${(z.bearing*180/Math.PI).toFixed(1)}° · ${z.accepted?'accepted':'outlier rejected'}`;}else $('latest').textContent='No validated measurement received.';
 $('capture').disabled=!simulation.network.capture.length;
 $('capture-count').textContent=`${simulation.network.capture.length} captured hop frames${stats.captureOmitted?` · ${stats.captureOmitted} earlier frames omitted`:''}`;
 $('run').textContent=running?'Pause acquisition':simulation.status==='finished'?'Run again':simulation.tick?'Resume acquisition':'Run acquisition ↗';
 map.draw(simulation,band,t,$('truth').checked);
}
function stop(){running=false;cancelAnimationFrame(frame);if(gain&&audio)gain.gain.setValueAtTime(0,audio.currentTime);render();}
function reset(){
 stop();const seed=Number($('seed').value);
 if(!Number.isInteger(seed)||seed<0||seed>4294967295){announce('Use an integer scenario seed between 0 and 4,294,967,295.');return false;}
 epoch=epoch%65535+1;simulation=new Simulation({seed,epoch,mode:$('mode').value,loss:Number($('loss').value),limit:300});selectedKey=null;monitorSkipped=0;accumulator=0;
 for(const b of candidateButtons.values())b.remove();candidateButtons.clear();announce('');render();return true;
}
function animate(time){
 if(!running)return;const delta=Math.min(250,time-lastTime);lastTime=time;accumulator+=delta*Number($('speed').value);
 while(accumulator>=300){accumulator-=300;simulation.step();for(const bytes of simulation.deliveredAudio.splice(0))audioPacket(bytes);if(simulation.status==='finished'){stop();announce('Mission finished. Export the report to inspect unresolved candidates and synthetic evaluation results.');return;}}
 render();frame=requestAnimationFrame(animate);
}
$('run').addEventListener('click',async()=>{
 if(running){stop();return;}if(simulation.status==='finished'&&!reset())return;
 try{if(!audio){const AC=window.AudioContext||window.webkitAudioContext;audio=new AC();gain=audio.createGain();gain.gain.value=.34;gain.connect(audio.destination);}await audio.resume();gain.gain.setValueAtTime($('sound').checked?.34:0,audio.currentTime);}catch{announce('Audio is unavailable in this browser. The acquisition engine can still run.');}
 running=true;lastTime=performance.now();frame=requestAnimationFrame(animate);render();
});
$('reset').addEventListener('click',reset);
$('sound').addEventListener('change',()=>{if(gain&&audio)gain.gain.setValueAtTime($('sound').checked&&running?.34:0,audio.currentTime);render();});
for(const b of document.querySelectorAll('[data-band]'))b.addEventListener('click',()=>setBand(Number(b.dataset.band)));
for(const b of document.querySelectorAll('[data-relay]'))b.addEventListener('click',()=>{const id=Number(b.dataset.relay);simulation.setOnline(id,!simulation.network.online[id]);render();});
$('truth').addEventListener('change',render);
function download(bytes,type,name){const blob=new Blob([bytes],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('export').addEventListener('click',()=>download(JSON.stringify(simulation.report(),null,2),'application/json',`TranscentreVG-1-epoch-${epoch}.json`));
$('capture').addEventListener('click',()=>{try{download(wav(simulation.network.capture.map(c=>c.bytes)),'audio/wav',`TranscentreVG-1-capture-${epoch}.wav`);}catch(e){announce(e.message);}});
$('recording').addEventListener('change',async()=>{
 const file=$('recording').files[0];if(!file)return;worker?.terminate();$('decode-result').textContent='';
 if(file.size>64*1024*1024){$('decode-status').textContent='Use a WAV file smaller than 64 MiB.';return;}
 try{worker=new Worker(new URL('./decoder.worker.js',import.meta.url),{type:'module'});const current=worker;
 current.onmessage=({data})=>{if(current!==worker)return;if(data.type==='progress')$('decode-status').textContent='Searching audio… '+Math.round(data.progress*100)+'%';
  else if(data.type==='error'){$('decode-status').textContent=data.message;current.terminate();}
  else{$('decode-status').textContent=`${data.packets.length} valid frames recovered from ${data.duration.toFixed(1)} seconds.`;$('decode-result').textContent=data.packets.slice(0,12).map(({time,packet:p})=>`${time.toFixed(3)} s   ${p.legacy?'LEGACY':'VG-1'}   R${p.origin}   SEQ ${p.sequence}   D${p.band}${p.beacon?`   B${p.beacon}`:''}`).join('\n')+(data.packets.length>12?'\n… '+(data.packets.length-12)+' more valid frames':'');current.terminate();}}
 current.onerror=()=>{$('decode-status').textContent='The decoder could not start. Serve the project with npm start.';current.terminate();};
 $('decode-status').textContent='Reading audio…';const buffer=await file.arrayBuffer();current.postMessage(buffer,[buffer]);
 }catch(error){$('decode-status').textContent=error.message;}
});
new ResizeObserver(render).observe($('grid').parentElement);
document.addEventListener('visibilitychange',()=>{if(document.hidden&&running)stop();});
render();
// Deliberate inspection surface for reproducible browser verification.
window.TranscentreVG1={get simulation(){return simulation;},render,pause:stop,setBand};
