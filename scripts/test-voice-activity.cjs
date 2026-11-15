const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../apps/web/public/voice-activity.js'),'utf8').replace('export class PauseDetector','class PauseDetector');
const context={};vm.runInNewContext(source+';this.Detector=PauseDetector;',context);const {Detector}=context;
const feed=(detector,rms,ms)=>{let result;for(let elapsed=0;elapsed<ms;elapsed+=50)result=detector.feed(rms,50);return result;};
let detector=new Detector(3000);let result=feed(detector,0,10000);assert.equal(result.heardSpeech,false);assert.equal(result.ended,false);
// A short click is not enough to arm auto-send.
feed(detector,.2,50);assert.equal(feed(detector,0,4000).ended,false);
for(let click=0;click<20;click++){feed(detector,.2,50);assert.equal(feed(detector,0,500).heardSpeech,false);}
detector=new Detector(3000);feed(detector,.08,1000);assert.equal(feed(detector,0,2000).ended,false);
// Resuming speech resets the entire thinking pause.
feed(detector,.08,200);assert.equal(feed(detector,0,2500).ended,false);assert.equal(feed(detector,0,500).ended,true);
detector=new Detector(2000);feed(detector,.08,1000);detector.hold(true);assert.equal(feed(detector,0,7000).ended,false);detector.hold(false);assert.equal(feed(detector,0,1500).ended,false);assert.equal(feed(detector,0,500).ended,true);
assert.equal(detector.feed(NaN,50),null);
console.log('Pause detection: initial silence, transient noise, resumed speech, configurable pause, and thinking hold passed.');
