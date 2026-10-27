// Update checks use the configured GitHub Releases feed.
// No update is downloaded or installed without a user action.
function initializeUpdater({app, ipcMain, getWindow, enabled}) {
  const configured = true; // The public GitHub release feed is set explicitly below.
  let status = {state:'unavailable', message: !app.isPackaged ? 'Updates work in installed builds only.' : !configured ? 'Configure your GitHub Releases repository to enable updates.' : 'Ready to check for updates. Private GitHub releases require authentication; public release hosting must be configured for one-click updates.'};
  const send = (next) => {status={...status,...next}; const win=getWindow(); if(win && !win.isDestroyed())win.webContents.send('updater-status-changed',status);return status;};
  let updater=null;
  if (enabled && app.isPackaged && configured) {
    const {autoUpdater} = require('electron-updater');updater=autoUpdater;
    updater.setFeedURL({provider:'github',owner:'draffey19-cmd',repo:'evertale-audiobook-player'});
    updater.autoDownload=false;updater.autoInstallOnAppQuit=false;
    updater.on('checking-for-update',()=>send({state:'checking',message:'Checking GitHub Releases…'}));
    updater.on('update-available',info=>send({state:'available',version:info.version,message:`Version ${info.version} is available.`}));
    updater.on('update-not-available',()=>send({state:'current',message:'You are up to date.'}));
    updater.on('download-progress',p=>send({state:'downloading',percent:Math.round(p.percent),message:`Downloading update: ${Math.round(p.percent)}%`}));
    updater.on('update-downloaded',()=>send({state:'downloaded',percent:100,message:'Update downloaded. Restart to install.'}));
    updater.on('error',e=>send({state:'error',message:String(e.message||e).slice(0,300)}));
    send({state:'ready',message:'Ready to check GitHub Releases.'});
  }
  ipcMain.handle('updater-status',()=>status);
  ipcMain.handle('updater-check',async()=>{if(!updater)return status;try{await updater.checkForUpdates();}catch(e){send({state:'error',message:e.message});}return status;});
  ipcMain.handle('updater-download',async()=>{if(!updater||status.state!=='available')return status;try{await updater.downloadUpdate();}catch(e){send({state:'error',message:e.message});}return status;});
  ipcMain.handle('updater-install',()=>{if(!updater||status.state!=='downloaded')return status;setImmediate(()=>updater.quitAndInstall(false,true));return status;});
}
module.exports={initializeUpdater};
