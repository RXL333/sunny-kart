import test from 'node:test';
import assert from 'node:assert/strict';
import {AudioEngine} from '../src/audio.js';
test('volume changes preserve mute and unmuting restores the chosen volume',()=>{
  const audio=new AudioEngine(),gains=[];audio.ctx={currentTime:5};audio.master={gain:{setTargetAtTime:value=>gains.push(value)}};
  audio.setVolume(.5);assert.equal(gains.at(-1),.1);
  audio.setMuted(true);audio.setVolume(1);assert.equal(gains.at(-1),0);
  audio.setMuted(false);assert.equal(gains.at(-1),.2);
  audio.setVolume(0);audio.setMuted(true);audio.setMuted(false);assert.equal(gains.at(-1),0);
});
