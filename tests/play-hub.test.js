import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { Career, Cup, DrivingLesson } from '../src/career.js';
import { PlayHub } from '../src/play-hub.js';
import { Race } from '../src/game/race.js';
import { createTrack } from '../src/game/track.js';

function setup(t,callbacks={}){
  const window=new Window({url:'http://localhost/'}),document=window.document,previous=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'document',{configurable:true,writable:true,value:document});
  const root=document.createElement('div');root.innerHTML='<footer class="menu-footer"></footer><section class="results-dialog"><div class="result-list"></div><button class="restart-button"><span>再来</span></button></section><div class="race-hud"></div>';document.body.append(root);
  const career=new Career(window.localStorage),hub=new PlayHub(root,career,callbacks);
  t.after(()=>{if(previous)Object.defineProperty(globalThis,'document',previous);else delete globalThis.document;window.close();});
  return {window,root,career,hub};
}

test('item cup selection survives rerender and busy state blocks start actions',t=>{
  const calls=[],{window,hub}=setup(t,{onCup:value=>calls.push(value)});hub.open();
  const select=hub.content.querySelector('[name="cup-mode"]');select.value='items';select.dispatchEvent(new window.Event('change',{bubbles:true}));
  assert.equal(hub.content.querySelector('[name="cup-mode"]').value,'items');
  hub.setBusy(true);hub.content.querySelector('[data-hub-action="cup"]').dispatchEvent(new window.Event('click',{bubbles:true}));assert.equal(calls.length,0);
  hub.setBusy(false);assert.equal(hub.content.querySelector('[name="cup-mode"]').value,'items');
  hub.content.querySelector('[data-hub-action="cup"]').click();assert.deepEqual(calls,[{mode:'items'}]);assert.equal(hub.overlay.hidden,true);
});

test('resume cup uses the career storage and garage changes enforce locks and notify cosmetics',t=>{
  const calls=[],{career,hub}=setup(t,{onCosmetics:value=>calls.push(value)}),cup=new Cup({mode:'items'},career.storage);
  cup.record(Array.from({length:8},(_,i)=>({id:i?`ai-${i}`:'player',position:i+1,name:'搭档'})));
  hub.open();assert.match(hub.content.querySelector('[data-hub-action="resume-cup"]').textContent,/第 2 \/ 4 场/);
  hub.tab='garage';hub.render();assert.equal(hub.content.querySelector('[data-paint="mint"]').disabled,true);
  career.award(['first-finish']);hub.render();hub.content.querySelector('[data-paint="mint"]').click();
  assert.equal(career.paint,'mint');assert.equal(calls.length,1);assert.equal(calls[0].paint,'#65cfb0');
  assert.equal(hub.content.querySelector('[data-paint="mint"]').getAttribute('aria-pressed'),'true');
});

test('lesson supports custom desktop bindings, touch wording and exiting without lingering race prompts',t=>{
  let exits=0;const {root,hub}=setup(t,{onExitLesson:()=>exits++}),race=new Race(createTrack(),{mode:'time-trial'}),lesson=new DrivingLesson();race.phase='racing';
  hub.update(race,{lesson,inputMode:'keyboard',bindings:{throttle:['KeyI'],brake:['KeyK'],left:['KeyJ'],right:['KeyL'],drift:['KeyU'],nitro:['KeyO']}});
  assert.equal(hub.lessonPanel.hidden,false);assert.match(hub.lessonPanel.textContent,/I/);assert.match(hub.lessonPanel.textContent,/K/);assert.match(hub.lessonPanel.textContent,/J \/ L/);
  lesson.stage=1;hub.update(race,{lesson,inputMode:'keyboard',bindings:{drift:['KeyU']}});assert.match(hub.lessonPanel.textContent,/U/);
  hub.update(race,{lesson,inputMode:'touch'});assert.match(hub.lessonPanel.textContent,/漂移/);assert.doesNotMatch(hub.lessonPanel.textContent,/未设置/);
  lesson.stage=3;lesson.done=true;hub.update(race,{lesson,inputMode:'touch'});assert.match(hub.lessonPanel.textContent,/练习完成/);
  hub.lessonPanel.querySelector('.lesson-exit').click();assert.equal(exits,1);
  race.phase='menu';hub.update(race);assert.equal(hub.lessonPanel.hidden,true);assert.equal(root.classList.contains('in-lesson'),false);assert.equal(hub.driveFeedback.hidden,true);assert.equal(hub.warning.hidden,true);
});

test('empty sprint feedback and escaped result highlights remain truthful and safe',t=>{
  const {root,hub}=setup(t),race=new Race(createTrack('bay-loop'));
  const zone=race.track.strategyZones.find(z=>z.kind==='sprint');race.phase='racing';Object.assign(race.player,{distance:zone.start+5,offset:zone.lane,nitro:0});
  hub.update(race);assert.match(hub.driveFeedback.textContent,/氮气不足/);assert.doesNotMatch(hub.driveFeedback.textContent,/车速更快/);
  race.player.nitro=.01;race.player.strategyActive=false;hub.update(race);assert.doesNotMatch(hub.driveFeedback.textContent,/车速更快/);
  race.player.strategyActive=true;hub.update(race);assert.match(hub.driveFeedback.textContent,/车速更快/);
  const cup=new Cup();cup.record(Array.from({length:8},(_,i)=>({id:i?`ai-${i}`:'player',position:i+1,name:'<img src=x onerror=alert(1)>'})));
  hub.showResults(race,cup,[{name:'<script>bad()</script>'}]);
  assert.equal(hub.results.querySelector('img'),null);assert.equal(hub.results.querySelector('script'),null);assert.match(hub.results.textContent,/<img/);assert.match(root.querySelector('.restart-button').textContent,/下一站/);
});
