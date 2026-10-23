import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { UI } from '../src/ui.js';
import { PartyUI } from '../src/party-ui.js';

function fixture(t, callbacks = {}) {
  const window = new Window({ url: 'http://localhost/' });
  window.document.body.innerHTML = '<div id="app"></div>';
  window.document.querySelector('#app').getBoundingClientRect = () => ({ width: 1440, height: 900 });
  const originals = new Map();
  for (const [key, value] of Object.entries({ window, document: window.document, navigator: window.navigator, innerWidth: 1440, innerHeight: 900 })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const ui = new UI(), party = new PartyUI(ui.root, callbacks);
  t.after(() => {
    ui.mobile.destroy(); ui.touchControls.destroy(); window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  return { ui, party, window };
}

const room = (extra = {}) => ({ code: 'ABC234', hostId: 'host', selfId: 'host', status: 'lobby', mode: 'items', laps: 3,
  trackId: 'sunny-island', nextTrackId: 'bay-loop', roundId: 1,
  players: [{ id: 'host', name: '阿橘', connected: true }, { id: 'guest', name: '薄荷', connected: true }], ...extra });

test('party settings appear only to the host in the lobby and map to supported network options', t => {
  const changes = [], { ui, party, window } = fixture(t, { configure: value => changes.push(value) });
  const data = room(); ui.showLobby(data); party.room(data, 'host');
  assert.equal(party.config.hidden, false); assert.equal(party.panel.hidden, true);
  assert.equal(ui.el('.lobby-overlay').hidden, false); assert.equal(ui.el('.race-hud').hidden, true);
  party.config.querySelector('[name="party-track"]').value = 'bay-loop';
  party.config.querySelector('[name="party-mode"]').value = 'race';
  party.config.querySelector('[name="party-laps"]').value = '1';
  party.config.querySelector('[name="party-difficulty"]').value = 'hard';
  party.config.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.deepEqual(changes, [{ trackId: 'bay-loop', mode: 'race', laps: 1, difficulty: 'hard' }]);
  party.room(data, 'guest'); assert.equal(party.config.hidden, true);
  party.room(room({ status: 'racing' }), 'host'); assert.equal(party.config.hidden, true);
});

test('results retain voting for all seats and rematch permissions follow host transfers', t => {
  const votes = [], actions = [], { ui, party } = fixture(t, { vote: id => votes.push(id), lobby: () => actions.push('lobby') });
  const data = room({ status: 'finished', trackVotes: { guest: 'candy-hills' }, trackVoteCounts: { 'candy-hills': 1 } });
  ui.showResults([{ id: 'guest', name: '薄荷', finished: true, finishTime: 90 }]);
  party.room(data, 'guest');
  assert.equal(party.panel.hidden, false); assert.equal(party.config.hidden, true);
  assert.equal(ui.el('.results-dialog .restart-button').disabled, true);
  assert.equal(party.panel.querySelector('.party-lobby-button').hidden, true);
  assert.equal(party.panel.querySelector('[data-vote-track="candy-hills"]').getAttribute('aria-pressed'), 'true');
  party.panel.querySelector('[data-vote-track="bay-loop"]').click();
  assert.deepEqual(votes, ['bay-loop']);
  party.room({ ...data, hostId: 'guest' }, 'guest');
  assert.equal(ui.el('.results-dialog .restart-button').disabled, false);
  assert.match(ui.el('.results-dialog .restart-button').textContent, /再来一场/);
  assert.equal(party.panel.querySelector('.party-lobby-button').hidden, false);
  party.panel.querySelector('.party-lobby-button').click(); assert.deepEqual(actions, ['lobby']);
  ui.hideOverlays(); ui.showLobby(room({ selfId: 'guest', hostId: 'guest' }));
  party.room(room({ hostId: 'guest' }), 'guest');
  assert.equal(ui.el('.results-overlay').hidden, true); assert.equal(ui.el('.lobby-overlay').hidden, false);
  assert.equal(party.config.hidden, false); assert.equal(party.panel.hidden, true);
});

test('a late joining seat can wait in a completed room and enter the next race without a menu overlap', t => {
  const votes = [], { ui, party } = fixture(t, { vote: id => votes.push(id) });
  ui.openLobby();
  const data = room({ status: 'finished', selfId: 'new-seat' });
  ui.hideOverlays(); ui.showLobby(data); party.room(data, 'new-seat');
  assert.equal(ui.el('.room-entry').hidden, true); assert.equal(ui.el('.room-content').hidden, false);
  assert.equal(ui.el('.lobby-overlay').hidden, false); assert.equal(ui.el('.menu-screen').hidden, true);
  assert.equal(ui.el('.start-room-button').hidden, true);
  assert.equal(party.lobbyVotes.hidden, false);
  party.lobbyVotes.querySelector('[data-vote-track="bay-loop"]').click();
  assert.deepEqual(votes, ['bay-loop']);
  party.room({ ...data, trackVotes: { 'new-seat': 'bay-loop' }, trackVoteCounts: { 'bay-loop': 1 } }, 'new-seat');
  assert.equal(party.lobbyVotes.querySelector('[data-vote-track="bay-loop"]').getAttribute('aria-pressed'), 'true');
  assert.match(party.lobbyVotes.querySelector('[data-vote-track="bay-loop"]').textContent, /1 票/);
  assert.equal(ui.el('.lobby-overlay').hidden, false, 'a vote broadcast preserves the waiting lobby');
  ui.enterRace(); ui.setOnline(true); party.room(room({ status: 'racing' }), 'new-seat');
  assert.equal(ui.el('.lobby-overlay').hidden, true); assert.equal(ui.el('.results-overlay').hidden, true);
  assert.equal(ui.el('.race-hud').hidden, false); assert.equal(party.panel.hidden, true);
  assert.equal(party.lobbyVotes.hidden, true);
});

test('lobby voting and result voting stay independent and a finished lobby host can request settings', t => {
  const actions = [], { ui, party } = fixture(t, { lobby: () => actions.push('settings') });
  const data = room({ trackVotes: { guest: 'candy-hills' }, trackVoteCounts: { 'candy-hills': 1 } });
  ui.showLobby(data); party.room(data, 'host');
  assert.equal(party.lobbyVotes.hidden, false); assert.equal(party.panel.hidden, true);
  const lobbyButtons = party.lobbyVotes.querySelector('.party-vote-buttons');
  ui.showResults([{ id: 'host', name: '阿橘', finished: true, finishTime: 80 }]);
  party.room({ ...data, status: 'finished' }, 'host');
  assert.equal(party.lobbyVotes.hidden, true); assert.equal(party.panel.hidden, false);
  assert.equal(party.lobbyVotes.querySelector('.party-vote-buttons'), lobbyButtons, 'result rendering cannot relocate the lobby controls');
  assert.notEqual(party.panel.querySelector('.party-vote-buttons'), lobbyButtons);
  ui.hideOverlays(); ui.showLobby({ ...data, status: 'finished' }); party.room({ ...data, status: 'finished' }, 'host');
  const settings = party.lobbyVotes.querySelector('.party-lobby-settings-button');
  assert.equal(settings.hidden, false); settings.click(); assert.deepEqual(actions, ['settings']);
  party.room({ ...data, status: 'finished', players: data.players.map(p => ({ ...p, connected: p.id === 'host' })) }, 'host');
  assert.equal(ui.el('.results-dialog .restart-button').disabled, true, 'a host waits for an online friend before rematching');
});

test('only finished online racers spectate active opponents, controls cycle and leaving restores single-player buttons', t => {
  let cleared = 0; const { ui, party } = fixture(t, { clear: () => cleared++ });
  const player = { id: 'host', finished: true };
  const racers = [player, { id: 'guest', name: '薄荷', finished: false }, { id: 'ai', name: '小熊', finished: false }];
  const race = { phase: 'racing', player, racers };
  assert.equal(party.update(race, false), null); assert.equal(party.spectator.hidden, true);
  assert.equal(party.update({ ...race, player: { ...player, finished: false } }, true), null);
  ui.enterRace(); ui.setOnline(true);
  assert.equal(party.update(race, true).id, 'guest'); assert.equal(party.spectator.hidden, false);
  assert.equal(ui.el('.touch-controls').hidden, true); assert.equal(ui.el('.race-hud').hidden, false);
  assert.equal(ui.root.classList.contains('is-spectating'), true); assert.equal(cleared, 1);
  party.spectator.querySelector('[data-spectate="1"]').click();
  assert.equal(party.update(race, true).id, 'ai'); assert.equal(cleared, 2);
  assert.equal(party.update({ ...race, phase: 'countdown', player: { ...player, finished: false } }, true), null);
  assert.equal(ui.el('.touch-controls').hidden, false, 'the next start restores driving buttons');
  assert.equal(party.update({ ...race, phase: 'finished' }, true), null); assert.equal(party.spectator.hidden, true);
  party.room(room({ status: 'finished' }), 'guest'); assert.equal(ui.el('.results-dialog .restart-button').disabled, true);
  party.reset(); assert.equal(ui.el('.results-dialog .restart-button').disabled, false);
  assert.equal(party.panel.hidden, true); assert.equal(party.config.hidden, true); assert.equal(party.spectator.hidden, true); assert.equal(party.lobbyVotes.hidden, true);
});
