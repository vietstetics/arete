// Real browser camera workflow with a synthetic video source and mocked pose
// detections. The selected-target pixels and Marticles template port are real;
// this verifies software integration, not phone-camera measurement accuracy.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import puppeteer from 'puppeteer-core';
const root=process.cwd();
const server=createServer(async(req,res)=>{
  try{const p=resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!p.startsWith(root+sep)){res.writeHead(403).end();return;}
    const b=await readFile(p);res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css'})[extname(p)]||'application/octet-stream');res.end(b);
  }catch{res.writeHead(404).end();}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));let browser;
try{
  browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const page=await browser.newPage(),origin=`http://127.0.0.1:${server.address().port}`,errors=[];
  await page.setViewport({width:390,height:844,deviceScaleFactor:2});
  page.on('pageerror',e=>{errors.push(e.message);console.log('BROWSER ERROR:',e.message);});await page.setRequestInterception(true);
  page.on('request',r=>{
    if(r.url().includes('/vision_bundle.mjs'))r.respond({headers:{'Access-Control-Allow-Origin':'*'},contentType:'text/javascript',body:'export const FilesetResolver={forVisionTasks:async()=>({})};export const PoseLandmarker={createFromOptions:async()=>({detectForVideo:()=>({landmarks:[window.__pose()]}),close(){}})};'});
    else if(r.url().startsWith(origin))r.continue();else r.abort();
  });
  await page.evaluateOnNewDocument(()=>{
    localStorage.setItem('arete_session',JSON.stringify({email:'selected-target@example.test'}));
    const cv=document.createElement('canvas');cv.width=320;cv.height=240;const c=cv.getContext('2d');
    let dropped=0;
    const tile=document.createElement('canvas');tile.width=32;tile.height=32;const tc=tile.getContext('2d'),pixels=tc.createImageData(32,32);
    let seed=12;for(let i=0;i<32*32;i++){seed=(seed*16807)%2147483647;const v=40+seed%200;pixels.data.set([v,v,v,255],i*4);}tc.putImageData(pixels,0,0);
    const draw=()=>{
      const elapsed=window.__movementStart?(performance.now()-window.__movementStart)/1000:-1;
      const cycle=elapsed>=0?elapsed%2.6:0,rep=elapsed>=0?Math.floor(elapsed/2.6):0;
      dropped=elapsed<0||rep>=2?0:cycle<1?(1-Math.cos(Math.PI*cycle))/2:cycle<1.2?1:cycle<2.2?(1+Math.cos(Math.PI*(cycle-1.2)))/2:0;
      c.fillStyle='#151515';c.fillRect(0,0,320,240);c.drawImage(tile,144,74+Math.round(70*dropped));
    };
    draw();window.__fakeTimer=setInterval(draw,1000/30);
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>cv.captureStream(30)});
    window.__pose=()=>{
      const p=Array.from({length:33},()=>({x:.5,y:.5,visibility:.1}));
      const value=205-87*dropped,sh=.62,width=.16*320,wrist=sh-((value-100)/100)*width/240;
      const at=(x,y)=>({x,y,visibility:.95});
      Object.assign(p,{11:at(.42,sh),12:at(.58,sh),23:at(.45,.78),24:at(.55,.78),13:at(.37,(sh+wrist)/2+.04),14:at(.63,(sh+wrist)/2+.04),15:at(.38,wrist),16:at(.62,wrist)});
      return p;
    };
  });
  await page.goto(`${origin}/curl-lab.html?ex=bench&debug=1`);
  assert.equal(await page.$eval('#tracking-method',e=>e.value),'template');
  await page.$eval('#kg-in',e=>{e.value='80';e.dispatchEvent(new Event('input'));});
  await page.click('#start-btn');
  await new Promise(done=>setTimeout(done,1200));
  console.log('Camera status:',await page.$eval('#status',e=>e.textContent));
  await page.waitForSelector('#target-canvas.selecting');
  await page.waitForFunction(()=>document.getElementById('video').videoWidth===320);
  const box=await page.evaluate(async()=>{
    const{screenPoint}=await import('./features/velocity/services/live/targetSelection.js');
    const rect=document.getElementById('target-canvas').getBoundingClientRect();
    return [screenPoint({x:144,y:74},rect,{vw:320,vh:240,mirror:true,fit:'cover'}),screenPoint({x:176,y:106},rect,{vw:320,vh:240,mirror:true,fit:'cover'})];
  });
  await page.mouse.move(box[0].clientX,box[0].clientY);await page.mouse.down();await page.mouse.move(box[1].clientX,box[1].clientY,{steps:8});await page.mouse.up();
  await page.waitForFunction(()=>window.__plateDebug().targetFrames>8);
  assert.equal(await page.evaluate(()=>window.__plateDebug().source),'template');
  // Allow the unchanged pose stillness/calibration gate to arm before lifting.
  await new Promise(done=>setTimeout(done,2600));
  await page.evaluate(()=>window.__movementStart=performance.now());
  await new Promise(done=>setTimeout(done,6600));
  await page.click('#end-btn');
  const out=await page.evaluate(()=>({debug:window.__plateDebug(),counted:+document.getElementById('d-count').textContent,
    records:JSON.parse(localStorage.getItem('arete_velocity_sets')||'[]'),exportVisible:!document.getElementById('target-tools').hidden}));
  assert.equal(out.counted,2,JSON.stringify(out.debug));
  assert.ok(out.debug.targetFrames>50);
  const rec=out.records.at(-1);assert.equal(rec.source,'marticles-template');assert.equal(rec.units,'relative');assert.equal(rec.tracker,'marticles-template-v1');
  assert.equal(rec.reps.filter(r=>r.velocity==='ok').length,2,JSON.stringify(rec));
  assert.ok(rec.reps.every(r=>r.mcv===null));assert.ok(rec.reps.every(r=>r.nativeMcv>0));assert.equal(out.exportVisible,true);
  // Exercise the external-analysis boundary with an explicitly synthetic
  // result. The separate Python tests invoke genuine upstream BarbellCV.
  const fixturePath=resolve(root,'backups/target-import-fixture.json');
  await writeFile(fixturePath,JSON.stringify({format:'arete-barbellcv-analysis-v1',recordId:rec.id,
    upstreamRevision:'7ffcd8853a3dbfb8da2b1993f63d844d3279cd2a',convention:'barbellcv-2d-path-speed-v1',units:'relative',
    calibration:{validated:false},nativeUnits:'selected-target-heights',
    measurements:[{n:1,tStart:1,tEnd:2,T:1,mcv:.5,pv:.8,distance:.4,pathDistance:.5,xRom:.1,yRom:.4}]}));
  const fileInput=await page.$('#barbellcv-file');await fileInput.uploadFile(fixturePath);
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('arete_velocity_sets')||'[]').at(-1)?.externalAnalyses?.length===1);
  const imported=await page.evaluate(()=>JSON.parse(localStorage.getItem('arete_velocity_sets')).at(-1));
  assert.equal(imported.counted,rec.counted);assert.deepEqual(imported.reps,rec.reps);
  await page.click('#coach-btn');assert.equal(await page.$eval('#cv-wrap',e=>e.hidden),false);
  assert.match(await page.$eval('#cv-metrics',e=>e.textContent),/BarbellCV local analysis/);
  await page.screenshot({path:'backups/selected-target-ui.png'});
  assert.deepEqual(errors,[]);
  console.log('PASS: mirrored target selection, pixel tracking, 2 ROM reps, relative velocities, saved records, isolated BarbellCV import and coach view.');
}finally{await browser?.close();await new Promise(done=>server.close(done));}
