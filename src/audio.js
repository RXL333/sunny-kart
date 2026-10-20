// Small original synthesised score and engine, no downloaded audio or audio trackers.
export class AudioEngine {
  constructor(){this.muted=false;this.ctx=null;this.nextNote=0;this.noteIndex=0;}
  unlock(){
    if(!this.ctx){const Ctx=window.AudioContext||window.webkitAudioContext;if(!Ctx)return;this.ctx=new Ctx();this.master=this.ctx.createGain();this.master.gain.value=.2;this.master.connect(this.ctx.destination);
      this.engine=this.ctx.createOscillator();this.engine.type='triangle';this.engineGain=this.ctx.createGain();this.engineGain.gain.value=0;this.engine.connect(this.engineGain).connect(this.master);this.engine.start();}
    this.ctx.resume();
  }
  setMuted(value){this.muted=value;if(this.master)this.master.gain.setTargetAtTime(value?0:.2,this.ctx.currentTime,.05);}
  tone(frequency,duration=.12,type='sine',volume=.2,slide){if(!this.ctx||this.muted)return;const t=this.ctx.currentTime,o=this.ctx.createOscillator(),g=this.ctx.createGain();o.type=type;o.frequency.setValueAtTime(frequency,t);if(slide)o.frequency.exponentialRampToValueAtTime(slide,t+duration);g.gain.setValueAtTime(volume,t);g.gain.exponentialRampToValueAtTime(.001,t+duration);o.connect(g).connect(this.master);o.start(t);o.stop(t+duration);}
  event(e){if(e.type==='countdown')this.tone(480,.12,'sine',.3);if(e.type==='go')this.tone(960,.4,'sine',.3);if(e.type==='driftBoost'||e.type==='boost')this.tone(350,.4,'triangle',.18,1100);if(e.type==='energy')this.tone(1500,.15,'sine',.17);if(e.type==='bump')this.tone(80,.12,'triangle',.25);if(e.type==='results'){[523,659,784,1047].forEach((n,i)=>setTimeout(()=>this.tone(n,.3,'triangle',.3),i*140));}}
  update(speed,racing){if(!this.ctx)return;const t=this.ctx.currentTime;this.engine.frequency.setTargetAtTime(58+speed*3.2,t,.1);this.engineGain.gain.setTargetAtTime(racing?.035:0,t,.1);
    if(racing&&t>this.nextNote){const melody=[72,76,79,76,74,77,81,77,72,76,79,84,81,79,76,74];this.tone(440*Math.pow(2,(melody[this.noteIndex++%melody.length]-69)/12),.17,'sine',.055);this.nextNote=t+.29;}
  }
}
