import test from 'node:test';
import assert from 'node:assert/strict';
import { configureRoom, voteForTrack, trackVoteSummary, returnRoomToLobby } from '../server/party-room.js';

const trackIds = ['sunny-island', 'candy-hills', 'bay-loop', 'starlight-canyon'];
const catalog = { trackIds, modes: ['race', 'items'], difficulties: ['easy', 'normal', 'hard'] };
const makeRoom = status => ({ status, trackId: 'sunny-island', mode: 'items', difficulty: 'normal', laps: 3,
  members: new Map([['host', {}], ['guest', {}]]), trackVotes: new Map(), roundId: 4, tick: 45, race: { phase: status } });

test('one seat has one replaceable vote, repeated votes are idempotent and ties use catalog order', () => {
  const room = makeRoom('finished');
  assert.equal(trackVoteSummary(room, trackIds).nextTrackId, 'sunny-island');
  voteForTrack(room, 'host', 'starlight-canyon', trackIds);
  voteForTrack(room, 'guest', 'bay-loop', trackIds);
  voteForTrack(room, 'guest', 'bay-loop', trackIds);
  let summary = trackVoteSummary(room, trackIds);
  assert.equal(summary.nextTrackId, 'bay-loop');
  assert.deepEqual(Object.values(summary.trackVoteCounts), [0, 0, 1, 1]);
  voteForTrack(room, 'guest', 'starlight-canyon', trackIds);
  summary = trackVoteSummary(room, trackIds);
  assert.equal(summary.nextTrackId, 'starlight-canyon');
  assert.equal(summary.trackVoteCounts['starlight-canyon'], 2);
  room.members.delete('guest');
  assert.equal(trackVoteSummary(room, trackIds).trackVoteCounts['starlight-canyon'], 1, 'departed seats cannot retain a vote');
});

test('voting rejects unknown players, unknown tracks and active races without changing previous votes', () => {
  const room = makeRoom('lobby');
  voteForTrack(room, 'host', 'bay-loop', trackIds);
  assert.throws(() => voteForTrack(room, 'stranger', 'bay-loop', trackIds), /加入/);
  assert.throws(() => voteForTrack(room, 'host', 'unknown', trackIds), /赛道/);
  room.status = 'racing';
  assert.throws(() => voteForTrack(room, 'host', 'candy-hills', trackIds), /比赛结束/);
  assert.deepEqual([...room.trackVotes], [['host', 'bay-loop']]);
});

test('room settings validate atomically, allow only supported laps, and clear votes only on a real change', () => {
  const room = makeRoom('finished');
  voteForTrack(room, 'host', 'bay-loop', trackIds);
  for (const invalid of [{ trackId: 'unknown' }, { mode: 'time-trial' }, { difficulty: 'expert' }, { laps: 2 }, { laps: '3' }]) {
    assert.throws(() => configureRoom(room, { trackId: 'candy-hills', ...invalid }, catalog));
    assert.equal(room.trackId, 'sunny-island');
    assert.equal(room.trackVotes.size, 1);
  }
  configureRoom(room, { trackId: 'sunny-island', laps: 3 }, catalog);
  assert.equal(room.trackVotes.size, 1);
  configureRoom(room, { trackId: 'candy-hills', mode: 'race', difficulty: 'hard', laps: 1 }, catalog);
  assert.deepEqual([room.trackId, room.mode, room.difficulty, room.laps], ['candy-hills', 'race', 'hard', 1]);
  assert.equal(room.trackVotes.size, 0);
  configureRoom(room, { laps: 5 }, catalog);
  assert.equal(room.laps, 5);
  room.status = 'racing';
  assert.throws(() => configureRoom(room, { laps: 3 }, catalog), /比赛进行中/);
  assert.equal(room.laps, 5);
});

test('returning from results preserves the party, vote and round identity but releases completed race state', () => {
  const room = makeRoom('finished');
  voteForTrack(room, 'guest', 'candy-hills', trackIds);
  returnRoomToLobby(room);
  assert.equal(room.status, 'lobby'); assert.equal(room.race, null); assert.equal(room.tick, 0);
  assert.equal(room.members.size, 2); assert.equal(room.roundId, 4);
  assert.equal(trackVoteSummary(room, trackIds).nextTrackId, 'candy-hills');
  returnRoomToLobby(room);
  assert.equal(room.members.size, 2, 'returning twice never removes seats');
  room.status = 'racing'; room.race = { phase: 'racing' };
  assert.throws(() => returnRoomToLobby(room), /等待本场比赛结束/);
  assert.equal(room.race.phase, 'racing');
});
