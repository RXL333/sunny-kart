import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrack, TRACK_CATALOG } from '../src/game/track.js';
import { Race } from '../src/game/race.js';

test('AI can complete every new course while the parked player and collision state remain valid',()=>{
  for(const course of TRACK_CATALOG){
    // Single-player keeps the route running for a parked human; a multiplayer
    // room intentionally ends 30 seconds after its leader, allowing DNFs.
    const track=createTrack(course.id),race=new Race(track,{laps:1});race.start();
    const steps=Math.ceil((track.length/22+55)*60);
    for(let i=0;i<steps;i++)race.update(1/60,{});
    assert.ok(race.racers.filter(r=>!race.humanIds.has(r.id)).every(r=>r.finished),`${course.id} AI finishes the full route`);
    assert.equal(race.player.finished,false);
    assert.ok(race.racers.every(r=>Number.isFinite(r.distance)&&Number.isFinite(r.offset)&&Number.isFinite(r.speed)));
    assert.ok(race.racers.some(r=>r.personality==='drifter'&&r.stats.driftBoosts>0),`${course.id} drift personality uses earned drift boosts`);
    assert.ok(race.racers.filter(r=>r.personality==='steady').every(r=>r.stats.driftBoosts===0),`${course.id} steady personality keeps its stable line`);
    assert.equal(race.snapshot().trackId,course.id);
  }
});
