// Small original synthesised score and engine, no downloaded audio or audio trackers.
import { CollisionLimiter } from './sound-profile.js';
export class AudioEngine {
  constructor(){this.muted=false;this.volume=1;this.ctx=null;this.nextNote=0;this.noteIndex=0;this.collisions=new CollisionLimiter();}
  unlock(){
    if(!this.ctx){const Ctx=window.AudioContext||window.webkitAudioContext;if(!Ctx)return;this.ctx=new Ctx();this.master=this.ctx.createGain();this.master.gain.value=this.muted?0:.2*this.volume;const limiter=this.ctx.createDynamicsCompressor();limiter.threshold.value=-18;limiter.knee.value=18;limiter.ratio.value=4;limiter.attack.value=.005;limiter.release.value=.12;this.master.connect(limiter).connect(this.ctx.destination);
      this.engine=this.ctx.createOscillator();this.engine.type='triangle';this.engineGain=this.ctx.createGain();this.engineGain.gain.value=0;this.engine.connect(this.engineGain).connect(this.master);this.engine.start();}
    this.ctx.resume();
  }
  setMuted(value){this.muted=value;this.applyVolume();}
  setVolume(value){this.volume=Math.max(0,Math.min(1,Number(value)||0));this.applyVolume();}
  applyVolume(){if(this.master)this.master.gain.setTargetAtTime(this.muted?0:.2*this.volume,this.ctx.currentTime,.05);}
  tone(frequency,duration=.12,type='sine',volume=.2,slide){if(!this.ctx||this.muted)return;const t=this.ctx.currentTime,o=this.ctx.createOscillator(),g=this.ctx.createGain();o.type=type;o.frequency.setValueAtTime(frequency,t);if(slide)o.frequency.exponentialRampToValueAtTime(slide,t+duration);g.gain.setValueAtTime(volume,t);g.gain.exponentialRampToValueAtTime(.001,t+duration);o.connect(g).connect(this.master);o.start(t);o.stop(t+duration);}
  collision(impact){
    if(!this.ctx||this.muted)return;
    const t=this.ctx.currentTime,p=this.collisions.take(t,impact);if(!p)return;
    const buffer=this.ctx.createBuffer(1,Math.ceil(this.ctx.sampleRate*p.duration),this.ctx.sampleRate),data=buffer.getChannelData(0);
    let seed=7891;for(let i=0;i<data.length;i++){seed=(seed*1664525+1013904223)>>>0;data[i]=(seed/4294967296)*2-1;}
    const noise=this.ctx.createBufferSource(),filter=this.ctx.createBiquadFilter(),noiseGain=this.ctx.createGain();noise.buffer=buffer;filter.type='lowpass';filter.frequency.value=p.cutoff;filter.Q.value=.55;
    noiseGain.gain.setValueAtTime(.0001,t);noiseGain.gain.linearRampToValueAtTime(p.noiseGain,t+.004);noiseGain.gain.exponentialRampToValueAtTime(.0001,t+p.duration);
    noise.connect(filter).connect(noiseGain).connect(this.master);noise.start(t);noise.stop(t+p.duration);
    const body=this.ctx.createOscillator(),bodyGain=this.ctx.createGain();body.type='sine';body.frequency.setValueAtTime(p.frequency,t);body.frequency.exponentialRampToValueAtTime(48,t+p.duration);
    bodyGain.gain.setValueAtTime(.0001,t);bodyGain.gain.linearRampToValueAtTime(p.bodyGain,t+.003);bodyGain.gain.exponentialRampToValueAtTime(.0001,t+p.duration);
    body.connect(bodyGain).connect(this.master);body.start(t);body.stop(t+p.duration);
  }
  event(e){
    if(e.type==='driftStage')this.tone([0,640,800,1040][e.stage]||640,.11,'sine',.075);
    if(e.type==='draftBoost')this.tone(430,.3,'triangle',.12,1150);
    if(e.type==='itemConfirm')this.tone(e.outcome==='blocked'?480:1100,.13,'sine',.12,e.outcome==='blocked'?340:1450);
    if(e.type==='countdown')this.tone(480,.12,'sine',.3);if(e.type==='go')this.tone(960,.4,'sine',.3);if(e.type==='driftBoost'||e.type==='boost')this.tone(350,.4,'triangle',.18,900+(e.stage||1)*130);if(e.type==='energy')this.tone(1500,.15,'sine',.17);if(e.type==='item')this.tone(850,.18,'sine',.14,1250);if(e.type==='itemUse')this.tone(e.itemType==='shield'?520:e.itemType==='magnet'?750:330,.28,'triangle',.14,e.itemType==='rocket'?1400:1000);if(e.type==='itemHit')this.tone(320,.18,'sine',.1,170);if(e.type==='shieldBlock')this.tone(700,.22,'sine',.15,350);if(e.type==='bump')this.collision(e.impact);if(e.type==='results'){[523,659,784,1047].forEach((n,i)=>setTimeout(()=>this.tone(n,.3,'triangle',.3),i*140));}}
  update(speed,racing){if(!this.ctx)return;const t=this.ctx.currentTime;this.engine.frequency.setTargetAtTime(58+speed*3.2,t,.1);this.engineGain.gain.setTargetAtTime(racing?.035:0,t,.1);
    if(racing&&t>this.nextNote){const melody=[72,76,79,76,74,77,81,77,72,76,79,84,81,79,76,74];this.tone(440*Math.pow(2,(melody[this.noteIndex++%melody.length]-69)/12),.17,'sine',.055);this.nextNote=t+.29;}
  }
}
