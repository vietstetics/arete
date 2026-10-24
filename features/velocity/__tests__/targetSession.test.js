import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTargetSession, relativeTargetMetrics, TARGET_NATIVE_UNITS } from '../services/live/targetSession.js';

const near = (actual, expected, tolerance) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected} by more than ${tolerance}`);
// One independently defined half-cosine rise, pause, and half-cosine descent.
// For threshold=.05, expected duration=1-2*asin(.05)/pi and displacement=sqrt(1-.05^2).
function position(t, amplitude=1) {
  if(t<0.6) return 0;
  if(t<1.6) return amplitude*(1-Math.cos(Math.PI*(t-0.6)))/2;
  if(t<2.1) return amplitude;
  if(t<3.1) return amplitude*(1+Math.cos(Math.PI*(t-2.1)))/2;
  return 0;
}
function samples({amplitude=1,jitter=false,duration=3.7,start=0}={}) {
  const out=[];let t=start,i=0;
  while(t<=duration){out.push({t,y:position(t,amplitude)});t+=(1/60)*(jitter?1+0.3*Math.sin(++i*1.7):1);}
  return out;
}
const initial={x:64,y:70,w:32,h:28};
const patch=(x,y)=>95+38*Math.sin(x*.37+y*.17)+31*Math.cos(y*.53-x*.11)+(x>6&&x<12&&y>4&&y<19?70:0)+(x>21&&y>16?-55:0);
function frame(dx=0,dy=0,{hidden=false,w=192,h=160}={}){
  const data=Float32Array.from({length:w*h},(_,i)=>40+5*Math.sin(i*.37));
  if(!hidden) for(let y=0;y<initial.h;y++) for(let x=0;x<initial.w;x++){
    const xx=initial.x+dx+x,yy=initial.y+dy+y;
    if(xx>=0&&xx<w&&yy>=0&&yy<h) data[yy*w+xx]=patch(x,y);
  }
  return {w,h,data};
}

test('relative target timing and mean/peak match a known trajectory without a metre scale',()=>{
  const metrics=relativeTargetMetrics(samples()),valid=metrics.reps.filter(r=>r.ok);
  assert.equal(valid.length,1,JSON.stringify(metrics.reps));
  const expectedT=1-2*Math.asin(.05)/Math.PI,expectedD=Math.sqrt(1-.05**2),r=valid[0];
  near(r.T,expectedT,.025);near(r.distance,expectedD,.015);near(r.mcv,expectedD/expectedT,.035);near(r.pv,Math.PI/2,.03);
  assert.equal(metrics.units,'relative');assert.equal(metrics.nativeUnits,TARGET_NATIVE_UNITS);
  assert.equal(r.estimate,true);assert.ok(Number.isNaN(r.mpv));assert.ok(Number.isNaN(r.peakPower));assert.ok(Number.isNaN(r.peakForce));
});

test('uneven real timestamps preserve duration and native displacement; native speed has no SI hard cap',()=>{
  const a=relativeTargetMetrics(samples({jitter:true})).reps.find(r=>r.ok);
  const b=relativeTargetMetrics(samples({jitter:true,amplitude:10})).reps.find(r=>r.ok);
  assert.ok(a&&b);
  near(a.T,b.T,.002);near(b.distance/a.distance,10,.02);near(b.mcv/a.mcv,10,.02);
  assert.ok(b.mcv>3.5,'small selected targets can legitimately move many target-heights/s');
});

test('upward motion is the concentric signal; a downward-only interval never becomes an upward rep',()=>{
  const down=samples().map(p=>({...p,y:-p.y})).filter(p=>p.t<2);
  assert.equal(relativeTargetMetrics(down).reps.filter(r=>r.ok).length,0);
  const original=samples();
  assert.equal(relativeTargetMetrics(original.slice(60,90)).reps.filter(r=>r.ok).length,0,'recording stopped mid-rise has no observed ending');
  assert.equal(relativeTargetMetrics(original.filter(p=>p.t>.95)).reps.filter(r=>r.ok).length,0,'recording beginning mid-rise has no observed start');
});

test('missing lift data or edge samples invalidates the affected velocity instead of bridging a long gap',()=>{
  const missing=samples().map(p=>p.t>.8&&p.t<1.4?{...p,y:NaN}:p);
  assert.equal(relativeTargetMetrics(missing).reps.filter(r=>r.ok).length,0);
  const skipped=samples().filter(p=>!(p.t>.8&&p.t<1.2));
  assert.equal(relativeTargetMetrics(skipped).reps.filter(r=>r.ok).length,0);
  const boundary=samples().map(p=>p.t>.55&&p.t<.76?{...p,y:NaN}:p);
  assert.equal(relativeTargetMetrics(boundary).reps.filter(r=>r.ok).length,0);
});

test('clock reversal/duplicates and invalid metric options are rejected without sorting evidence',()=>{
  const pts=samples();pts[10].t=pts[9].t;
  assert.match(relativeTargetMetrics(pts).reason,/Invalid/);
  assert.match(relativeTargetMetrics(samples(),{minRom:0}).reason,/Invalid/);
  assert.match(relativeTargetMetrics([]).reason,/No selected-target/);
});

test('target session follows measured centres and normalizes by the original selected image height',()=>{
  const s=createTargetSession();
  assert.equal(s.init(frame(),initial,2).ok,true);
  for(const [dx,dy,t] of [[4,-7,2.04],[10,-14,2.09],[13,-21,2.14]]){
    const r=s.track(frame(dx,dy),t);assert.equal(r.ok,true,r.reason);
    near(r.cx,initial.x+initial.w/2+dx,.1);near(r.y,-dy/initial.h,.001);
    assert.equal(r.units,'relative');
  }
  const result=s.finish();assert.equal(result.samples.length,4);assert.equal(result.samples[0].y,0);
  assert.equal(result.calibration.validated,false);assert.equal(result.calibration.initialTargetHeightPx,initial.h);
  assert.equal(result.quality.accepted,false,'a matching target alone cannot validate camera stability or physical accuracy');
  assert.equal(result.quality.cameraMotionUnknown,true);
});

test('repeated last video frame is ignored and cannot inflate the trace or change the tracker',()=>{
  const s=createTargetSession();s.init(frame(),initial,0);s.track(frame(2,-2),.04);
  const before=s.trackFrames;
  const repeated=s.track(frame(20,-20),.04);
  assert.equal(repeated.ok,false);assert.equal(repeated.ignored,true);assert.equal(s.frames,2);assert.deepEqual(s.trackFrames,before);
  assert.equal(s.track(frame(4,-4),.08).ok,true);
});

test('short loss stores a missing measurement and can locally recover; long loss expires until reselected',()=>{
  const s=createTargetSession({maxGap:.5});s.init(frame(),initial,0);
  assert.equal(s.track(frame(4,-3),.04).ok,true);
  assert.equal(s.track(frame(0,0,{hidden:true}),.12).ok,false);
  assert.ok(Number.isNaN(s.samples.at(-1).y));
  assert.equal(s.track(frame(10,-9),.2).ok,true);
  const long=s.track(frame(10,-10),.71);assert.equal(long.ok,false);assert.equal(s.state,'expired');
  assert.equal(s.track(frame(10,-10),.75).ok,false);
  assert.equal(s.init(frame(),initial,.8).ok,true);assert.equal(s.state,'tracking');assert.equal(s.frames,1);assert.equal(s.samples[0].y,0);
});

test('bounded trace memory never grows beyond maxFrames, including repeated expired calls',()=>{
  const s=createTargetSession({maxFrames:3});s.init(frame(),initial,0);
  s.track(frame(),.04);s.track(frame(),.08);
  for(let i=0;i<40;i++) assert.equal(s.track(frame(),.12+i*.04).ok,false);
  assert.equal(s.frames,3);assert.equal(s.trackFrames.length,3);assert.equal(s.state,'expired');
  const done=s.finish();assert.equal(done.quality.truncated,true);assert.equal(done.quality.ok,false);
});

test('frame size changes, invalid frame data and invalid selections produce no fabricated positions',()=>{
  const s=createTargetSession();
  assert.equal(s.init(frame(0,0,{w:640,h:360}),initial,0).ok,false);
  assert.equal(s.init(frame(),{x:-4,y:70,w:32,h:28},0).ok,false);
  assert.equal(s.frames,0);assert.equal(s.init(frame(),initial,0).ok,true);
  const changed=s.track(frame(0,0,{w:193}),.04);assert.equal(changed.ok,false);assert.ok(Number.isNaN(changed.y));
  assert.equal(s.track(frame(),.08).ok,true,'original dimensions may recover inside the loss interval');
  const corrupt=frame();corrupt.data[20]=NaN;
  assert.equal(s.track(corrupt,.12).ok,false);assert.ok(Number.isNaN(s.samples.at(-1).y));
});

test('returned snapshots do not expose mutable path, box or sample state',()=>{
  const s=createTargetSession();s.init(frame(),initial,0);s.track(frame(4,-7),.04);
  const trace=s.trackFrames;trace[0].box.h=1000;trace[1].cy=1000;trace.push({t:3,y:4});
  const finish=s.finish();finish.track[0].box.h=500;finish.samples[1].y=20;
  assert.equal(s.frames,2);assert.equal(s.trackFrames[0].box.h,initial.h);near(s.samples[1].y,.25,.001);
});
