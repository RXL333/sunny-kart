import test from 'node:test';
import assert from 'node:assert/strict';
import { DRIFT_STAGE_COLORS, driftStageColor, kartSparkColor, normalizeCosmetics } from '../src/kart-effects.js';
import { DRIFT_STAGES } from '../src/game/race.js';

test('drift stages remain readable even when cosmetic trails are equipped', () => {
  for (let stage = 0; stage <= 3; stage++) {
    assert.equal(kartSparkColor({ isDrifting: true, driftStage: stage, nitroActive: true }, { trail: '#ff1122' }), DRIFT_STAGE_COLORS[stage]);
  }
  assert.equal(driftStageColor({ driftCharge: .9 }), DRIFT_STAGE_COLORS[3]);
  assert.equal(kartSparkColor({ nitroActive: true }, { trail: '#ff1122' }), 0xff1122);
  assert.equal(kartSparkColor({ draftBoost: .5 }, { trail: '#65cfb0' }), 0x65cfb0);
  assert.equal(kartSparkColor({ rocket: 1 }, { trail: '#ff1122' }), 0xff995f, 'item identity retains its own rocket colour');
  for (const { stage, threshold } of DRIFT_STAGES) {
    assert.equal(driftStageColor({ driftCharge: threshold - .0001 }), DRIFT_STAGE_COLORS[stage - 1], 'effects never announce a drift reward early');
    assert.equal(driftStageColor({ driftCharge: threshold }), DRIFT_STAGE_COLORS[stage]);
  }
});

test('cosmetics accept explicit colours and restore the original style with null', () => {
  assert.deepEqual(normalizeCosmetics({ paint: '#65CFb0', trail: '#ffcf68', title: '晴空车手' }), { paint: '#65cfb0', trail: '#ffcf68' });
  assert.deepEqual(normalizeCosmetics(null), { paint: null, trail: null });
  assert.deepEqual(normalizeCosmetics({ paint: 'url(example)', trail: '#xyzxyz' }), { paint: null, trail: null });
  assert.deepEqual(normalizeCosmetics({title:'晴空杯车手'}),{paint:null,trail:null,title:'晴空杯车手'});
  assert.deepEqual(normalizeCosmetics({title:'<script>alert(1)</script>'}),{paint:null,trail:null});
});
