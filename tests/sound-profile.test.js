import test from 'node:test';
import assert from 'node:assert/strict';
import { collisionProfile, CollisionLimiter } from '../src/sound-profile.js';
test('collision sounds stay short and quiet even with extreme impact values',()=>{
  for(const impact of [undefined,0,.7,3,20,100000,NaN]){
    const p=collisionProfile(impact);
    assert.ok(p.duration>=.065&&p.duration<=.121);
    assert.ok(p.noiseGain<=.14&&p.bodyGain<=.141);
    assert.ok(p.frequency<=135&&p.cutoff<=1180);
  }
  assert.ok(collisionProfile(8).bodyGain>collisionProfile(1).bodyGain);
});
test('continuous rail rubbing and simultaneous impacts cannot flood audio voices',()=>{
  const limiter=new CollisionLimiter();let count=0;
  for(let frame=0;frame<120;frame++)for(let contact=0;contact<7;contact++)if(limiter.take(frame/120,2))count++;
  assert.ok(count>=3&&count<=5,`${count} sounds from 840 impact callbacks`);
  assert.ok(limiter.take(2,5),'a later distinct collision is still audible');
});
