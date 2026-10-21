import './style.css';
import './mobile.css';
import './settings.css';
import './courses.css';
import './browser-gestures.css';
import './keyboard.css';
import { track as defaultTrack, createTrack, TRACK_CATALOG, DEFAULT_TRACK_ID } from './game/track.js';
import { Race } from './game/race.js';
import { World } from './world.js';
import { UI } from './ui.js';
import { Network } from './network.js';
import { AudioEngine } from './audio.js';
import { PHYSICS } from './game/physics.js';
import { drivingInput } from './input.js';
import { GameSettings } from './settings.js';
import { CoursePicker } from './course-picker.js';
import { installBrowserGuards } from './browser-gestures.js';
import { actionForKey } from './keyboard-bindings.js';

const trackCache=new Map([[DEFAULT_TRACK_ID,defaultTrack]]);
function getTrack(id){if(!trackCache.has(id))trackCache.set(id,createTrack(id));return trackCache.get(id);}
let initialTrackId=DEFAULT_TRACK_ID;
try{const remembered=localStorage.getItem('sunny-course-v1');if(TRACK_CATALOG.some(course=>course.id===remembered))initialTrackId=remembered;}catch{}
let track=getTrack(initialTrackId);
let race=new Race(track),world,settings,coursePicker,worldGeneration=0,worldLoading=false,worldReady=Promise.resolve(),settingsResume=false,online=false,showedResults=false,rotationPaused=false,selection={character:'fox',difficulty:'normal',trackId:track.id};
const keys=new Set(),audio=new AudioEngine();
let mute=false;try{mute=localStorage.getItem('sunny-muted')==='true';}catch{}
audio.setMuted(mute);
const clearKeys=()=>{keys.clear();ui.clearTouch();};
function pause(){if(!['racing','countdown'].includes(race.phase))return;if(online){ui.showToast('联机比赛持续进行，退出可返回大厅');return;}race.pause();ui.setPaused(true);clearKeys();}
function resume(){race.resume();ui.setPaused(false);audio.unlock();}
function mainMenu(){network.leave();online=false;rotationPaused=false;ui.setOnline(false);clearKeys();race=new Race(track,selection);showedResults=false;ui.showMenu();world?.setLineup?.(race.racers);}
function start(options=selection){if(worldLoading)return;network.leave();online=false;rotationPaused=false;ui.setOnline(false);selection={...selection,...options};race=new Race(track,selection);race.start();showedResults=false;ui.setPaused(false);ui.enterRace?.();clearKeys();audio.unlock();world?.setLineup?.(race.racers);}
const ui=new UI({
  onStart:start,onPause:pause,onResume:resume,
  onInputModeChange:()=>keys.clear(),
  onOverview:active=>{if(world)world.overview=active;},
  onAutoThrottleChange:active=>settings?.setValues({autoThrottle:active},{notify:false}),
  onCharacterChange:character=>{selection.character=character;if(race.phase==='menu'){race=new Race(track,selection);world?.setLineup?.(race.racers);}},
  onRestart:()=>{if(online){if(network.room?.hostId===network.id)network.start();else ui.showToast('等待房主开始下一场比赛');return;}start(selection);},onMenu:mainMenu,
  onMute:()=>{mute=!mute;audio.unlock();audio.setMuted(mute);ui.setMuted(mute);try{localStorage.setItem('sunny-muted',String(mute));}catch{}},
  onCreateRoom:options=>{selection={...selection,...(options||{})};audio.unlock();network.create(selection.character,selection.difficulty,track.id).catch(e=>ui.showToast(e.message));},
  onJoinRoom:(code,options)=>{selection={...selection,...(options||{})};audio.unlock();network.join(code,selection.character).catch(e=>ui.showToast(e.message));},
  onLeaveRoom:mainMenu,onStartRoom:()=>{audio.unlock();network.start();},
});
coursePicker=new CoursePicker(document.querySelector('#app'),{onSelect:id=>selectCourse(id,true)});
coursePicker.setSelected(track.id);coursePicker.setBusy(true);ui.setCourse(track);
ui.setMuted(mute);
installBrowserGuards();
function applySettings(values){ui.autoThrottleChosen=true;ui.setAutoThrottle(values.autoThrottle,false);ui.setControlLayout(values.controlLayout);ui.clearTouch();audio.setVolume(values.soundVolume);world?.setGraphicsQuality(values.graphics);}
settings=new GameSettings(document.querySelector('#app'),{
  defaults:{autoThrottle:ui.mobile.inputMode==='touch'},onChange:applySettings,
  onOpen:()=>{ui.settingsOpen=true;clearKeys();settingsResume=!online&&['racing','countdown'].includes(race.phase);if(settingsResume){race.pause();ui.setPaused(true);}},
  onClose:()=>{ui.settingsOpen=false;clearKeys();if(settingsResume&&race.phase==='paused'){if(ui.mobile.blocked)rotationPaused=true;else resume();}settingsResume=false;},
  onBindingsChange:bindings=>{clearKeys();ui.setKeyBindings(bindings);},
});
ui.setKeyBindings(settings.bindings);
settings.setInputMode(ui.root.dataset.inputMode);
ui.root.addEventListener('inputmodechange',()=>{clearKeys();settings.setInputMode(ui.root.dataset.inputMode);});
applySettings(settings.values);
const network=new Network({
  status:state=>ui.setNetwork(state),
  room:room=>{if(room.status==='lobby'){selectCourse(room.trackId||DEFAULT_TRACK_ID,false);ui.showLobby(room);}},
  started:(state,id)=>{selectCourse(state.trackId||network.room?.trackId||DEFAULT_TRACK_ID,false);online=true;showedResults=false;race=new Race(track,{...selection,multiplayer:true,localPlayerId:id});race.applySnapshot(state,id);selection={character:race.player.character,difficulty:network.room?.difficulty??selection.difficulty,trackId:track.id};clearKeys();ui.setPaused(false);ui.enterRace?.();ui.setOnline(true);world?.setLineup?.(race.racers);},
  snapshot:state=>{if(!online)return;race.applySnapshot(state,network.id);
    // Prediction starts from the authoritative state and accounts for roughly one-way latency.
    if(race.phase==='racing'&&!race.player.finished)predictPlayer(Math.min(.12,network.ping/2000),readInput());
  },
  error:message=>ui.showToast(message),
  disconnected:()=>{mainMenu();ui.showToast('联机连接已断开，请重新创建或加入房间');},
});

