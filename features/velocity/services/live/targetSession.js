// A manually selected weight/bar target, tracked in a fixed-size grey image.
// Coordinates remain selected-target-height units. A selected rectangle is
// not a physical calibration and never authorises metres, m/s or gravity-
// based MPV/power. Source tracking is the attributed NCC web port in template.js.
import { createTemplateTracker } from '../vision/template.js';
import { findLifts } from '../bar3d.js';
import { savitzkyGolay, SG } from '../smooth.js';
import { concentricTiming, longestGap, LEAVE_THRESHOLD } from '../timing.js';

export const TARGET_NATIVE_UNITS = 'selected-target-heights';
export const TARGET_DEFAULTS = Object.freeze({ maxFrameSide: 480, maxFrames: 12000,
  maxGap: 0.5, maxSampleGap: 0.25, maxEdgeGap: 0.12, minRom: 0.2 });
const finite = Number.isFinite;
const positive = (v) => finite(v) && v > 0;
const ordered = (samples) => Array.isArray(samples) && samples.every((s,i) => s && finite(s.t) && (i === 0 || s.t > samples[i-1].t));
const snapshot = (track) => track.map((f) => ({ ...f, ...(f.box ? { box: { ...f.box } } : {}) }));
const validFrame = (frame,maxSide) => frame && Number.isInteger(frame.w) && Number.isInteger(frame.h)
  && frame.w > 0 && frame.h > 0 && Math.max(frame.w,frame.h) <= maxSide && frame.data?.length === frame.w * frame.h;
const maxSpacing = (samples,t0=-Infinity,t1=Infinity) => {
  let gap=0;
  for(let i=1;i<samples.length;i++) if(samples[i].t>=t0 && samples[i-1].t<=t1) gap=Math.max(gap,samples[i].t-samples[i-1].t);
  return gap;
};
/** Gap between actual measured positions bracketing an interpolated edge. */
function edgeSpacing(samples,t){
  let before=null;
  for(const s of samples){
    if(!finite(s.y)) continue;
    if(s.t<=t) before=s;
    if(s.t>=t) return before ? s.t-before.t : Infinity;
  }
  return Infinity;
}

/**
 * Relative lifting intervals with the same shape as the plate measurements.
 * minRom is a dimensionless engineering noise gate: 0.2 of the initially
 * selected target's image height. It is not an anatomical ROM threshold.
 * Timing uses interpolated 5%-of-peak crossings, not assumed frame counts.
 */
export function relativeTargetMetrics(samples,{minRom=TARGET_DEFAULTS.minRom,maxGap=TARGET_DEFAULTS.maxGap,
  maxSampleGap=TARGET_DEFAULTS.maxSampleGap,maxEdgeGap=TARGET_DEFAULTS.maxEdgeGap,half=SG.half}={}){
  const invalid={fit:[],reps:[],units:'relative',nativeUnits:TARGET_NATIVE_UNITS,reason:'Invalid samples or timing options'};
  if(!ordered(samples) || ![minRom,maxGap,maxSampleGap,maxEdgeGap,half].every(positive)) return invalid;
  if(!samples.length) return {...invalid,reason:'No selected-target samples'};
  const fit=savitzkyGolay(samples,{half,minPts:5,maxHalf:Math.max(half,0.25)});
  const lifts=findLifts(fit,{minRom});
  const reps=lifts.map((lift)=>{
    const base={...lift,ok:false,estimate:true,units:'relative',nativeUnits:TARGET_NATIVE_UNITS,
      mcv:NaN,pv:NaN,mpv:NaN,T:NaN,distance:NaN,avgPower:NaN,peakPower:NaN,peakForce:NaN};
    const no=(why)=>({...base,why});
    const t0=lift.tBottom-0.2,t1=lift.tTop+0.2;
    const timing=concentricTiming(fit,t0,t1,{threshold:LEAVE_THRESHOLD});
    if(!timing) return no('No clear relative lifting interval');
    if(!timing.startSeen || !timing.endSeen) return no(`Selected target not observed where the lift ${timing.startSeen?'ended':'started'}`);
    if(longestGap(samples,timing.tStart,timing.tEnd)>maxGap+1e-9) return no('Selected target was missing too long during the lift');
    if(maxSpacing(samples,timing.tStart,timing.tEnd)>maxSampleGap+1e-9) return no('Video samples were missing too long during the lift');
    if(edgeSpacing(samples,timing.tStart)>maxEdgeGap+1e-9 || edgeSpacing(samples,timing.tEnd)>maxEdgeGap+1e-9) return no('Frames missing at a lifting boundary');
    if(!(timing.distance>=0.8*lift.rise)) return no('Selected target was not followed over the full lifting span');
    // The peak is withheld if there is no measured position close to either
    // side. A smoothed interpolation through occlusion is not a peak reading.
    const peak=fit.filter(f=>f.full&&finite(f.v)&&f.t>=timing.tStart&&f.t<=timing.tEnd).reduce((best,f)=>!best||f.v>best.v?f:best,null);
    const peakSeen=peak&&longestGap(samples,peak.t-0.1,peak.t+0.1)<=maxEdgeGap+1e-9;
    return {...base,...timing,ok:true,mcv:timing.distance/timing.T,pv:peakSeen?timing.pv:NaN,
      mpv:NaN,estimate:true,why:'Relative template tracking; interpolated 5%-peak boundaries; physical scale and camera stability are unvalidated',
      ...(peakSeen?{}:{peakWhy:'Peak was not continuously observed'})};
  });
  return {fit,reps,units:'relative',nativeUnits:TARGET_NATIVE_UNITS,
    convention:'Own relative displacement / time between interpolated 5%-peak speed crossings'};
}

