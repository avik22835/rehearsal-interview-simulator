'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('rehearsalAppearance',Object.freeze({
  setTheme:(theme)=>theme==='dark'||theme==='light'?ipcRenderer.invoke('rehearsal:set-theme',theme):Promise.resolve(false),
}));