function selectCourse(id,persist=false){
  if(!TRACK_CATALOG.some(course=>course.id===id)){ui.showToast('这条赛道暂不可用，请刷新游戏后重试');return;}
  if(persist){try{localStorage.setItem('sunny-course-v1',id);}catch{} }
  if(track.id===id)return;
  track=getTrack(id);selection.trackId=id;race=new Race(track,selection);showedResults=false;clearKeys();ui.setCourse(track);coursePicker.setSelected(id);
  worldReady=loadWorld().catch(error=>{console.error(error);ui.showToast('赛道载入失败，请刷新后重试');});
}

async function loadWorld(){
  const generation=++worldGeneration;worldLoading=true;coursePicker.setBusy(true);ui.setLoading(.1);
  try{
    world?.dispose();const next=new World(document.querySelector('#game'),track);world=next;
    next.setGraphicsQuality(settings.values.graphics);ui.setLoading(.55);
    await next.createKarts();if(generation!==worldGeneration)return;
    next.setLineup(race.racers);ui.setLoading(1);ui.setCourse(track);
  }finally{if(generation===worldGeneration){worldLoading=false;coursePicker.setBusy(false);}}
}

function predictPlayer(duration,input){
  const eventCount=race.events.length;
  while(duration>0){const step=Math.min(PHYSICS.fixedStep,duration);race.stepRacer(race.player,input,step);duration-=step;}
  // Effects and awards are presented only when confirmed by the server.
  race.events.length=eventCount;
}

function readInput(){return drivingInput(keys,ui.touchState,ui.autoThrottle,{bindings:settings.bindings,sensitivity:settings.values.steeringSensitivity,blocked:ui.mobile.blocked||settings.isOpen});}
window.addEventListener('keydown',event=>{
  if(settings.isOpen||ui.mobile.blocked)return;
  if(event.isComposing||event.key==='Process'||event.keyCode===229||event.ctrlKey||event.metaKey||event.altKey){keys.clear();return;}
  if(event.target?.closest?.('input,textarea,select,[contenteditable="true"],.courses-overlay,.help-overlay,.lobby-overlay'))return;
  const action=actionForKey(settings.bindings,event.code);if(!action)return;
  if(race.phase!=='menu')event.preventDefault();
  if(!event.repeat&&action==='pause'){if(race.phase==='paused')resume();else if(['racing','countdown'].includes(race.phase))pause();}
  if(!event.repeat&&action==='restart'&&!online&&race.phase!=='menu')start(selection);
  if(!event.repeat&&action==='autoThrottle')ui.setAutoThrottle?.(!ui.autoThrottle);
  keys.add(event.code);
});
window.addEventListener('keyup',e=>keys.delete(e.code));
window.addEventListener('resize',clearKeys);
window.addEventListener('blur',()=>{clearKeys();if(!online&&['countdown','racing'].includes(race.phase))pause();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){clearKeys();if(!online&&['countdown','racing'].includes(race.phase))pause();}});

