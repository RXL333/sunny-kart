import { resolveServerUrl, healthUrl } from './server-url.js';

export class Network {
  constructor(callbacks={}) {
    this.callbacks=callbacks;this.socket=null;this.id=null;this.room=null;this.ping=0;
    this.sequence=0;this.lastInput=0;this.lastPing=0;this.roomGeneration=0;
  }
  connect() {
    if(this.connecting)return this.connecting;
    if(this.socket?.readyState===WebSocket.OPEN&&this.id)return Promise.resolve();
    const configured=import.meta.env?.VITE_SERVER_URL||'';
    let endpoint;
    try {endpoint=resolveServerUrl({configured,location:globalThis.location,development:Boolean(import.meta.env?.DEV)});}
    catch(error){this.callbacks.status?.({connected:false,error:error.message});return Promise.reject(error);}
    const attempt=this.openSocket(endpoint,Boolean(configured));
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
      const socket=new WebSocket(endpoint);this.socket=socket;let welcomed=false;
      const timer=setTimeout(()=>{if(!welcomed){reject(new Error(unavailable));socket.close();}},15000);
      const fail=()=>{clearTimeout(timer);this.callbacks.status?.({connected:false,error:unavailable});reject(new Error(unavailable));};
      socket.addEventListener('open',()=>this.callbacks.status?.({connected:false,message:'连接已建立，正在同步身份…'}));
      socket.addEventListener('message',event=>{
        try {const message=JSON.parse(event.data);this.message(message);if(message.type==='welcome'){welcomed=true;clearTimeout(timer);this.callbacks.status?.({connected:true,ping:this.ping});resolve();}}
        catch(error){console.error('Network message',error);}
      });
      socket.addEventListener('error',fail);
      socket.addEventListener('close',()=>{
        clearTimeout(timer);if(!welcomed)reject(new Error(unavailable));
        if(this.socket!==socket)return;
        this.connecting=null;this.id=null;const wasInRoom=Boolean(this.room);this.room=null;
        this.callbacks.status?.({connected:false});if(wasInRoom)this.callbacks.disconnected?.();
      });
    });
  }
  message(message) {
    if(message.type==='welcome'){this.id=message.id;this.serverTracks=Array.isArray(message.trackIds)?message.trackIds:['sunny-island'];}
    if(message.type==='room'){this.room=message;this.callbacks.room?.({...message,selfId:this.id});}
    if(message.type==='started')this.callbacks.started?.(message.state,this.id);
    if(message.type==='snapshot')this.callbacks.snapshot?.(message.state,message.tick);
    if(message.type==='pong'){this.ping=Math.max(0,Math.round(performance.now()-message.time));this.callbacks.status?.({connected:true,ping:this.ping});}
    if(message.type==='error')this.callbacks.error?.(message.message);
  }
  send(message){if(this.socket?.readyState===WebSocket.OPEN)this.socket.send(JSON.stringify(message));}
  driverName(character){return `${{fox:'阿橘',rabbit:'薄荷',panda:'波波'}[character]??'车手'}·${this.id.slice(-3)}`;}
  async create(character='fox',difficulty='normal',trackId='sunny-island'){
    const generation=this.roomGeneration;await this.connect();if(generation!==this.roomGeneration)return;
    if(!this.serverTracks?.includes(trackId))throw new Error('联机服务正在更新这条赛道，请稍后再试；现在可以先玩单人模式');
    this.send({type:'create',name:this.driverName(character),character,difficulty,trackId});
  }
  async join(room,character='fox'){
    const generation=this.roomGeneration;await this.connect();if(generation!==this.roomGeneration)return;
    this.send({type:'join',room,name:this.driverName(character),character,protocolVersion:3});
  }
  start(){this.send({type:'start'});}
  leave(){this.roomGeneration++;this.send({type:'leave'});this.room=null;}
  update(now,input){if(this.socket?.readyState!==WebSocket.OPEN)return;
    if(this.room?.status==='racing'&&now-this.lastInput>1000/30){this.send({type:'input',input,seq:++this.sequence});this.lastInput=now;}
    if(now-this.lastPing>1500){this.send({type:'ping',time:now});this.lastPing=now;}
  }
}