/**
 * Full-frame grey input must retain its dimensions (max side <=480 by default).
 * box = {x,y,w,h} in those image pixels, video timestamps in seconds.
 * Once expired (>maxGap without the target), a new init is required; a later
 * look-alike cannot silently become the original selected weight.
 */
export function createTargetSession(options={}){
  const config={...TARGET_DEFAULTS,...options};
  if(!Number.isInteger(config.maxFrameSide)||config.maxFrameSide<16||config.maxFrameSide>480
      ||!Number.isInteger(config.maxFrames)||config.maxFrames<2||config.maxFrames>60000
      ||![config.maxGap,config.maxSampleGap,config.maxEdgeGap,config.minRom].every(positive)) throw new RangeError('Invalid target session limits');
  const tracker=createTemplateTracker({...options,maxGap:config.maxGap});
  let track=[],initial=null,lastT=null,lastGoodT=null,width=0,height=0,forcedState=null,truncated=false;
  const sampleOf=(r)=>({t:r.t,y:r.ok?(initial.cy-r.cy)/initial.height:NaN});
  const failure=(t,reason,ignored=false)=>({ok:false,t,cx:NaN,cy:NaN,y:NaN,box:null,reason,...(ignored?{ignored:true}:{}),units:'relative',nativeUnits:TARGET_NATIVE_UNITS});
  const record=(result,t)=>{
    const entry={t,ok:result.ok===true,cx:result.ok?result.cx:NaN,cy:result.ok?result.cy:NaN,
      score:finite(result.score)?result.score:null,...(result.box?{box:{...result.box}}:{}),...(result.reason?{reason:result.reason}:{})};
    track.push(entry);lastT=t;
    if(entry.ok) lastGoodT=t;
    return {...result,t,y:sampleOf(entry).y,units:'relative',nativeUnits:TARGET_NATIVE_UNITS};
  };
  return {
    get state(){return forcedState||tracker.state;},
    get frames(){return track.length;},
    get box(){return tracker.box;},
    get samples(){return initial?track.map(sampleOf):[];},
    get trackFrames(){return snapshot(track);},
    reset(){tracker.reset();track=[];initial=null;lastT=null;lastGoodT=null;width=0;height=0;forcedState=null;truncated=false;},
    init(frame,box,t){
      if(!finite(t)||!validFrame(frame,config.maxFrameSide)) return failure(t,'Invalid initial grey frame or video timestamp');
      const result=tracker.init(frame,box,t);
      if(!result.ok) return {...failure(t,result.reason||'The selected target could not be initialized'),...result};
      initial={cx:result.cx,cy:result.cy,height:result.box.h};
      width=frame.w;height=frame.h;track=[];lastT=null;lastGoodT=null;forcedState=null;truncated=false;
      return record(result,t);
    },
    track(frame,t){
      if(!initial) return failure(t,'Select a target first');
      if(!finite(t)||t<=lastT) return failure(t,'Frame timestamps must strictly increase',true);
      if(track.length>=config.maxFrames){truncated=true;forcedState='expired';return failure(t,'Maximum target recording length reached; start another set');}
      if(forcedState==='expired'||tracker.state==='expired') return record(failure(t,'The selected target expired; select it again for a new set'),t);
      if(t-lastGoodT>config.maxGap+1e-9){forcedState='expired';return record(failure(t,'Selected target was not observed within the recovery interval'),t);}
      if(!validFrame(frame,config.maxFrameSide)||frame.w!==width||frame.h!==height){forcedState='lost';return record(failure(t,'Tracking frame dimensions changed or grey data is invalid'),t);}
      const result=tracker.track(frame,t);
      forcedState=null;
      return record(result,t);
    },
    finish(){
      const samples=initial?track.map(sampleOf):[];
      const metrics=relativeTargetMetrics(samples,config);
      const times=track.slice(1).map((f,i)=>f.t-track[i].t).filter(positive).sort((a,b)=>a-b);
      const observed=track.filter(f=>f.ok).length,coverage=track.length?observed/track.length:0;
      const duration=track.length>1?track.at(-1).t-track[0].t:0;
      const fps=times.length?1/times[times.length>>1]:null;
      const gap=samples.length>1?longestGap(samples,samples[0].t,samples.at(-1).t):null;
      const trackingAccepted=observed>=5&&coverage>=0.9&&fps>=24&&!truncated&&gap<=config.maxGap;
      const quality={ok:trackingAccepted,accepted:false,trackingAccepted,coverage,lost:1-coverage,frames:track.length,observed,fps,
        rate:duration>0?(track.length-1)/duration:null,maxUnobservedSec:gap,maxSampleGap:maxSpacing(samples),truncated,
        estimate:true,cameraMotionUnknown:true,note:'Relative selected-target template tracking. Camera motion cannot be separated from target motion; no physical calibration or external accuracy validation.'};
      return {ok:!!initial&&observed>0,samples,metrics,quality,track:snapshot(track),units:'relative',nativeUnits:TARGET_NATIVE_UNITS,
        calibration:{kind:'uncalibrated-template',validated:false,version:'target-height-v1',initialTargetHeightPx:initial?.height??null}};
    },
  };
}
