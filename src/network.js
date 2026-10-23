import { resolveServerUrl, healthUrl } from './server-url.js';
import { InputHistory, SnapshotBuffer, LocalPoseCorrection } from './net-sync.js';
import { PROTOCOL_VERSION, UPDATE_MESSAGE, isRaceMode, isCompatibleServer } from './game/protocol.js';

export class Network {
  constructor(callbacks={}) {
    this.callbacks=callbacks;this.socket=null;this.id=null;this.room=null;this.ping=0;
    this.history=new InputHistory();this.snapshots=new SnapshotBuffer();this.resumeToken=null;this.reconnectTimer=null;this.reconnectDeadline=0;this.manualLeave=false;
    this.sequence=0;this.lastInput=0;this.lastPing=0;this.roomGeneration=0;
    this.itemUseSeq=0;this.itemHeld=false;this.itemRequireRelease=false;
    this.roundId=null;this.activeRoomCode=null;this.eventIds=new Set();this.localCorrection=new LocalPoseCorrection();
  }
  connect() {
    if(this.connecting)return this.connecting;
    if(this.socket?.readyState===WebSocket.OPEN&&this.id)return Promise.resolve();
    const configured=import.meta.env?.VITE_SERVER_URL||'';
    let endpoint;
    try {endpoint=resolveServerUrl({configured,location:globalThis.location,development:Boolean(import.meta.env?.DEV)});}
    catch(error){this.callbacks.status?.({connected:false,error:error.message});return Promise.reject(error);}
    const url=new URL(endpoint);url.searchParams.set('protocolVersion',String(PROTOCOL_VERSION));
    if(this.reconnecting&&this.resumeToken)url.searchParams.set('resume',this.resumeToken);
    endpoint=url.href;
    const attempt=this.openSocket(endpoint,Boolean(configured)&&!this.reconnecting);
    this.connecting=attempt;
    attempt.catch(()=>{if(this.connecting===attempt)this.connecting=null;});
    return attempt;
  }
  async openSocket(endpoint,wake) {
    const unavailable='联机服务暂时无法连接，请稍后重试';
    if(wake) {
      this.callbacks.status?.({connected:false,message:'正在连接服务器，首次启动可能需要一分钟'});
      const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),75000);
      try {const response=await fetch(healthUrl(endpoint),{signal:controller.signal,cache:'no-store'});if(!response.ok)throw new Error(unavailable);}
      catch {this.callbacks.status?.({connected:false,error:unavailable});throw new Error(unavailable);}
      finally {clearTimeout(timer);}
    }
    return new Promise((resolve,reject)=>{
      const socket=new WebSocket(endpoint);this.socket=socket;let welcomed=false, failure=null;
      const timer=setTimeout(()=>{if(!welcomed){reject(new Error(unavailable));socket.close();}},15000);
      const fail=()=>{clearTimeout(timer);this.callbacks.status?.({connected:false,error:unavailable});reject(new Error(unavailable));};
      socket.addEventListener('open',()=>this.callbacks.status?.({connected:false,message:'连接已建立，正在同步身份…'}));
      socket.addEventListener('message',event=>{
        if(this.socket!==socket)return;
        try {
          const message=JSON.parse(event.data);
          if(message.type==='resumeRejected'||message.type==='protocolMismatch'||(message.type==='welcome'&&!isCompatibleServer(message))){
            failure=new Error(message.type==='resumeRejected'?message.message:UPDATE_MESSAGE);
            clearTimeout(timer);this.reconnectDeadline=0;this.resumeToken=null;this.reconnecting=false;
            const hadRoom=Boolean(this.room);this.room=null;this.id=null;this.itemRequireRelease=true;
            this.callbacks.status?.({connected:false,error:failure.message});
            if(hadRoom)this.callbacks.disconnected?.();
            reject(failure);socket.close(4004,'Version or resume unavailable');return;
          }
          this.message(message);
          if(message.type==='welcome'){welcomed=true;clearTimeout(timer);this.callbacks.status?.({connected:true,ping:this.ping});resolve();}
        }
        catch(error){console.error('Network message',error);}
      });
      socket.addEventListener('error',fail);
      socket.addEventListener('close',()=>{
        clearTimeout(timer);if(!welcomed)reject(failure??new Error(unavailable));
        if(this.socket!==socket)return;
        this.connecting=null;this.itemHeld=false;this.itemRequireRelease=true;
        if(failure)return;
        if(this.room&&this.resumeToken&&!this.manualLeave){
          if(!this.reconnecting)this.reconnectDeadline=performance.now()+(this.resumeGraceMs||30000);
          this.reconnecting=true;this.scheduleReconnect();
        }else if(!this.reconnecting){this.id=null;const wasInRoom=Boolean(this.room);this.room=null;this.callbacks.status?.({connected:false});if(wasInRoom)this.callbacks.disconnected?.();}
      });
    });
  }
  message(message) {
    if(this.manualLeave&&['room','started','snapshot'].includes(message.type))return;
    if(message.type==='welcome'){this.id=message.id;this.resumeToken=message.resumeToken??null;this.resumeGraceMs=message.resumeGraceMs??30000;this.sequence=Math.max(this.sequence,message.lastSeq??-1);this.serverTracks=Array.isArray(message.trackIds)?message.trackIds:[];this.serverModes=message.modes;this.serverProtocol=message.protocolVersion;this.itemUseSeq=Number.isSafeInteger(message.lastItemUseSeq)?message.lastItemUseSeq:0;this.itemHeld=false;this.itemRequireRelease=Boolean(message.resumed);this.reconnecting=false;clearTimeout(this.reconnectTimer);this.history.clear();this.snapshots.clear();}
    if(message.type==='room'){if(this.room?.code&&message.code!==this.room.code){this.roundId=null;this.activeRoomCode=null;this.eventIds.clear();}this.room=message;if(message.status==='lobby'){this.history.clear();this.snapshots.clear();this.localCorrection.clear();}this.callbacks.room?.({...message,selfId:this.id});}
    if(message.type==='started'){
      if(message.roomCode&&this.room?.code&&message.roomCode!==this.room.code)return;
      if(Number.isSafeInteger(message.roundId)&&this.roundId!==null&&message.roundId<this.roundId)return;
      const sameRound=Number.isSafeInteger(message.roundId)&&message.roundId===this.roundId&&message.roomCode===this.activeRoomCode;
      if(sameRound&&!message.resumed)return;
      this.roundId=message.roundId??null;this.activeRoomCode=message.roomCode??this.room?.code??null;
      this.history.clear();this.snapshots.clear();this.localCorrection.clear();if(!sameRound)this.eventIds.clear();this.lastAck=undefined;
      this.itemUseSeq=message.lastItemUseSeq??message.state?.racers?.find(r=>r.id===this.id)?.lastItemUseSeq??0;this.itemHeld=false;this.itemRequireRelease=Boolean(message.resumed);this.lastInput=0;this.callbacks.started?.(this.confirmedState(message.state),this.id);
    }
    if(message.type==='snapshot'){
      if(this.room?.status==='lobby')return;
      if(message.roomCode&&this.activeRoomCode&&message.roomCode!==this.activeRoomCode)return;
      if(Number.isSafeInteger(message.roundId)&&message.roundId!==this.roundId)return;
      const now=performance.now();if(!this.snapshots.push(message.state,message.tick,now,message.serverTime))return;
      this.lastAck=message.inputAcks?.[this.id];this.callbacks.snapshot?.(this.confirmedState(message.state),message.tick,{ack:this.lastAck,receivedAt:now,serverTime:message.serverTime});
    }
    if(message.type==='pong'){this.ping=Math.max(0,Math.round(performance.now()-message.time));this.callbacks.status?.({connected:true,ping:this.ping});}
    if(message.type==='error')this.callbacks.error?.(message.message);
  }
  confirmedState(state){
    const events=(state.events||[]).filter(event=>{
      if(!event.eventId)return true;
      if(this.eventIds.has(event.eventId))return false;
      this.eventIds.add(event.eventId);return true;
    });
    while(this.eventIds.size>1024)this.eventIds.delete(this.eventIds.values().next().value);
    return {...state,events};
  }
  scheduleReconnect(){
    clearTimeout(this.reconnectTimer);
    if(!this.reconnecting)return;
    if(performance.now()>=this.reconnectDeadline){this.reconnecting=false;this.resumeToken=null;this.id=null;this.room=null;this.callbacks.status?.({connected:false,error:'重连未成功，请重新加入房间'});this.callbacks.disconnected?.();return;}
    this.callbacks.status?.({connected:false,reconnecting:true,message:'连接中断，正在恢复原比赛…'});
    this.reconnectTimer=setTimeout(()=>{this.connect().catch(()=>{this.connecting=null;this.scheduleReconnect();});},500);
  }
  pendingInputs(ack=this.lastAck,now=performance.now()){return this.history.pending(ack,now);}
  remoteRacers(now=performance.now()){return this.snapshots.sample(now);}
  captureLocalCorrection(before,after,now=performance.now()){this.localCorrection.capture(before,after,now);}
  localRacerPose(racer,now=performance.now()){return this.localCorrection.pose(racer,now);}
  send(message){if(this.socket?.readyState===WebSocket.OPEN)this.socket.send(JSON.stringify(message));}
  driverName(character){return `${{fox:'阿橘',rabbit:'薄荷',panda:'波波'}[character]??'车手'}·${this.id.slice(-3)}`;}
  async create(character='fox',difficulty='normal',trackId='sunny-island',mode='race'){
    this.manualLeave=false;const generation=this.roomGeneration;await this.connect();if(generation!==this.roomGeneration)return;
    if(!isRaceMode(mode)||this.serverProtocol!==PROTOCOL_VERSION||!this.serverModes?.includes(mode))throw new Error(UPDATE_MESSAGE);
    if(!this.serverTracks?.includes(trackId))throw new Error('联机服务正在更新这条赛道，请稍后再试；现在可以先玩单人模式');
    this.send({type:'create',name:this.driverName(character),character,difficulty,trackId,mode,protocolVersion:PROTOCOL_VERSION});
  }
  async join(room,character='fox'){
    this.manualLeave=false;const generation=this.roomGeneration;await this.connect();if(generation!==this.roomGeneration)return;
    this.send({type:'join',room,name:this.driverName(character),character,protocolVersion:PROTOCOL_VERSION});
  }
  start(){if(!isRaceMode(this.room?.mode)||this.serverProtocol!==PROTOCOL_VERSION){this.callbacks.error?.(UPDATE_MESSAGE);return;}this.send({type:'start',roundId:this.room.roundId,protocolVersion:PROTOCOL_VERSION});}
  rematch(){this.start();}
  voteTrack(trackId){this.send({type:'voteTrack',trackId,protocolVersion:PROTOCOL_VERSION});}
  configure(options={}){const fields={};for(const key of ['trackId','mode','difficulty','laps'])if(options[key]!==undefined)fields[key]=options[key];this.send({type:'configure',...fields,protocolVersion:PROTOCOL_VERSION});}
  returnToLobby(){this.send({type:'returnToLobby',protocolVersion:PROTOCOL_VERSION});}
  leave(){this.roomGeneration++;this.manualLeave=true;this.reconnecting=false;clearTimeout(this.reconnectTimer);this.send({type:'leave'});this.room=null;this.roundId=null;this.activeRoomCode=null;this.eventIds.clear();this.localCorrection.clear();this.history.clear();this.snapshots.clear();this.itemUseSeq=0;this.itemHeld=false;this.itemRequireRelease=false;if(this.socket?.readyState!==WebSocket.OPEN)this.socket?.close?.();}
  update(now,input){
    const pressed=Boolean(input?.useItem);
    if(this.socket?.readyState!==WebSocket.OPEN){this.itemHeld=pressed;this.itemRequireRelease=true;return;}
    if(this.room?.status==='racing'){
      if(this.itemRequireRelease){if(!pressed)this.itemRequireRelease=false;}
      else if(pressed&&!this.itemHeld)this.itemUseSeq++;
      this.itemHeld=pressed;
      if(now-this.lastInput>1000/30){const seq=++this.sequence,command={...input,useItem:pressed,itemUseSeq:this.itemUseSeq};this.send({type:'input',input:command,seq,roundId:this.roundId,protocolVersion:PROTOCOL_VERSION});this.history.push(seq,command,now);this.lastInput=now;}
    }else this.itemHeld=pressed;
    if(now-this.lastPing>1500){this.send({type:'ping',time:now});this.lastPing=now;}
  }
}
