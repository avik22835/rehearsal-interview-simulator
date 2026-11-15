// Sample-clock pause detection: independent of background-tab timer throttling.
// This detects sustained audio activity, not linguistic meaning. Whisper still
// checks for speech before any recognized text can be sent.
export class PauseDetector {
  constructor(pauseMs=3000) { this.pauseMs=pauseMs;this.quietMs=0;this.voicedMs=0;this.armed=false;this.floor=0.002;this.held=false;this.ended=false; }
  hold(value) { this.held=value;this.quietMs=0; }
  feed(rms,ms) {
    if(!Number.isFinite(rms)||!Number.isFinite(ms)||ms<=0||this.ended)return null;
    const threshold=Math.max(0.012,this.floor*3);
    if(rms<threshold*0.7)this.floor=Math.max(0.001,Math.min(0.008,this.floor*0.97+rms*0.03));
    if(rms>=threshold){this.voicedMs+=ms;this.quietMs=0;}else this.quietMs+=ms;
    if(this.voicedMs>=400)this.armed=true;
    if(!this.armed&&this.quietMs>=450)this.voicedMs=0;
    const heardSpeech=this.armed;
    const remainingMs=heardSpeech&&!this.held?Math.max(0,this.pauseMs-this.quietMs):null;
    if(heardSpeech&&!this.held&&remainingMs===0)this.ended=true;
    return {activity:true,level:Math.min(1,rms*8),heardSpeech,remainingMs,ended:this.ended};
  }
}
