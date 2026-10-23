import test from 'node:test';
import assert from 'node:assert/strict';
import { Career, Cup, DrivingLesson, CAREER_KEY, CUP_KEY, CUP_TRACKS, raceHighlights } from '../src/career.js';
import { createTrack } from '../src/game/track.js';
import { Race } from '../src/game/race.js';

const memory = () => ({ values:new Map(), writes:0, getItem(key){return this.values.get(key)??null;},setItem(key,value){this.writes++;this.values.set(key,value);},removeItem(key){this.values.delete(key);} });
const results = () => Array.from({length:8},(_,i)=>({id:i?`ai-${i}`:'player',name:i?`对手 ${i}`:'阿橘',character:'fox',position:i+1}));
const completeRace = (mode='race') => {
  const race=new Race(createTrack(),{mode});race.phase='finished';
  Object.assign(race.player,{finished:true,finishTime:120,distance:race.track.length*race.laps,lapTimes:[40,40,40]});
  return race;
};

test('cup resumes the next round with the same scores without writing during load',()=>{
  const storage=memory(),cup=new Cup({mode:'items',character:'rabbit',difficulty:'hard'},storage);
  cup.save();const first=results();assert.equal(cup.record(first),true);assert.equal(cup.record(first),false,'same result object cannot score twice');
  assert.equal(cup.record(results()),true,'a later race may legitimately have identical finishing positions');
  const before=storage.writes,loaded=Cup.load(storage);
  assert.equal(storage.writes,before);assert.equal(loaded.round,2);assert.equal(loaded.trackId,CUP_TRACKS[2]);
  assert.deepEqual(loaded.options,cup.options);assert.deepEqual(loaded.standings(),cup.standings());
  assert.equal(loaded.record(results()),true);assert.equal(loaded.record(results()),true);
  assert.equal(loaded.complete,true);assert.equal(loaded.playerPosition,1);assert.equal(loaded.standings()[0].points,40);
  assert.equal(loaded.record(results()),false);assert.equal(Cup.load(storage).complete,true);
});

test('corrupt cup saves are rejected without throwing or overwriting the original data',()=>{
  const storage=memory(),options={mode:'race',character:'fox',difficulty:'normal'};
  for(const saved of [null,{}, {schema:1,options:null,rounds:[]},{schema:1,options,rounds:[results(),null]},{schema:1,options,rounds:[results(),[null,...results().slice(1)]]}]){
    const serialized=JSON.stringify(saved);storage.setItem(CUP_KEY,serialized);const before=storage.writes;
    assert.equal(Cup.load(storage),null);assert.equal(storage.writes,before);assert.equal(storage.getItem(CUP_KEY),serialized);
  }
  storage.setItem(CUP_KEY,'{ broken');assert.equal(Cup.load(storage),null);
  const cup=new Cup(null,storage);for(const bad of [null,[],[null,...results().slice(1)],results().map(r=>({...r,position:1})),results().map(r=>({...r,id:'player'}))])assert.equal(cup.record(bad),false);
  assert.equal(cup.round,0);assert.deepEqual(cup.scores,[]);
});

test('challenges require a positive complete race and exclude lessons and incomplete results',()=>{
  const career=new Career(memory()),race=completeRace();
  race.player.stats.driftBoosts=5;
  assert.deepEqual(career.finish(race,{practice:true}),[]);assert.equal(career.badges.size,0);
  race.options.practice=true;assert.deepEqual(career.finish(race),[]);delete race.options.practice;
  const awards=career.finish(race).map(a=>a.id);
  assert.deepEqual(awards,['first-finish','drift-five','clean-finish']);assert.deepEqual(career.finish(race),[]);
  for(const mutate of [r=>r.player.finishTime=0,r=>r.player.finishTime=-1,r=>r.player.distance=10,r=>r.player.lapTimes=[40,40],r=>r.player.lapTimes=[0,0,120],r=>r.player.lapTimes=[10,10,10],r=>r.phase='racing']){
    const bad=completeRace();mutate(bad);assert.deepEqual(new Career(memory()).finish(bad),[]);
  }
  const touched=completeRace();touched.player.stats.collisions=1;
  assert.deepEqual(new Career(memory()).finish(touched).map(a=>a.id),['first-finish'],'collision counters override an inconsistent clean flag');
});

test('personal-best reward needs an older ghost and cosmetic locks survive malformed storage',()=>{
  const storage=memory();storage.setItem(CAREER_KEY,JSON.stringify({badges:['unknown'],paint:'violet',trail:'gold',title:'晴空杯车手',tutorialDone:'false'}));
  const career=new Career(storage);assert.deepEqual(career.cosmetics,{paint:null,trail:null,title:''});assert.equal(career.tutorialDone,false);
  assert.equal(career.choose({paint:'violet'}),false);assert.equal(career.choose({trail:'gold'}),false);assert.equal(career.choose({title:'晴空杯车手'}),false);
  career.finish(completeRace('time-trial'),{personalBest:true,hadGhost:false});assert.equal(career.badges.has('personal-best'),false);
  career.finish(completeRace('time-trial'),{personalBest:true,hadGhost:true});assert.equal(career.choose({paint:'mint',trail:'gold'}),true);
  career.award(['cup-podium']);assert.equal(career.choose({title:'晴空杯车手'}),true);
  assert.deepEqual(new Career(storage).cosmetics,{paint:'#65cfb0',trail:'#ffcf68',title:'晴空杯车手'});
  const blocked={getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');}};
  const session=new Career(blocked);assert.doesNotThrow(()=>session.finish(completeRace()));assert.equal(session.persisted,false);assert.equal(session.badges.has('first-finish'),true);assert.equal(Cup.load(blocked),null);
});

test('lesson teaches braking then steering, a real drift release and straight nitro without awarding a race',()=>{
  const lesson=new DrivingLesson(),race=new Race(createTrack(),{mode:'time-trial'});race.phase='racing';race.player.speed=20;
  lesson.update(race,{steer:.5});assert.equal(lesson.stage,0);
  lesson.update(race,{brake:1,steer:.5});assert.equal(lesson.stage,0,'brake first, release, then turn');
  lesson.update(race,{brake:0,steer:.5});assert.equal(lesson.stage,1);
  lesson.update(race,{});assert.equal(lesson.stage,1);
  race.player.stats.driftBoosts++;lesson.update(race,{});assert.equal(lesson.stage,2);
  race.player.nitroActive=true;lesson.update(race,{steer:.6});assert.equal(lesson.done,false);
  race.player.yaw=0;lesson.update(race,{steer:0});assert.equal(lesson.done,true);assert.equal(lesson.stage,3);
  assert.equal(race.phase,'racing','finishing a lesson leaves free practice available');
  assert.equal(raceHighlights({player:{stats:{bestDrift:.84}}}).includes('完美蓄力 · 漂移高手'),false);
  assert.equal(raceHighlights({player:{stats:{bestDrift:.85}}}).includes('完美蓄力 · 漂移高手'),true);
});