function minimap(){const c=ui.minimap;if(!c)return;const ctx=c.getContext('2d'),w=c.width,h=c.height;ctx.clearRect(0,0,w,h);ctx.lineCap='round';ctx.lineJoin='round';const bounds=track.bounds??{centerX:0,centerZ:0,width:220,depth:185};const scale=Math.min((w-28)/bounds.width,(h-24)/bounds.depth);const sx=x=>w/2+(x-bounds.centerX)*scale,sz=z=>h/2+(z-bounds.centerZ)*scale;
  ctx.beginPath();track.points.forEach((p,i)=>i?ctx.lineTo(sx(p.x),sz(p.z)):ctx.moveTo(sx(p.x),sz(p.z)));ctx.closePath();ctx.strokeStyle='rgba(18,60,72,.13)';ctx.lineWidth=13;ctx.stroke();ctx.strokeStyle='#fff8de';ctx.lineWidth=7;ctx.stroke();
  for(const r of [...race.racers].reverse()){const p=track.sample(r.distance),self=r.id===race.player.id;ctx.beginPath();ctx.arc(sx(p.x),sz(p.z),self?5:3,0,Math.PI*2);ctx.fillStyle=self?'#f4a746':r.color??'#53a99e';ctx.fill();if(self){ctx.strokeStyle='#153e49';ctx.lineWidth=2;ctx.stroke();}}
}
function finish(){if(showedResults)return;showedResults=true;const key=track.id===DEFAULT_TRACK_ID?`sunny-best-v2-${Math.round(track.length)}-${selection.character}-${selection.difficulty}`:`sunny-best-v3-${track.id}-${selection.character}-${selection.difficulty}`;let best=null;try{best=Number(localStorage.getItem(key))||null;if(race.player.finishTime&&(!best||race.player.finishTime<best)){best=race.player.finishTime;localStorage.setItem(key,String(best));}}catch{}
  ui.showResults(race.results,best);audio.event({type:'results'});
}
async function boot(){try{
  worldReady=loadWorld();await worldReady;
  let last=performance.now(),accumulator=0;
  function frame(now){const dt=Math.min((now-last)/1000,.05);last=now;
    if(!online&&ui.mobile.blocked&&!settings.isOpen&&['countdown','racing'].includes(race.phase)){rotationPaused=true;race.pause();ui.setPaused(true);clearKeys();}
    else if(rotationPaused&&!ui.mobile.blocked&&!settings.isOpen&&!document.hidden){rotationPaused=false;if(race.phase==='paused'){race.resume();ui.setPaused(false);}}
    const input=readInput();network.update(now,input);
    if(online){if(race.phase==='racing'&&!race.player.finished){predictPlayer(dt,input);for(const r of race.racers)if(r.id!==race.player.id){r.distance+=r.speed*dt;r.offset+=(r.lateralVelocity||0)*dt;}}if(race.phase==='racing')race.elapsed+=dt;}
    else{accumulator+=dt;while(accumulator>=1/60){race.update(1/60,input);accumulator-=1/60;}}
    for(const e of race.consumeEvents()){audio.event(e);if(e.type==='finish'&&online&&e.racerId===race.player.id)ui.showToast('你已冲线！等待其他车手完成比赛');else if(!['countdown','go','drift','finish','results'].includes(e.type))ui.showToast(e.text);}
    ui.update(race);ui.updateCourse(race.player.distance);if(race.phase==='countdown')ui.showCountdown(String(Math.ceil(race.countdown)));else ui.showCountdown('');
    if(race.phase==='finished')finish();
    minimap();audio.update(race.player.speed,race.phase==='racing');world.update(dt,race,race.phase==='menu');requestAnimationFrame(frame);
  }requestAnimationFrame(frame);
}catch(error){console.error(error);document.querySelector('#app').innerHTML='<div style="position:absolute;inset:20%;padding:40px;background:#fff8dc;border-radius:24px;color:#153e49;font:20px sans-serif">游戏暂时未能启动。请使用 Chrome / Edge 并开启硬件加速，重新加载页面。<br><button onclick="location.reload()">重新加载</button></div>';}}
boot();
