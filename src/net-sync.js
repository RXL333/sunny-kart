const mix=(a,b,t)=>a+(b-a)*t;

// Only unacknowledged commands are replayed, with a bounded horizon after a stall.
export class InputHistory {
  constructor(limit=120){this.limit=limit;this.commands=[];}
  push(seq,input,time){this.commands.push({seq,input:{...input},time});if(this.commands.length>this.limit)this.commands.splice(0,this.commands.length-this.limit);}
  clear(){this.commands.length=0;}
  pending(ack,now){
    if(Number.isFinite(ack))this.commands=this.commands.filter(command=>command.seq>ack);
    let remaining=.25;
    return this.commands.map((command,index)=>{
      const end=this.commands[index+1]?.time??now;
      const duration=Math.max(0,Math.min(.1,remaining,(end-command.time)/1000));remaining-=duration;
      return {...command,duration};
    }).filter(command=>command.duration>0);
  }
}

export class SnapshotBuffer {
  constructor({delay=100,limit=30}={}){this.delay=delay;this.limit=limit;this.frames=[];}
  clear(){this.frames.length=0;}
  push(state,tick,time){
    if(this.frames.length&&tick<=this.frames.at(-1).tick)return false;
    this.frames.push({state,tick,time});if(this.frames.length>this.limit)this.frames.shift();return true;
  }
  sample(now){
    if(!this.frames.length)return [];
    const target=now-this.delay;
    while(this.frames.length>2&&this.frames[1].time<=target)this.frames.shift();
    const a=this.frames[0],b=this.frames[1]??a;
    const t=a===b?0:Math.max(0,Math.min(1,(target-a.time)/Math.max(1,b.time-a.time)));
    // Never extrapolate indefinitely when the network stops delivering snapshots.
    return a.state.racers.map(r=>{
      const next=b.state.racers.find(other=>other.id===r.id);if(!next)return {...r};
      const result={...r};for(const key of ['distance','offset','speed','lateralVelocity','yawRate'])if(Number.isFinite(r[key])&&Number.isFinite(next[key]))result[key]=mix(r[key],next[key],t);
      if(Number.isFinite(r.yaw)&&Number.isFinite(next.yaw)){const delta=Math.atan2(Math.sin(next.yaw-r.yaw),Math.cos(next.yaw-r.yaw));result.yaw=r.yaw+delta*t;}
      return result;
    });
  }
}
