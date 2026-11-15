// Local audio only: small PCM blocks to the interview view, no network from here.
import {PauseDetector} from './voice-activity.js';
class RehearsalRecorder extends AudioWorkletProcessor {
  constructor(){super();this.samples=new Float32Array(2048);this.offset=0;this.total=0;this.energy=0;this.done=false;this.detector=null;this.port.onmessage=event=>{if(event.data==='flush'){if(this.offset)this.port.postMessage(this.samples.slice(0,this.offset));this.offset=0;this.port.postMessage({flushed:true});}else if(event.data?.automatic)this.detector=new PauseDetector(event.data.pauseMs);else if(typeof event.data?.hold==='boolean')this.detector?.hold(event.data.hold);};}
  process(inputs,outputs){
    const input=inputs[0]?.[0];
    if(input&&!this.done)for(const sample of input){if(this.total++>=sampleRate*90){this.done=true;this.port.postMessage({limit:true});break;}this.samples[this.offset++]=sample;this.energy+=sample*sample;if(this.offset===this.samples.length){const activity=this.detector?.feed(Math.sqrt(this.energy/this.offset),this.offset/sampleRate*1000);this.port.postMessage(this.samples);if(activity)this.port.postMessage(activity);this.samples=new Float32Array(2048);this.offset=0;this.energy=0;if(activity?.ended){this.done=true;break;}}}
    for(const channel of outputs[0]||[])channel.fill(0);
    return true;
  }
}
registerProcessor('rehearsal-recorder',RehearsalRecorder);
