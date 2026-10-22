import test from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveQuality } from '../src/performance.js';
import { ModelCache } from '../src/model-cache.js';

test('automatic quality responds to sustained frame cost and recovers with hysteresis',()=>{
  const q=new AdaptiveQuality();
  for(let i=0;i<30;i++)q.sample(1/30);
  assert.equal(q.level,0,'one loading spike must not reduce quality');
  for(let i=0;i<180;i++)q.sample(1/30);
  assert.equal(q.level,2);assert.equal(q.particleLimit,32);
  for(let i=0;i<300;i++)q.sample(1/60);
  assert.equal(q.level,2,'short recovery must not oscillate the resolution');
  for(let i=0;i<1000;i++)q.sample(1/60);
  assert.equal(q.level,0);assert.ok(q.averageMs<18);
  q.sample(5);assert.equal(q.level,0,'background-tab delay is ignored');
});

test('model cache coalesces overlapping scene loads and retries failed assets',async()=>{
  let loads=0,release;
  const cache=new ModelCache(()=>{loads++;return new Promise(resolve=>release=resolve);});
  const a=cache.get('/'),b=cache.get('/');assert.equal(a,b);
  await Promise.resolve();assert.equal(loads,1);release({asset:'kart'});
  assert.equal(await a,await b);assert.equal(await cache.get('/'),await a);assert.equal(loads,1);
  let attempts=0;
  const retry=new ModelCache(()=>{if(++attempts===1)throw new Error('temporary outage');return 'verified';});
  await assert.rejects(retry.get('/'),/temporary outage/);
  assert.equal(await retry.get('/'),'verified');assert.equal(attempts,2);
});
