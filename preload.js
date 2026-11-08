'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('cryptic',Object.freeze({
  call:(name,...args)=>ipcRenderer.invoke('cv:'+name,...args),
  events:handler=>{
    const fn=(_event,data)=>handler(data);
    ipcRenderer.on('cv:event',fn);
    return ()=>ipcRenderer.removeListener('cv:event',fn);
  }
}));
