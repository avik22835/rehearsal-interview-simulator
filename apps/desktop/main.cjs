'use strict';
const {app,BrowserWindow,WebContentsView,Menu,ipcMain,dialog,shell,nativeTheme}=require('electron');
nativeTheme.themeSource='dark';
const path=require('node:path');
const fs=require('node:fs');
const {allowedNavigation,safeOrigin,layout,sanitizeHealth,allowedStudioAudio}=require('./host-policy.cjs');
const {startDesktopGateway}=require('./desktop-gateway.cjs');
const root=path.resolve(__dirname,'../..');
const data=path.join(root,'data');
fs.mkdirSync(data,{recursive:true});
const appearanceFile=path.join(data,'desktop-appearance.json');
try{const saved=JSON.parse(fs.readFileSync(appearanceFile,'utf8'));if(saved==='light'||saved==='dark')nativeTheme.themeSource=saved;}catch{}
// Dedicated profile, separate from Edge and from the interview database.
app.setPath('userData',path.join(data,'desktop-profile'));
const logFile=path.join(data,'desktop-host-events.jsonl');
const summaryFile=path.join(data,'desktop-host-health.json');
let win,chat,studio,mode='split',lastHealth=null,sampling=false;
let desktopGateway=null,gatewayState={connected:false,ready:false,port:18791};
const startedAt=new Date().toISOString();
function record(type,detail={}) {
  fs.appendFileSync(logFile,JSON.stringify({at:new Date().toISOString(),type,...detail})+'\n');
}
function saveHealth() {
  if(!win || win.isDestroyed()) return;
  fs.writeFileSync(summaryFile,JSON.stringify({checkpoint:'desktop-integration',startedAt,
    electron:process.versions.electron,mode,minimized:win.isMinimized(),focused:win.isFocused(),
    chatOrigin:safeOrigin(chat.webContents.getURL()),chatBackgroundThrottling:chat.webContents.getBackgroundThrottling(),
    page:lastHealth,
    desktopGateway:gatewayState,transportMigrated:!!desktopGateway,signInVerification:'manual; a ready composer alone does not prove authentication',
  },null,2));
}
function arrange() {
  if(!win || win.isDestroyed())return;
  const [width,height]=win.getContentSize();const bounds=layout(width,height,mode);
  studio.setVisible(!!bounds.studio);chat.setVisible(!!bounds.chat);
  if(bounds.studio)studio.setBounds(bounds.studio);
  if(bounds.chat)chat.setBounds(bounds.chat);
  saveHealth();
}
function setMode(next){mode=next;arrange();record('view_mode',{mode});}
function remotePreferences(){return {partition:'persist:rehearsal-chatgpt',nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,backgroundThrottling:false,preload:path.join(__dirname,'generated/chat-preload.cjs')};}
function protectRemote(contents) {
  contents.on('will-navigate',(event,url)=>{if(!allowedNavigation(url)){event.preventDefault();record('navigation_blocked',{origin:safeOrigin(url)});}});
  contents.on('will-redirect',(event,url)=>{if(!allowedNavigation(url)){event.preventDefault();record('redirect_blocked',{origin:safeOrigin(url)});}});
  contents.setWindowOpenHandler(({url})=>{
    if(!allowedNavigation(url))return {action:'deny'};
    return {action:'allow',overrideBrowserWindowOptions:{parent:win,width:640,height:800,autoHideMenuBar:true,webPreferences:remotePreferences()}};
  });
  contents.on('did-create-window',child=>protectRemote(child.webContents));
  contents.on('will-attach-webview',event=>event.preventDefault());
  contents.on('render-process-gone',(_,details)=>record('chat_renderer_gone',{reason:details.reason,exitCode:details.exitCode}));
  contents.on('did-fail-load',(_,code,description,url,isMainFrame)=>{if(isMainFrame)record('chat_load_failed',{code,origin:safeOrigin(url)});});
}
async function createWindow(){
  win=new BrowserWindow({width:1440,height:940,minWidth:960,minHeight:640,title:'Rehearsal · Desktop',backgroundColor:nativeTheme.shouldUseDarkColors?'#0b0b0b':'#f6f6f6',show:false,
    webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
  studio=new WebContentsView({webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,preload:path.join(__dirname,'studio-preload.cjs')}});
  ipcMain.handle('rehearsal:set-theme',(event,theme)=>{
    if(event.sender!==studio.webContents||event.senderFrame!==studio.webContents.mainFrame||(theme!=='dark'&&theme!=='light'))return false;
    try{if(new URL(event.senderFrame.url).origin!=='http://127.0.0.1:3000')return false;}catch{return false;}
    nativeTheme.themeSource=theme;win.setBackgroundColor(theme==='dark'?'#0b0b0b':'#f6f6f6');
    fs.writeFileSync(appearanceFile,JSON.stringify(theme));return true;
  });
  chat=new WebContentsView({webPreferences:remotePreferences()});
  win.contentView.addChildView(studio);win.contentView.addChildView(chat);
  chat.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  chat.webContents.session.setPermissionCheckHandler(()=>false);
  studio.webContents.session.setPermissionRequestHandler((contents,permission,callback,details)=>{
    callback(contents===studio.webContents&&allowedStudioAudio(permission,details.requestingUrl||contents.getURL(),details));
  });
  studio.webContents.session.setPermissionCheckHandler((contents,permission,origin,details)=>
    contents===studio.webContents&&allowedStudioAudio(permission,origin,details));
  protectRemote(chat.webContents);
  studio.webContents.on('will-navigate',(event,url)=>{try{if(new URL(url).origin!=='http://127.0.0.1:3000')event.preventDefault();}catch{event.preventDefault();}});
  studio.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  for(const event of ['minimize','restore','focus','blur','show','hide'])win.on(event,()=>{record('window_'+event);saveHealth();});
  win.on('resize',arrange);
  win.on('close',()=>record('window_closed'));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {label:'Rehearsal',submenu:[{label:'Desktop checkpoint information',click:()=>dialog.showMessageBox(win,{type:'info',title:'Desktop host checkpoint',message:'Desktop ChatGPT connection',detail:'This window hosts the existing simulator and a separate persistent ChatGPT browser session. The built-in desktop adapter owns http://127.0.0.1:18791/v1 and uses this hosted ChatGPT session. No browser extension is required inside Electron. Provider settings must point to that endpoint. The Edge gateway on port 18790 is separate. No Edge cookies are imported.'})},{type:'separator'},{role:'quit'}]},
    {label:'Workspace',submenu:[{label:'Interview and ChatGPT',accelerator:'CmdOrCtrl+Shift+1',click:()=>setMode('split')},{label:'Interview only',accelerator:'CmdOrCtrl+Shift+2',click:()=>setMode('studio')},{label:'ChatGPT only / Sign in',accelerator:'CmdOrCtrl+Shift+3',click:()=>setMode('chat')},{type:'separator'},{label:'Reload interview interface',click:()=>studio.webContents.reload()},{label:'Reload ChatGPT',click:()=>chat.webContents.reload()}]},
    {label:'Verification',submenu:[{label:'Show current host health',click:()=>{saveHealth();dialog.showMessageBox(win,{type:'info',title:'Host health',message:'Browser host diagnostics',detail:JSON.stringify({mode,minimized:win.isMinimized(),page:lastHealth,backgroundThrottling:chat.webContents.getBackgroundThrottling()},null,2)});}},{label:'Open local diagnostics folder',click:()=>shell.openPath(data)},{label:'ChatGPT developer tools',click:()=>chat.webContents.openDevTools({mode:'detach'})}]},
  ]));
  ipcMain.on('rehearsal:page-health',(event,value)=>{
    if(event.sender!==chat.webContents || event.senderFrame!==chat.webContents.mainFrame)return;
    const clean=sanitizeHealth(value);if(!clean)return;
    lastHealth={...clean,receivedAt:new Date().toISOString(),origin:safeOrigin(event.sender.getURL())};
    if(clean.event!=='tick')record('page_'+clean.event,{hidden:clean.hidden});
    saveHealth();
  });
  desktopGateway=await startDesktopGateway({view:chat,root,record,onState:state=>{gatewayState={...gatewayState,...state};saveHealth();}});
  studio.webContents.loadURL('http://127.0.0.1:3000').catch(()=>record('studio_unavailable'));
  chat.webContents.loadURL('https://chatgpt.com/').catch(()=>record('chat_navigation_failed'));
  arrange();win.show();record('host_started',{electron:process.versions.electron});
  const healthTimer=setInterval(async()=>{
    if(sampling || !chat || chat.webContents.isDestroyed())return;
    sampling=true;
    try{const metrics=app.getAppMetrics().find(item=>item.pid===chat.webContents.getOSProcessId());record('process_sample',{minimized:win.isMinimized(),mode,pageTicks:lastHealth?.ticks??null,pageMaxGapMs:lastHealth?.maxGapMs??null,memory:metrics?.memory,cpu:metrics?.cpu});saveHealth();}
    catch{ /* A navigation can replace the renderer. */ }
    finally{sampling=false;}
  },10000);
  win.on('closed',()=>{clearInterval(healthTimer);desktopGateway?.close();app.quit();});
}
if(!app.requestSingleInstanceLock())app.quit();
else {
  app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.show();win.focus();}});
  app.whenReady().then(createWindow).catch(error=>{record('host_start_failed',{code:error.code||error.name});app.quit();});
  app.on('window-all-closed',()=>app.quit());
}
