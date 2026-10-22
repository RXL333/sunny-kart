import test from 'node:test';
import assert from 'node:assert/strict';
import { InputHistory,SnapshotBuffer } from '../src/net-sync.js';

test('input reconciliation discards acknowledged inputs and bounds replay after stalls',()=>{
 const history=new InputHistory(5);
 for(let i=1;i<=8;i++)history.push(i,{throttle:i%2,steer:i/10},i*34);
 assert.equal(history.commands.length,5);
 const pending=history.pending(5,300);
 assert.deepEqual(pending.map(c=>c.seq),[6,7,8]);
 assert.ok(pending.every(c=>c.duration>0&&c.duration<=.1));
 assert.equal(pending[0].input.steer,.6);
 assert.ok(history.pending(0,30000).reduce((sum,c)=>sum+c.duration,0)<=.25);
 assert.deepEqual(history.pending(8,400),[]);
});

test('remote buffer interpolates jittered frames, ignores old ticks and holds during outages',()=>{
 const buffer=new SnapshotBuffer({delay:100});
 const state=(distance,yaw=0)=>({racers:[{id:'peer',distance,offset:2,speed:20,yaw}]});
 buffer.push(state(0,3.1),1,0);buffer.push(state(2,-3.1),2,100);buffer.push(state(5),3,250);
 assert.equal(buffer.push(state(100),2,260),false);
 const halfway=buffer.sample(150)[0];
 assert.equal(halfway.distance,1);assert.ok(Math.abs(halfway.yaw)>3);
 assert.equal(buffer.sample(300)[0].distance,4);
 assert.equal(buffer.sample(10000)[0].distance,5);
 buffer.clear();assert.deepEqual(buffer.sample(10000),[]);
});
