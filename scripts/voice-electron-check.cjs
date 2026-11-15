// Isolated desktop permission check. Only the synthetic microphone is used.
const {app,BrowserWindow,session}=require('electron');
const path=require('node:path');const os=require('node:os');
const {allowedStudioAudio}=require('../apps/desktop/host-policy.cjs');
app.setPath('userData',path.join(os.tmpdir(),'rehearsal-voice-permission-test'));
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
 const observed=[];const contents=win.webContents;
 session.defaultSession.setPermissionRequestHandler((sender,permission,callback,details)=>{const allowed=sender===contents&&allowedStudioAudio(permission,details.requestingUrl||contents.getURL(),details);observed.push({type:'request',permission,allowed,details});callback(allowed);});
 session.defaultSession.setPermissionCheckHandler((sender,permission,origin,details)=>{const allowed=sender===contents&&allowedStudioAudio(permission,origin,details);observed.push({type:'check',permission,allowed,details});return allowed;});
 try{
   await contents.loadURL('http://127.0.0.1:3000');
   const result=await contents.executeJavaScript(`(async()=>{try{const stream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});const count=stream.getAudioTracks().length;stream.getTracks().forEach(track=>track.stop());let videoDenied=false;try{const camera=await navigator.mediaDevices.getUserMedia({audio:true,video:true});camera.getTracks().forEach(track=>track.stop());}catch{videoDenied=true;}return {audioTracks:count,videoDenied};}catch(e){return {error:e.message};}})()`);
   console.log(JSON.stringify({result,observed}));
   app.exit(result.audioTracks===1&&result.videoDenied?0:1);
 }catch(error){console.error(error);app.exit(1);}
});
