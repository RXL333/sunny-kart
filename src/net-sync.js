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
  constructor({delay=100,limit=30}={}){this.delay=delay;this.limit=limit;this.frames=[];this.clear();}
  clear(){this.frames.length=0;this.clockOffset=null;this.lastReceipt=null;this.presented=new Map();this.recoveryFrom=null;}
  push(state,tick,time,serverTime){
    if(this.frames.length&&tick<=this.frames.at(-1).tick)return false;
    if(this.lastReceipt!==null&&time-this.lastReceipt>350&&this.presented.size){this.recoveryFrom=new Map(this.presented);this.recoveryAt=time;}
    this.lastReceipt=time;
    let timeline=time;
    if(Number.isFinite(serverTime)){
      const observedOffset=time-serverTime;
      // Packet arrival jitter must not change the time between server frames.
      // Drift the clock slowly toward longer paths, immediately toward faster ones.
      this.clockOffset=this.clockOffset===null?observedOffset:Math.min(this.clockOffset+.2,observedOffset);
      timeline=serverTime+this.clockOffset;
    }
    timeline=Math.max(timeline,(this.frames.at(-1)?.time??-Infinity)+.001);
    this.frames.push({state,tick,time:timeline});if(this.frames.length>this.limit)this.frames.shift();return true;
  }
  sample(now){
    if(!this.frames.length)return [];
    const target=now-this.delay;
    while(this.frames.length>2&&this.frames[1].time<=target)this.frames.shift();
    const a=this.frames[0],b=this.frames[1]??a;
    const t=a===b?0:Math.max(0,Math.min(1,(target-a.time)/Math.max(1,b.time-a.time)));
    // Never extrapolate indefinitely when the network stops delivering snapshots.
    const poses=a.state.racers.map(r=>{
      const next=b.state.racers.find(other=>other.id===r.id);if(!next)return {...r};
      const result={...r};for(const key of ['distance','offset','speed','lateralVelocity','yawRate'])if(Number.isFinite(r[key])&&Number.isFinite(next[key]))result[key]=mix(r[key],next[key],t);
      if(Number.isFinite(r.yaw)&&Number.isFinite(next.yaw)){const delta=Math.atan2(Math.sin(next.yaw-r.yaw),Math.cos(next.yaw-r.yaw));result.yaw=r.yaw+delta*t;}
      return result;
    });
    const recovery=this.recoveryFrom?Math.max(0,Math.min(1,(now-this.recoveryAt)/180)):1;
    for(const pose of poses){
      const from=this.recoveryFrom?.get(pose.id);
      if(from&&recovery<1){
        for(const key of ['distance','offset'])if(Number.isFinite(from[key])&&Number.isFinite(pose[key]))pose[key]=mix(from[key],pose[key],recovery);
        if(Number.isFinite(from.yaw)&&Number.isFinite(pose.yaw))pose.yaw=from.yaw+Math.atan2(Math.sin(pose.yaw-from.yaw),Math.cos(pose.yaw-from.yaw))*recovery;
      }
      this.presented.set(pose.id,{...pose});
    }
    if(recovery===1)this.recoveryFrom=null;
    return poses;
  }
}

// Presentation only: the authority and input replay retain their exact poses.
// Large corrections (respawns, changed tracks) snap rather than drawing a car
// through scenery; routine small corrections fade away over a few frames.
export class LocalPoseCorrection {
  constructor(duration=160){this.duration=duration;this.clear();}
  clear(){this.error=null;this.startedAt=0;}
  capture(before,after,now){
    if(!before||!after){this.clear();return;}
    const visible=this.pose(before,now),distance=visible.distance-after.distance,offset=visible.offset-after.offset;
    const yaw=Math.atan2(Math.sin((visible.yaw||0)-(after.yaw||0)),Math.cos((visible.yaw||0)-(after.yaw||0)));
    if(!Number.isFinite(distance)||!Number.isFinite(offset)||Math.abs(distance)>8||Math.abs(offset)>3||Math.abs(yaw)>.7){this.clear();return;}
    this.error={distance,offset,yaw};this.startedAt=now;
  }
  pose(racer,now){
    if(!this.error)return racer;
    const weight=Math.max(0,1-(now-this.startedAt)/this.duration)**2;
    if(!weight){this.clear();return racer;}
    return {...racer,distance:racer.distance+this.error.distance*weight,offset:racer.offset+this.error.offset*weight,yaw:(racer.yaw||0)+this.error.yaw*weight};
  }
}
