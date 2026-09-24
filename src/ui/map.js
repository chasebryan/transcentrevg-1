import { COLS, ROWS, CELLS } from '../core/grid.js';
export class GridMap {
  constructor(canvas) { this.canvas=canvas;this.ctx=canvas.getContext('2d');this.width=0; }
  draw(sim, band, selected, truth=false) {
    const canvas=this.canvas,ctx=this.ctx,width=canvas.clientWidth,dpr=window.devicePixelRatio||1;
    // Layout can briefly report zero width while the responsive grid is changing.
    if (width <= 48) return;
    const left=32,top=28,cell=(width-48)/COLS,height=top+ROWS*cell+30;
    if(canvas.width!==Math.round(width*dpr)||canvas.height!==Math.round(height*dpr)) {
      canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);canvas.style.height=height+'px';
    }
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
    const project=p=>({x:left+p.x*cell,y:top+p.y*cell});
    const probability=sim.coverage.probability[band],track=selected?.band===band?selected:null;
    let maxPosterior=0;if(track)for(const p of track.posterior)maxPosterior=Math.max(maxPosterior,p);
    for(let id=0;id<CELLS;id++){
      const x=left+id%COLS*cell,y=top+Math.floor(id/COLS)*cell,p=probability[id];
      ctx.fillStyle=`rgb(${13+Math.round(p*22)},${27+Math.round(p*43)},${31+Math.round(p*22)})`;
      ctx.fillRect(x+.6,y+.6,Math.max(1,cell-1.2),Math.max(1,cell-1.2));
      if(track && track.posterior[id]/maxPosterior>.015){ctx.fillStyle=`rgba(231,176,82,${Math.pow(track.posterior[id]/maxPosterior,.55)*.87})`;ctx.fillRect(x+.5,y+.5,cell-1,cell-1);}
    }
    ctx.font='10px ui-monospace,monospace';ctx.fillStyle='#789687';ctx.textBaseline='middle';
    for(const x of (width<450?[1,14,28,42]:[1,7,14,21,28,35,42])){ctx.textAlign='center';ctx.fillText(String(x).padStart(2,'0'),left+(x-.5)*cell,13);}
    for(const y of [1,8,16,24,32]){ctx.textAlign='right';ctx.fillText(String(y).padStart(2,'0'),left-9,top+(y-.5)*cell);}
    ctx.save();ctx.beginPath();ctx.rect(left,top,COLS*cell,ROWS*cell);ctx.clip();
    for(const sensor of sim.sensors){
      ctx.strokeStyle='#769f8955';ctx.lineWidth=1;ctx.beginPath();let pen=false;
      for(const point of sensor.trail){if(point.band!==band){pen=false;continue;}const p=project(point);if(!pen)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);pen=true;}ctx.stroke();
    }
    for(const candidate of sim.tracker.active(sim.tick)){
      if(candidate.band!==band)continue;
      const p=project(candidate.estimate),active=candidate===track;
      if(active){ctx.strokeStyle='#ebc887';ctx.lineWidth=1;ctx.setLineDash([4,4]);ctx.beginPath();ctx.arc(p.x,p.y,candidate.estimate.radius95*cell,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);}
      ctx.fillStyle=candidate.status==='confirmed'?'#e3efd2':'#ebbb70';ctx.strokeStyle=ctx.fillStyle;ctx.lineWidth=1.5;
      ctx.beginPath();ctx.arc(p.x,p.y,active?5:3,0,Math.PI*2);ctx.fill();
      if(active){ctx.beginPath();ctx.arc(p.x,p.y,9,0,Math.PI*2);ctx.stroke();}
      ctx.font='10px ui-monospace,monospace';ctx.textAlign=p.x>width-90?'right':'left';ctx.fillText('B'+candidate.id,p.x+(p.x>width-90?-12:12),p.y-10);
    }
    if(truth)for(const beacon of sim.truth){if(beacon.band!==band)continue;const p=project(beacon);ctx.strokeStyle='#b7bdd7';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(p.x-5,p.y-5);ctx.lineTo(p.x+5,p.y+5);ctx.moveTo(p.x+5,p.y-5);ctx.lineTo(p.x-5,p.y+5);ctx.stroke();}
    for(const sensor of sim.sensors){
      if(sensor.band!==band)continue;const p=project(sensor),goal=sensor.waypoint?project(sensor.waypoint):p;
      ctx.strokeStyle=sensor.online?'#c1eed04d':'#ba765744';ctx.setLineDash([3,5]);ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(goal.x,goal.y);ctx.stroke();ctx.setLineDash([]);
      ctx.save();ctx.translate(p.x,p.y);ctx.rotate(Math.atan2(goal.y-p.y,goal.x-p.x));ctx.fillStyle=sensor.online?'#b7e8cd':'#ba8467';ctx.beginPath();ctx.moveTo(7,0);ctx.lineTo(-5,-4);ctx.lineTo(-3,0);ctx.lineTo(-5,4);ctx.closePath();ctx.fill();ctx.restore();
      ctx.fillStyle='#b8d3bf';ctx.font='10px ui-monospace,monospace';ctx.textAlign=p.x>width-65?'right':'left';ctx.fillText('R'+sensor.id,p.x+(p.x>width-65?-10:10),p.y+13);
    }
    ctx.restore();ctx.fillStyle='#668876';ctx.font='9px ui-monospace,monospace';ctx.textAlign='left';ctx.fillText('D'+band+' / SYMBOLIC CELLS',left,height-11);
    ctx.textAlign='right';ctx.fillText(truth?'× TEST BEACONS':'MEASUREMENTS ONLY',left+COLS*cell,height-11);
    canvas.setAttribute('aria-label',`Depth ${band}; ${sim.coverage.counts[band]} of 1344 cells above the coverage threshold.${track?` Selected beacon ${track.id}, 95 percent model radius ${track.estimate.radius95.toFixed(2)} cells.`:''}`);
  }
}
