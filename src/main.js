import './style.css';
import { track } from './game/track.js';
import { Race } from './game/race.js';
import { World } from './world.js';
import { UI } from './ui.js';
import { Network } from './network.js';
import { AudioEngine } from './audio.js';
import { PHYSICS } from './game/physics.js';
import { drivingInput } from './input.js';

let race=new Race(track),world,online=false,showedResults=false,selection={character:'fox',difficulty:'normal'};
const keys=new Set(),audio=new AudioEngine();
let mute=false;try{mute=localStorage.getItem('sunny-muted')==='true';}catch{}
audio.setMuted(mute);
const clearKeys=()=>{keys.clear();if(ui.touchState)for(const key of Object.keys(ui.touchState))ui.touchState[key]=false;};
function pause(){if(!['racing','countdown'].includes(race.phase))return;if(online){ui.showToast('联机比赛持续进行，退出可返回大厅');return;}race.pause();ui.setPaused(true);clearKeys();}
function resume(){race.resume();ui.setPaused(false);audio.unlock();}
function mainMenu(){network.leave();online=false;ui.setOnline(false);clearKeys();race=new Race(track,selection);showedResults=false;ui.showMenu();world?.setLineup?.(race.racers);}
function start(options=selection){network.leave();online=false;ui.setOnline(false);selection={...selection,...options};race=new Race(track,selection);race.start();showedResults=false;ui.setPaused(false);ui.enterRace?.();clearKeys();audio.unlock();world?.setLineup?.(race.racers);}
const ui=new UI({
  onStart:start,onPause:pause,onResume:resume,
  onOverview:active=>{if(world)world.overview=active;},
  onCharacterChange:character=>{selection.character=character;if(race.phase==='menu'){race=new Race(track,selection);world?.setLineup?.(race.racers);}},
  onRestart:()=>{if(online){if(network.room?.hostId===network.id)network.start();else ui.showToast('等待房主开始下一场比赛');return;}start(selection);},onMenu:mainMenu,
  onMute:()=>{mute=!mute;audio.unlock();audio.setMuted(mute);ui.setMuted(mute);try{localStorage.setItem('sunny-muted',String(mute));}catch{}},
  onCreateRoom:options=>{selection={...selection,...(options||{})};audio.unlock();network.create(selection.character,selection.difficulty).catch(e=>ui.showToast(e.message));},
  onJoinRoom:(code,options)=>{selection={...selection,...(options||{})};audio.unlock();network.join(code,selection.character).catch(e=>ui.showToast(e.message));},
  onLeaveRoom:mainMenu,onStartRoom:()=>{audio.unlock();network.start();},
});
ui.setMuted(mute);
const network=new Network({
  status:state=>ui.setNetwork(state),
  room:room=>{if(room.status==='lobby')ui.showLobby(room);},
  started:(state,id)=>{online=true;showedResults=false;race=new Race(track,{...selection,multiplayer:true,localPlayerId:id});race.applySnapshot(state,id);selection={character:race.player.character,difficulty:network.room?.difficulty??selection.difficulty};clearKeys();ui.setPaused(false);ui.enterRace?.();ui.setOnline(true);world?.setLineup?.(race.racers);},
  snapshot:state=>{if(!online)return;race.applySnapshot(state,network.id);
    // Prediction starts from the authoritative state and accounts for roughly one-way latency.
    if(race.phase==='racing'&&!race.player.finished)predictPlayer(Math.min(.12,network.ping/2000),readInput());
  },
  error:message=>ui.showToast(message),
  disconnected:()=>{mainMenu();ui.showToast('联机连接已断开，请重新创建或加入房间');},
});

function predictPlayer(duration,input){
  const eventCount=race.events.length;
  while(duration>0){const step=Math.min(PHYSICS.fixedStep,duration);race.stepRacer(race.player,input,step);duration-=step;}
  // Effects and awards are presented only when confirmed by the server.
  race.events.length=eventCount;
}

