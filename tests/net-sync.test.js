import test from 'node:test';
import assert from 'node:assert/strict';
import { InputHistory,SnapshotBuffer,LocalPoseCorrection } from '../src/net-sync.js';

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

test('server time keeps remote frame spacing stable when packets arrive in a burst', () => {
 const buffer = new SnapshotBuffer({ delay: 0 });
 const state = distance => ({ racers: [{ id: 'peer', distance, offset: 0 }] });
 buffer.push(state(0), 1, 1000, 100);
 buffer.push(state(10), 2, 1100, 150);
 buffer.push(state(20), 3, 1101, 200);
 const times = buffer.frames.map(frame => frame.time);
 assert.ok(times[1] - times[0] >= 50 && times[1] - times[0] < 51);
 assert.ok(times[2] - times[1] >= 50 && times[2] - times[1] < 51);
 assert.ok(Math.abs(buffer.sample((times[0] + times[1]) / 2)[0].distance - 5) < .001);
});

test('remote recovery fades from the last displayed pose and still ends at the latest authority', () => {
 const buffer = new SnapshotBuffer({ delay: 0 });
 const state = distance => ({ racers: [{ id: 'peer', distance, offset: 0, yaw: 0 }] });
 buffer.push(state(0), 1, 0); buffer.push(state(2), 2, 100);
 assert.equal(buffer.sample(100)[0].distance, 2);
 buffer.push(state(10), 3, 600);
 assert.equal(buffer.sample(600)[0].distance, 2);
 assert.equal(buffer.sample(690)[0].distance, 6);
 assert.equal(buffer.sample(780)[0].distance, 10);
});

test('local reconciliation smooths only display, preserves continuity on a second correction and snaps large changes', () => {
 const correction = new LocalPoseCorrection(160);
 const before = { id: 'seat', distance: 20, offset: 1, yaw: 3.1, speed: 30 };
 const after = { ...before, distance: 22, offset: 2, yaw: -3.1 };
 correction.capture(before, after, 1000);
 const displayed = correction.pose(after, 1000);
 assert.equal(displayed.distance, before.distance); assert.equal(displayed.offset, before.offset);
 assert.ok(Math.abs(Math.atan2(Math.sin(displayed.yaw - before.yaw), Math.cos(displayed.yaw - before.yaw))) < .001);
 assert.equal(after.distance, 22, 'authoritative physics remains untouched');
 const mid = correction.pose(after, 1080);
 assert.equal(mid.distance, 21.5);
 const newer = { ...after, distance: 23 };
 correction.capture(after, newer, 1080);
 assert.equal(correction.pose(newer, 1080).distance, mid.distance, 'frequent reconciliations do not introduce a new jump');
 assert.equal(correction.pose(newer, 1240), newer);
 correction.capture(newer, { ...newer, distance: 200 }, 1300);
 assert.equal(correction.error, null, 'a changed track or respawn does not draw the car through scenery');
});
