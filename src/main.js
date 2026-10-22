import './style.css';
import './mobile.css';
import './settings.css';
import './courses.css';
import './browser-gestures.css';
import './keyboard.css';
import './pickups.css';
import './time-trial.css';
import './items.css';
import { track as defaultTrack, createTrack, TRACK_CATALOG, DEFAULT_TRACK_ID } from './game/track.js';
import { Race } from './game/race.js';
import { UI } from './ui.js';
import { Network } from './network.js';
import { AudioEngine } from './audio.js';
import { PHYSICS } from './game/physics.js';
import { drivingInput } from './input.js';
import { GameSettings } from './settings.js';
import { CoursePicker } from './course-picker.js';
import { installBrowserGuards } from './browser-gestures.js';
import { actionForKey } from './keyboard-bindings.js';
import { Minimap } from './minimap.js';
import { PickupFeedback } from './pickup-feedback.js';
import { GhostStore, GhostRecorder, ghostPoseAt, ghostKey } from './ghost.js';
import { TimeTrialUI } from './time-trial.js';
import { RaceModePicker } from './race-mode-picker.js';
import { ItemHUD } from './item-hud.js';

const trackCache=new Map([[DEFAULT_TRACK_ID,defaultTrack]]);
function getTrack(id){if(!trackCache.has(id))trackCache.set(id,createTrack(id));return trackCache.get(id);}
let initialTrackId=DEFAULT_TRACK_ID;
try{const remembered=localStorage.getItem('sunny-course-v1');if(TRACK_CATALOG.some(course=>course.id===remembered))initialTrackId=remembered;}catch{}
let track=getTrack(initialTrackId);
let race=new Race(track),world,settings,coursePicker,worldGeneration=0,worldLoading=false,worldReady=Promise.resolve(),settingsResume=false,online=false,showedResults=false,rotationPaused=false,selection={character:'fox',difficulty:'normal',trackId:track.id,mode:'race'};
const keys=new Set(),audio=new AudioEngine();
let pendingItemPress=false;
let recorder=null,ghostRecording=null,trialMeta=null,trialUI,pickupFeedback,minimapView;
const ghostStore=new GhostStore({onError:message=>ui.showToast(message)}),sessionGhosts=new Map();
let mute=false;try{mute=localStorage.getItem('sunny-muted')==='true';}catch{}
audio.setMuted(mute);
const clearKeys=()=>{keys.clear();pendingItemPress=false;ui.clearTouch();};
function pause(){if(!['racing','countdown'].includes(race.phase))return;if(online){ui.showToast('联机比赛持续进行，退出可返回大厅');return;}race.pause();ui.setPaused(true);clearKeys();}
function resume(){race.resume();ui.setPaused(false);audio.unlock();}
function resetTrial(){recorder=null;ghostRecording=null;trialMeta=null;trialUI?.reset();world?.updateGhost(null);pickupFeedback?.reset();}
function mainMenu(){network.leave();online=false;rotationPaused=false;ui.setOnline(false);clearKeys();resetTrial();selection.mode=modePicker.mode;race=new Race(track,selection);showedResults=false;ui.showMenu();world?.setLineup?.(race.racers);}
function start(options=selection){if(worldLoading)return;network.leave();online=false;rotationPaused=false;ui.setOnline(false);resetTrial();selection={...selection,...options};race=new Race(track,selection);race.start();showedResults=false;ui.setPaused(false);ui.enterRace?.();clearKeys();audio.unlock();world?.setLineup?.(race.racers);if(selection.mode==='time-trial')beginTrial();}
const ui=new UI({
  onStart:options=>start({...options,mode:modePicker.mode}),onPause:pause,onResume:resume,
  onInputModeChange:()=>{keys.clear();pendingItemPress=false;},
  onItemPress:()=>{if(race.phase==='racing'&&!settings?.isOpen&&!ui.mobile.blocked)pendingItemPress=true;},
  onOverview:active=>{if(world)world.overview=active;},
  onAutoThrottleChange:active=>settings?.setValues({autoThrottle:active},{notify:false}),
  onCharacterChange:character=>{selection.character=character;if(race.phase==='menu'){race=new Race(track,selection);world?.setLineup?.(race.racers);}},
  onRestart:()=>{if(online){if(network.room?.hostId===network.id)network.start();else ui.showToast('等待房主开始下一场比赛');return;}start(selection);},onMenu:mainMenu,
  onMute:()=>{mute=!mute;audio.unlock();audio.setMuted(mute);ui.setMuted(mute);try{localStorage.setItem('sunny-muted',String(mute));}catch{}},
  onCreateRoom:options=>{resetTrial();selection={...selection,...(options||{}),mode:modePicker.mode};audio.unlock();network.create(selection.character,selection.difficulty,track.id,selection.mode).catch(e=>ui.showToast(e.message));},
  onJoinRoom:(code,options)=>{resetTrial();selection={...selection,...(options||{}),mode:'race'};audio.unlock();network.join(code,selection.character).catch(e=>ui.showToast(e.message));},
  onLeaveRoom:mainMenu,onStartRoom:()=>{audio.unlock();network.start();},
});
const modePicker=new RaceModePicker(ui.root,{onChange:mode=>{selection.mode=mode;ui.raceMode=mode;race=new Race(track,selection);clearKeys();world?.setLineup?.(race.racers);}});
const itemHUD=new ItemHUD(ui.root);
minimapView=new Minimap(ui.minimap);
pickupFeedback=new PickupFeedback(ui.root);
trialUI=new TimeTrialUI(ui.root,{onStart:()=>start({character:ui.character,difficulty:ui.difficulty,mode:'time-trial'})});
trialUI.setBusy(true);
coursePicker=new CoursePicker(document.querySelector('#app'),{onSelect:id=>selectCourse(id,true)});
coursePicker.setSelected(track.id);coursePicker.setBusy(true);ui.setCourse(track);
ui.setMuted(mute);
installBrowserGuards();
function applySettings(values){ui.autoThrottleChosen=true;ui.setAutoThrottle(values.autoThrottle,false);ui.setControlLayout(values.controlLayout);ui.clearTouch();audio.setVolume(values.soundVolume);world?.setGraphicsQuality(values.graphics);}
settings=new GameSettings(document.querySelector('#app'),{
  defaults:{autoThrottle:ui.mobile.inputMode==='touch'},onChange:applySettings,
  onOpen:()=>{ui.settingsOpen=true;clearKeys();settingsResume=!online&&['racing','countdown'].includes(race.phase);if(settingsResume){race.pause();ui.setPaused(true);}},
  onClose:()=>{ui.settingsOpen=false;clearKeys();if(settingsResume&&race.phase==='paused'){if(ui.mobile.blocked)rotationPaused=true;else resume();}settingsResume=false;},
  onBindingsChange:bindings=>{clearKeys();ui.setKeyBindings(bindings);itemHUD.setBindings(bindings);},
});
ui.setKeyBindings(settings.bindings);
itemHUD.setBindings(settings.bindings);
settings.setInputMode(ui.root.dataset.inputMode);
ui.root.addEventListener('inputmodechange',()=>{clearKeys();settings.setInputMode(ui.root.dataset.inputMode);});
applySettings(settings.values);
const network=new Network({
  status:state=>ui.setNetwork(state),
  room:room=>{if(room.status==='lobby'){selection.mode=room.mode||'race';modePicker.setMode(selection.mode);selectCourse(room.trackId||DEFAULT_TRACK_ID,false);ui.showLobby(room);}},
  started:(state,id)=>{resetTrial();selectCourse(state.trackId||network.room?.trackId||DEFAULT_TRACK_ID,false);online=true;showedResults=false;race=new Race(track,{...selection,mode:state.mode||network.room?.mode||'race',multiplayer:true,localPlayerId:id});race.applySnapshot(state,id);selection={character:race.player.character,difficulty:network.room?.difficulty??selection.difficulty,trackId:track.id,mode:race.mode};modePicker.setMode(race.mode);clearKeys();ui.setPaused(false);ui.enterRace?.();ui.setOnline(true);world?.setLineup?.(race.racers);},
  snapshot:(state,tick,meta={})=>{if(!online)return;race.applySnapshot(state,network.id);
    if(race.phase==='racing'&&!race.player.finished)for(const command of network.pendingInputs(meta.ack,meta.receivedAt))predictPlayer(command.duration,command.input);
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
  const generation=++worldGeneration;worldLoading=true;coursePicker.setBusy(true);trialUI.setBusy(true);ui.setLoading(.1);
  let ready=false;
  try{
    const {World}=await import('./world.js');if(generation!==worldGeneration)return;
    world?.dispose();const next=new World(document.querySelector('#game'),track);world=next;
    next.setGraphicsQuality(settings.values.graphics);ui.setLoading(.55);
    await next.createKarts({progressive:true});if(generation!==worldGeneration)return;
    next.setLineup(race.racers);ui.setLoading(1);ui.setCourse(track);ready=true;
  }finally{if(generation===worldGeneration){worldLoading=false;coursePicker.setBusy(false);trialUI.setBusy(!ready);}}
}

function beginTrial(){
  trialMeta={trackId:track.id,trackLength:track.length,character:selection.character,laps:race.laps};
  const saved=ghostStore.load(trialMeta),session=sessionGhosts.get(ghostKey(trialMeta));
  ghostRecording=session&&(!saved||session.time<saved.time)?session:saved;
  recorder=new GhostRecorder(trialMeta);recorder.record(0,race.player);trialUI.begin(trialMeta,ghostRecording);
}
function finishTrial(){
  const recording=recorder?.finish(race);
  const saveResult=recording?ghostStore.save(recording):{saved:false,reason:'invalid'};
  const previous=sessionGhosts.get(ghostKey(trialMeta));
  if(recording&&(!previous||recording.time<previous.time))sessionGhosts.set(ghostKey(trialMeta),recording);
  const best=Math.min(...[saveResult.best?.time,ghostRecording?.time,recording?.time].filter(Number.isFinite));
  ui.showResults(race.results,Number.isFinite(best)?best:null);trialUI.finish({race,saveResult});world?.updateGhost(null);audio.event({type:'results'});
}

function predictPlayer(duration,input){
  const eventCount=race.events.length;
  while(duration>0){const step=Math.min(PHYSICS.fixedStep,duration);race.stepRacer(race.player,input,step,{prediction:true});duration-=step;}
  // Effects and awards are presented only when confirmed by the server.
  race.events.length=eventCount;
}

function readInput(){const blocked=ui.mobile.blocked||settings.isOpen;const input=drivingInput(keys,ui.touchState,ui.autoThrottle,{bindings:settings.bindings,sensitivity:settings.values.steeringSensitivity,blocked});if(!blocked&&pendingItemPress)input.useItem=true;return input;}
window.addEventListener('keydown',event=>{
  if(settings.isOpen||ui.mobile.blocked)return;
  if(event.isComposing||event.key==='Process'||event.keyCode===229||event.ctrlKey||event.metaKey||event.altKey){keys.clear();pendingItemPress=false;return;}
  if(event.target?.closest?.('input,textarea,select,[contenteditable="true"],.courses-overlay,.help-overlay,.lobby-overlay'))return;
  const action=actionForKey(settings.bindings,event.code);if(!action)return;
  if(race.phase!=='menu')event.preventDefault();
  if(!event.repeat&&action==='pause'){if(race.phase==='paused')resume();else if(['racing','countdown'].includes(race.phase))pause();}
  if(!event.repeat&&action==='restart'&&!online&&race.phase!=='menu')start(selection);
  if(!event.repeat&&action==='autoThrottle')ui.setAutoThrottle?.(!ui.autoThrottle);
  if(!event.repeat&&action==='useItem'&&race.phase==='racing')pendingItemPress=true;
  keys.add(event.code);
});
window.addEventListener('keyup',e=>keys.delete(e.code));
window.addEventListener('resize',clearKeys);
window.addEventListener('blur',()=>{clearKeys();if(!online&&['countdown','racing'].includes(race.phase))pause();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){clearKeys();if(!online&&['countdown','racing'].includes(race.phase))pause();}});

function finish(){if(showedResults)return;showedResults=true;if(race.mode==='time-trial'){finishTrial();return;}const key=race.mode==='items'?`sunny-best-items-v1-${track.id}-${selection.character}-${selection.difficulty}`:track.id===DEFAULT_TRACK_ID?`sunny-best-v2-${Math.round(track.length)}-${selection.character}-${selection.difficulty}`:`sunny-best-v3-${track.id}-${selection.character}-${selection.difficulty}`;let best=null;try{best=Number(localStorage.getItem(key))||null;if(race.player.finishTime&&(!best||race.player.finishTime<best)){best=race.player.finishTime;localStorage.setItem(key,String(best));}}catch{}
  ui.showResults(race.results,best);audio.event({type:'results'});
}
async function boot(){try{
  worldReady=loadWorld();await worldReady;
  let last=performance.now(),accumulator=0;
  function frame(now){const rawFrameMs=now-last,dt=Math.min(rawFrameMs/1000,.05);last=now;
    if(!online&&ui.mobile.blocked&&!settings.isOpen&&['countdown','racing'].includes(race.phase)){rotationPaused=true;race.pause();ui.setPaused(true);clearKeys();}
    else if(rotationPaused&&!ui.mobile.blocked&&!settings.isOpen&&!document.hidden){rotationPaused=false;if(race.phase==='paused'){race.resume();ui.setPaused(false);}}
    const input=readInput();network.update(now,input);
    if(online){pendingItemPress=false;if(race.phase==='racing'&&!race.player.finished)predictPlayer(dt,input);if(race.phase==='racing')race.elapsed+=dt;
      for(const pose of network.remoteRacers(now)){const racer=race.racers.find(r=>r.id===pose.id);if(racer&&racer.id!==race.player.id)for(const key of ['distance','offset','speed','yaw','lateralVelocity','yawRate'])if(Number.isFinite(pose[key]))racer[key]=pose[key];}
    }
    else{accumulator+=dt;while(accumulator>=1/60){race.update(1/60,input);pendingItemPress=false;accumulator-=1/60;}}
    for(const e of race.consumeEvents()){if(e.racerId&&e.racerId!==race.player.id)continue;audio.event(e);pickupFeedback.event(e);if(e.type==='finish'&&online&&e.racerId===race.player.id)ui.showToast('你已冲线！等待其他车手完成比赛');else if(e.text&&!['countdown','go','drift','finish','results'].includes(e.type))ui.showToast(e.text);}
    ui.update(race);itemHUD.update(race);ui.updateCourse(race.player.distance);if(race.phase==='countdown')ui.showCountdown(String(Math.ceil(race.countdown)));else ui.showCountdown('');
    if(recorder&&['racing','finished'].includes(race.phase))recorder.record(race.elapsed,race.player);
    if(race.mode==='time-trial'){trialUI.update(race,ghostRecording);const pose=ghostRecording&&['countdown','racing','paused'].includes(race.phase)?ghostPoseAt(ghostRecording,race.elapsed):null;world?.updateGhost(pose?{...pose,character:selection.character}:null);}
    if(race.phase==='finished')finish();
    pickupFeedback.update(race);minimapView.update(track,race,now);audio.update(race.player.speed,race.phase==='racing');if(world&&!world.disposed)world.update(dt,race,race.phase==='menu',rawFrameMs);requestAnimationFrame(frame);
  }requestAnimationFrame(frame);
}catch(error){console.error(error);document.querySelector('#app').innerHTML='<div style="position:absolute;inset:20%;padding:40px;background:#fff8dc;border-radius:24px;color:#153e49;font:20px sans-serif">游戏暂时未能启动。请使用 Chrome / Edge 并开启硬件加速，重新加载页面。<br><button onclick="location.reload()">重新加载</button></div>';}}
boot();

// Rare-state fixtures are available only to the dedicated Vite E2E process.
// Vite eliminates this block from production builds; it never changes awards.
if(import.meta.env.DEV&&import.meta.env.VITE_E2E==='1'){
  window.__SUNNY_KART_TEST__=Object.freeze({
    state:()=>structuredClone({
      race:{phase:race.phase,elapsed:race.elapsed,laps:race.laps,mode:race.mode,player:race.player,racers:race.racers,itemObjects:race.itemObjects},
      track:{id:track.id,length:track.length,coins:track.coins,items:race.itemBoxes},
      world:{crystals:world?.crystals?.map(c=>({id:c.item.id,visible:c.mesh.visible})),items:world?.itemVisuals?.map(c=>({id:c.item.id,visible:c.mesh.visible})),pickupEffects:world?.particles?.length??0,ghostVisible:Boolean(world?.ghost?.visible),frameStats:world?.frameStats},
      trial:{active:trialUI.active,hasGhost:Boolean(ghostRecording),recordingValid:recorder?!recorder.invalid:null},
    }),
    setPose:pose=>{
      if(online||race.phase!=='racing')throw new Error('E2E fixture requires an active local race');
      for(const key of ['distance','offset','speed','yaw','yawRate','lateralVelocity'])if(Number.isFinite(pose[key]))race.player[key]=pose[key];
    },
  });
}