function readInput(){return drivingInput(keys,ui.touchState,ui.autoThrottle);}
window.addEventListener('keydown',event=>{
  if(event.target instanceof HTMLInputElement)return;
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','Tab'].includes(event.code)&&race.phase!=='menu')event.preventDefault();
  if(!event.repeat&&event.code==='Escape'){if(race.phase==='paused')resume();else if(['racing','countdown'].includes(race.phase))pause();}
  if(!event.repeat&&event.code==='KeyR'&&!online&&race.phase!=='menu')start(selection);
  if(!event.repeat&&event.code==='KeyQ')ui.setAutoThrottle?.(!ui.autoThrottle);
  keys.add(event.code);
});
window.addEventListener('keyup',e=>keys.delete(e.code));
window.addEventListener('blur',()=>{clearKeys();if(!online&&['countdown','racing'].includes(race.phase))pause();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){clearKeys();if(!online&&['countdown','racing'].includes(race.phase))pause();}});

function minimap(){const c=ui.minimap;if(!c)return;const ctx=c.getContext('2d'),w=c.width,h=c.height;ctx.clearRect(0,0,w,h);ctx.lineCap='round';ctx.lineJoin='round';const bounds=track.bounds??{centerX:0,centerZ:0,width:220,depth:185};const scale=Math.min((w-28)/bounds.width,(h-24)/bounds.depth);const sx=x=>w/2+(x-bounds.centerX)*scale,sz=z=>h/2+(z-bounds.centerZ)*scale;
  ctx.beginPath();track.points.forEach((p,i)=>i?ctx.lineTo(sx(p.x),sz(p.z)):ctx.moveTo(sx(p.x),sz(p.z)));ctx.closePath();ctx.strokeStyle='rgba(18,60,72,.13)';ctx.lineWidth=13;ctx.stroke();ctx.strokeStyle='#fff8de';ctx.lineWidth=7;ctx.stroke();
  for(const r of [...race.racers].reverse()){const p=track.sample(r.distance),self=r.id===race.player.id;ctx.beginPath();ctx.arc(sx(p.x),sz(p.z),self?5:3,0,Math.PI*2);ctx.fillStyle=self?'#f4a746':r.color??'#53a99e';ctx.fill();if(self){ctx.strokeStyle='#153e49';ctx.lineWidth=2;ctx.stroke();}}
}
function finish(){if(showedResults)return;showedResults=true;const key=`sunny-best-v2-${Math.round(track.length)}-${selection.character}-${selection.difficulty}`;let best=null;try{best=Number(localStorage.getItem(key))||null;if(race.player.finishTime&&(!best||race.player.finishTime<best)){best=race.player.finishTime;localStorage.setItem(key,String(best));}}catch{}
  ui.showResults(race.results,best);audio.event({type:'results'});
}
async function boot(){try{
  ui.setLoading(.1);world=new World(document.querySelector('#game'),track);ui.setLoading(.55);await world.createKarts();await world.setLineup?.(race.racers);ui.setLoading(1);ui.setCourse(track);
  let last=performance.now(),accumulator=0;
  function frame(now){const dt=Math.min((now-last)/1000,.05);last=now;const input=readInput();network.update(now,input);
    if(online){if(race.phase==='racing'&&!race.player.finished){predictPlayer(dt,input);for(const r of race.racers)if(r.id!==race.player.id){r.distance+=r.speed*dt;r.offset+=(r.lateralVelocity||0)*dt;}}if(race.phase==='racing')race.elapsed+=dt;}
    else{accumulator+=dt;while(accumulator>=1/60){race.update(1/60,input);accumulator-=1/60;}}
    for(const e of race.consumeEvents()){audio.event(e);if(e.type==='finish'&&online&&e.racerId===race.player.id)ui.showToast('你已冲线！等待其他车手完成比赛');else if(!['countdown','go','drift','finish','results'].includes(e.type))ui.showToast(e.text);}
    ui.update(race);ui.updateCourse(race.player.distance);if(race.phase==='countdown')ui.showCountdown(String(Math.ceil(race.countdown)));else ui.showCountdown('');
    if(race.phase==='finished')finish();
    minimap();audio.update(race.player.speed,race.phase==='racing');world.update(dt,race,race.phase==='menu');requestAnimationFrame(frame);
  }requestAnimationFrame(frame);
}catch(error){console.error(error);document.querySelector('#app').innerHTML='<div style="position:absolute;inset:20%;padding:40px;background:#fff8dc;border-radius:24px;color:#153e49;font:20px sans-serif">游戏暂时未能启动。请使用 Chrome / Edge 并开启硬件加速，重新加载页面。<br><button onclick="location.reload()">重新加载</button></div>';}}
boot();
