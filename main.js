'use strict';
// Windows-only managed launcher. No arbitrary remote code runs in the Electron renderer.
const {app,BrowserWindow,ipcMain,safeStorage,shell,dialog}=require('electron');
const {readFileSync,writeFileSync,existsSync,mkdirSync,rmSync,renameSync,readdirSync,statSync,createWriteStream}=require('node:fs');
const fs=require('node:fs/promises');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {pipeline}=require('node:stream/promises');
const {Readable,Transform}=require('node:stream');
const extract=require('extract-zip');
const crypto=require('node:crypto');
const API='https://btifqqcrifafhnnccqmq.supabase.co';
// This is the Supabase PUBLISHABLE key (safe in clients), not a secret service-role key.
const KEY='sb_publishable_R5hNzUkxIjmAxRb1lYwFww_1vBVRHOo';
const BUCKET='fv-game-builds';
let win,account=null,busy=new Set();
const root=()=>path.join(app.getPath('userData'),'installed-games');
const registryPath=()=>path.join(app.getPath('userData'),'installed.json');
const tokenPath=()=>path.join(app.getPath('userData'),'session.bin');
const emit=(type,extra={})=>{if(win&&!win.isDestroyed())win.webContents.send('cv:event',{type,...extra});};
function rows(){try{const obj=JSON.parse(readFileSync(registryPath(),'utf8'));return Array.isArray(obj)?obj.filter(x=>x&&/^[\w-]+$/.test(x.id)&&typeof x.exe==='string'):[];}catch{return[];}}
function writeRows(data){writeFileSync(registryPath(),JSON.stringify(data,null,2));}
function authHeaders(){return {'apikey':KEY,'Authorization':'Bearer '+(account?.access_token||KEY)};}
async function request(route,{method='GET',body,auth=false}={}){
  const headers={...authHeaders()};if(body!==undefined)headers['Content-Type']='application/json';
  const response=await fetch(API+route,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}
  if(!response.ok)throw Error(data?.msg||data?.error_description||data?.message||`Server error ${response.status}`);
  return data;
}
function storeSession(){
  if(!account||!safeStorage.isEncryptionAvailable())return;
  writeFileSync(tokenPath(),safeStorage.encryptString(JSON.stringify(account)));
}
async function refresh(){
  if(!account?.refresh_token)return;
  const data=await request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:account.refresh_token}});
  account={...data,expires_at:Math.floor(Date.now()/1000)+Number(data.expires_in||3600)};storeSession();
}
async function ensureSession(){
  if(!account)throw Error('Sign in to download or manage games.');
  if(account.expires_at&&Date.now()/1000>account.expires_at-90)await refresh();
}
async function doLogin(email,password){
  const result=await request('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password}});
  account={...result,expires_at:Math.floor(Date.now()/1000)+Number(result.expires_in||3600)};
  storeSession();return {email:account.user?.email||email};
}
async function getStore(){
  try{return await request('/rest/v1/rpc/cv11_public_store_games',{method:'POST',body:{}});}
  catch{const data=await request('/rest/v1/games?select=*&order=created_at.desc&limit=500');return (data||[]).filter(x=>x.source_submission_id!=null);}
}
async function getLibrary(){
  await ensureSession();
  const owner=encodeURIComponent(account.user.id);
  return request(`/rest/v1/library?select=game_id,games(*)&user_id=eq.${owner}`);
}
async function owned(id){const list=await getLibrary();return list.some(row=>String(row.game_id)===String(id));}
async function versionMap(){
  await ensureSession();
  const result=await request('/rest/v1/rpc/cv_library_release_versions',{method:'POST',body:{}});
  return Object.fromEntries((result||[]).map(x=>[String(x.game_id),String(x.version||'1.0.0')]));
}
function managedDir(id){
  if(!/^[0-9a-f-]{16,64}$/i.test(id))throw Error('Invalid game identifier.');
  return path.join(root(),id);
}
function safeId(id){
  const str=String(id);if(!/^[0-9a-f-]{16,64}$/i.test(str))throw Error('Invalid game identifier.');return str;
}
function listExes(base,max=3000){
  const found=[];let count=0;
  function visit(dir){
    for(const e of readdirSync(dir,{withFileTypes:true})){
      if(++count>max)throw Error('The game package contains too many files.');
      if(e.isSymbolicLink())throw Error('Symbolic links are not allowed in game packages.');
      const f=path.join(dir,e.name);
      if(e.isDirectory())visit(f);else if(e.isFile()&&e.name.toLowerCase().endsWith('.exe'))found.push(f);
    }
  }
  visit(base);return found;
}
function selectExe(exes){
  const filtered=exes.filter(f=>!/unins|uninstall|setup|redist|vc_redist|crashreporter/i.test(path.basename(f)));
  if(filtered.length!==1)throw Error('Game ZIP must contain exactly one playable .exe (excluding uninstallers). Ask the developer to package one launch executable.');
  return filtered[0];
}
async function signedDownload(id){
  await ensureSession();
  if(!await owned(id))throw Error('Add this game to your account Library first.');
  const filepath=await request('/rest/v1/rpc/cv11_secure_download',{method:'POST',body:{p_game_id:id}});
  if(typeof filepath!=='string'||!filepath)throw Error('No downloadable game build is available.');
  if(filepath.startsWith('r2:'))throw Error('This game uses R2 storage. Launcher support requires a secure R2 download-ticket endpoint. Download it from the website for now.');
  if(filepath.startsWith('/')||filepath.includes('..')||filepath.includes('\\'))throw Error('Invalid build path.');
  const signed=await request('/storage/v1/object/sign/'+BUCKET+'/'+filepath.split('/').map(encodeURIComponent).join('/'),{method:'POST',body:{expiresIn:120}});
  const url=new URL(signed.signedURL||signed.signedUrl,API);
  if(url.protocol!=='https:'||url.origin!==new URL(API).origin)throw Error('Unexpected download host.');
  return url.href;
}
async function install(id){
  id=safeId(id);await ensureSession();
  if(busy.has(id))throw Error('Already downloading this game.');
  const catalog=await getStore(), game=(catalog||[]).find(g=>String(g.id)===id);
  if(!game||Number(game.price_cents)!==0)throw Error('Only approved, free games are supported by this launcher.');
  busy.add(id);
  const tmp=path.join(root(),'.staging-'+crypto.randomUUID());
  const zip=path.join(app.getPath('temp'),'cv-'+crypto.randomUUID()+'.zip');
  try{
    mkdirSync(root(),{recursive:true});mkdirSync(tmp,{recursive:true});
    emit('progress',{id,status:'Requesting secure download',percentage:0});
    const url=await signedDownload(id);
    const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(240000)});
    if(!response.ok||!response.body)throw Error('Download failed: HTTP '+response.status);
    const length=Number(response.headers.get('content-length')||0);let received=0;
    const max=2*1024*1024*1024;if(length>max)throw Error('Game exceeds 2 GB launcher limit.');
    const counter=new Transform({transform(chunk,_,done){received+=chunk.length;if(received>max)return done(Error('Download exceeds 2 GB.'));emit('progress',{id,status:'Downloading',percentage:length?Math.min(99,Math.round(received/length*100)):null,received});done(null,chunk);}});
    await pipeline(Readable.fromWeb(response.body),counter,createWriteStream(zip));
    const magic=Buffer.alloc(4);const file=await fs.open(zip,'r');try{await file.read(magic,0,4,0);}finally{await file.close();}
    if(magic.toString('hex')!=='504b0304')throw Error('Developer build is not a standard ZIP.');
    emit('progress',{id,status:'Unpacking',percentage:100});
    await extract(zip,{dir:tmp,onEntry(entry){
      const mode=(entry.externalFileAttributes>>>16)&0o170000;
      if(mode===0o120000)throw Error('Symlinks are prohibited in game ZIPs.');
    }});
    const exes=listExes(tmp),exe=selectExe(exes);
    const relative=path.relative(tmp,exe);
    if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('Unsafe executable path.');
    const destination=managedDir(id),previous=rows().find(x=>x.id===id);
    // Keep the previous working version until the new package has passed validation.
    const backup=destination+'.previous';
    if(existsSync(backup))rmSync(backup,{recursive:true,force:true});
    if(existsSync(destination))renameSync(destination,backup);
    try{renameSync(tmp,destination);}catch(e){if(existsSync(backup))renameSync(backup,destination);throw e;}
    const versions=await versionMap().catch(()=>({}));
    const newRecord={id,title:String(game.title||'Game'),exe:path.join(destination,relative),version:versions[id]||'Unknown',installedAt:new Date().toISOString(),owner:account.user.id};
    writeRows([...rows().filter(x=>x.id!==id),newRecord]);
    if(existsSync(backup))rmSync(backup,{recursive:true,force:true});
    emit('progress',{id,status:'Ready to play',percentage:100});
    return newRecord;
  }catch(e){emit('progress',{id,status:'Failed: '+e.message,percentage:null});throw e;}
  finally{busy.delete(id);await fs.rm(zip,{force:true}).catch(()=>{});await fs.rm(tmp,{recursive:true,force:true}).catch(()=>{});}
}
function localGames(){return rows().map(x=>({...x,installed:existsSync(x.exe)}));}
function launch(id){
  id=safeId(id);const g=rows().find(x=>x.id===id);
  if(!g||!existsSync(g.exe))throw Error('Game is not installed.');
  // Only allow launching the executable recorded inside the managed install folder.
  const dir=managedDir(id),rel=path.relative(dir,g.exe);
  if(!rel||rel.startsWith('..')||path.isAbsolute(rel)||path.extname(g.exe).toLowerCase()!=='.exe')throw Error('Unsafe launch path.');
  if(g.owner!==account?.user?.id)throw Error('Sign in with the account that installed this game.');
  const child=spawn(g.exe,[],{cwd:path.dirname(g.exe),detached:true,stdio:'ignore'});
  child.on('error',error=>emit('error',{message:error.message}));child.unref();return true;
}
async function uninstall(id){
  id=safeId(id);if(busy.has(id))throw Error('Wait until the download finishes.');
  const game=rows().find(x=>x.id===id);if(!game)return true;
  if(game.owner!==account?.user?.id)throw Error('Sign in with the account that installed this game.');
  rmSync(managedDir(id),{recursive:true,force:true});
  writeRows(rows().filter(x=>x.id!==id));return true;
}
app.whenReady().then(async()=>{
  mkdirSync(root(),{recursive:true});
  try{if(safeStorage.isEncryptionAvailable()&&existsSync(tokenPath())){account=JSON.parse(safeStorage.decryptString(readFileSync(tokenPath())));await refresh();}}catch{account=null;}
  win=new BrowserWindow({width:1280,height:820,minWidth:850,minHeight:600,title:'Cryptic Verse',backgroundColor:'#130d1b',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
  win.loadFile('index.html');
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',e=>e.preventDefault());
  ipcMain.handle('cv:session',()=>account?{email:account.user?.email||'',id:account.user?.id}:null);
  ipcMain.handle('cv:login',(_e,email,password)=>doLogin(String(email).trim(),String(password)));
  ipcMain.handle('cv:signup',async(_e,email,password)=>{const data=await request('/auth/v1/signup',{method:'POST',body:{email,password}});return {message:data.session?'Account created. Sign in.':'Check your email to confirm your account, then sign in.'};});
  ipcMain.handle('cv:logout',()=>{account=null;try{rmSync(tokenPath(),{force:true});}catch{}return true;});
  ipcMain.handle('cv:store',()=>getStore());
  ipcMain.handle('cv:library',()=>getLibrary());
  ipcMain.handle('cv:claim',async(_e,id)=>{await ensureSession();const game=(await getStore()).find(g=>String(g.id)===String(id));if(!game||Number(game.price_cents)!==0)throw Error('Only approved free games can be claimed.');await request('/rest/v1/library',{method:'POST',body:{user_id:account.user.id,game_id:id}});return true;});
  ipcMain.handle('cv:versions',()=>versionMap());
  ipcMain.handle('cv:installed',()=>localGames());
  ipcMain.handle('cv:install',(_e,id)=>install(id));
  ipcMain.handle('cv:launch',(_e,id)=>launch(id));
  ipcMain.handle('cv:uninstall',(_e,id)=>uninstall(id));
  ipcMain.handle('cv:open-folder',()=>shell.openPath(root()));
});
app.on('window-all-closed',()=>{app.quit();});
