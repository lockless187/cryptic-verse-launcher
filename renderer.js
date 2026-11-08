'use strict';
const $=id=>document.getElementById(id);
const state={tab:'store',user:null,store:[],owned:[],installed:[],versions:{},progress:new Map()};
const call=(name,...args)=>window.cryptic.call(name,...args);
const notify=text=>{$('status').textContent=text;};
const el=(tag,className,text)=>{const x=document.createElement(tag);if(className)x.className=className;if(text!==undefined)x.textContent=String(text);return x;};
function btn(text,onClick,cls=''){const b=el('button',cls,text);b.addEventListener('click',async()=>{b.disabled=true;try{await onClick();}catch(e){notify(e.message);}finally{b.disabled=false;}});return b;}
function cover(game){const d=el('div','cover');const url=game.image_url||game.cover_url||game.thumbnail_url||game.banner_url||'';
  if(typeof url==='string'&&/^https:\/\//i.test(url)){const img=el('img');img.src=url;img.alt=String(game.title||'')+' cover';img.onerror=()=>{d.textContent='◈';};d.append(img);}else d.textContent='◈';return d;}
function card(game,{owned=false,installed=null,update=false}={}){
  const div=el('article','game');div.append(cover(game));const info=el('div','content');
  info.append(el('div','label',game.genre||'GAME'),el('h3','',game.title||'Untitled Game'),el('p','',String(game.description||'Play your next adventure.').slice(0,155)));
  const actions=el('div','actions');const id=String(game.id),latest=state.versions[id]||'Unknown';
  if(installed){info.append(el('div','note','Installed '+installed.version+(latest!=='Unknown'?' · Latest '+latest:'')));
    actions.append(btn('▶ Play',()=>call('launch',id),'primary'),btn('Uninstall',async()=>{if(!confirm('Uninstall '+game.title+' from this computer?'))return;await call('uninstall',id);await refresh();}));
    if(update&&latest!=='Unknown'&&installed.version!==latest)actions.append(btn('↻ Update',()=>installGame(id),'primary'));
  }else if(!state.user){actions.append(btn('Sign in to install',()=>openAuth()));}
  else if(!owned){actions.append(btn('Add Free Game',async()=>{await call('claim',id);notify('Added to your Library');await refresh();},'primary'));
  }else actions.append(btn('↓ Install',()=>installGame(id),'primary'));
  info.append(actions);div.append(info);return div;
}
async function installGame(id){
  notify('Downloading and installing your game…');selectTab('downloads');
  if(!state.progress.has(id))state.progress.set(id,{status:'Starting',percentage:0});renderDownloads();
  try{await call('install',id);notify('Game installed! Open My Library to play.');await refresh();}
  catch(e){notify('Could not install: '+e.message);throw e;}
}
function putCards(target,arr,make,empty){const d=$(target);d.replaceChildren();if(!arr.length){d.append(el('p','empty',empty));return;}for(const x of arr)d.append(make(x));}
function renderStore(){const term=$('search').value.toLowerCase().trim();const arr=state.store.filter(g=>`${g.title||''} ${g.genre||''} ${g.description||''}`.toLowerCase().includes(term));putCards('store-games',arr,g=>card(g,{owned:state.owned.some(x=>String(x.game_id)===String(g.id)),installed:state.installed.find(x=>String(x.id)===String(g.id))}),'No approved games found.');}
function renderLibrary(){const arr=state.owned.map(x=>x.games).filter(Boolean);putCards('library-games',arr,g=>card(g,{owned:true,installed:state.installed.find(x=>String(x.id)===String(g.id))}),'Your Library is empty. Add a free game from the Store.');}
function renderDownloads(){const d=$('download-games');d.replaceChildren();if(!state.progress.size){d.append(el('p','empty','No downloads this session. Your installed games appear in My Library.'));return;}
  for(const [id,x] of state.progress){const item=el('div','download');const title=state.store.find(g=>String(g.id)===id)?.title||'Game';const head=el('div','download-head');head.append(el('strong','',title),el('span','note',x.status));item.append(head);const bar=el('div','bar');const inner=el('span');inner.style.width=(x.percentage??8)+'%';bar.append(inner);item.append(bar);d.prepend(item);}
}
function renderUpdates(){const arr=state.installed.filter(g=>g.owner===state.user?.id).map(g=>({...g,title:g.title,description:'Installed game'}));putCards('update-games',arr,g=>card(g,{owned:true,installed:g,update:true}),'You have no locally installed games.');}
async function refresh(){
  state.user=await call('session');$('who').textContent=state.user?.email||'Not signed in';$('auth-toggle').textContent=state.user?'Sign out':'Sign in';
  const responses=await Promise.allSettled([call('store'),call('installed'),state.user?call('library'):Promise.resolve([]),state.user?call('versions'):Promise.resolve({})]);
  if(responses[0].status==='fulfilled')state.store=(responses[0].value||[]).filter(g=>Number(g.price_cents)===0);
  else notify('Store unavailable: '+responses[0].reason.message);
  if(responses[1].status==='fulfilled')state.installed=responses[1].value||[];
  if(responses[2].status==='fulfilled')state.owned=responses[2].value||[];
  else notify('Library unavailable: '+responses[2].reason.message);
  if(responses[3].status==='fulfilled')state.versions=responses[3].value||{};
  renderStore();renderLibrary();renderUpdates();renderDownloads();
}
function selectTab(tab){state.tab=tab;document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('selected',x.dataset.tab===tab));document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.id==='tab-'+tab));$('page-title').textContent=({store:'Store',library:'My Library',downloads:'Downloads',updates:'Updates'})[tab];}
function openAuth(){$('auth-modal').classList.remove('hidden');$('auth-status').textContent='';}
function closeAuth(){$('auth-modal').classList.add('hidden');}
document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>selectTab(b.dataset.tab)));
$('search').addEventListener('input',renderStore);
$('store-reload').addEventListener('click',()=>refresh().catch(e=>notify(e.message)));
$('library-reload').addEventListener('click',()=>refresh().catch(e=>notify(e.message)));
$('check-updates').addEventListener('click',async()=>{try{await refresh();notify('Release versions checked. Updates are shown below.');}catch(e){notify(e.message);}});
$('open-folder').addEventListener('click',()=>call('open-folder').catch(e=>notify(e.message)));
$('auth-toggle').addEventListener('click',async()=>{if(state.user){await call('logout');notify('Signed out.');await refresh();}else openAuth();});
$('close-auth').addEventListener('click',closeAuth);
let signUp=false;
$('signup-btn').addEventListener('click',()=>{signUp=!signUp;$('login-btn').textContent=signUp?'Create Account':'Sign In';$('signup-btn').textContent=signUp?'Already registered? Sign in':'New here? Create account instead';});
$('auth-form').addEventListener('submit',async e=>{e.preventDefault();$('auth-status').textContent='Contacting Cryptic Verse…';const email=$('email').value,password=$('password').value;
  try{if(signUp){const r=await call('signup',email,password);$('auth-status').textContent=r.message;}else{await call('login',email,password);$('password').value='';closeAuth();await refresh();notify('Signed in successfully.');}}
  catch(err){$('auth-status').textContent=err.message;}
});
window.cryptic.events(data=>{if(data.type==='progress'){state.progress.set(data.id,{status:data.status,percentage:data.percentage});renderDownloads();}else if(data.type==='error')notify(data.message);});
refresh().catch(e=>notify(e.message));
