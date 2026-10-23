// Voting is room-owned, so reconnecting a seat cannot gain a second vote.
export function trackVoteSummary(room, trackIds) {
  const counts = Object.fromEntries(trackIds.map(id => [id, 0]));
  for (const [playerId, trackId] of room.trackVotes ?? []) {
    if (room.members.has(playerId) && Object.hasOwn(counts, trackId)) counts[trackId]++;
  }
  let nextTrackId = room.trackId, mostVotes = 0;
  // Catalog order is the stable tie break; the host has no extra vote.
  for (const trackId of trackIds) if (counts[trackId] > mostVotes) {
    mostVotes = counts[trackId]; nextTrackId = trackId;
  }
  return { trackVoteCounts: counts, nextTrackId };
}

export function configureRoom(room, options, { trackIds, modes, difficulties }) {
  if (room.status === 'racing') throw new Error('比赛进行中，赛后可以调整房间');
  const trackId = options.trackId ?? room.trackId, mode = options.mode ?? room.mode;
  const difficulty = options.difficulty ?? room.difficulty, laps = options.laps ?? room.laps;
  if (!trackIds.includes(trackId)) throw new Error('没有找到这条赛道，请重新选择');
  if (!modes.includes(mode)) throw new Error('请选择竞速赛或道具赛');
  if (!difficulties.includes(difficulty)) throw new Error('请选择有效的 AI 难度');
  if (![1, 3, 5].includes(laps)) throw new Error('圈数支持 1、3 或 5 圈');
  // Validate the entire update before changing any field.
  const changed = room.trackId !== trackId || room.mode !== mode || room.difficulty !== difficulty || room.laps !== laps;
  Object.assign(room, { trackId, mode, difficulty, laps });
  if (changed) room.trackVotes.clear();
}

export function voteForTrack(room, playerId, trackId, trackIds) {
  if (room.status === 'racing') throw new Error('比赛结束后可以投票选择下一张地图');
  if (!room.members.has(playerId)) throw new Error('请先加入房间');
  if (!trackIds.includes(trackId)) throw new Error('没有找到这条赛道，请重新选择');
  room.trackVotes.set(playerId, trackId);
}

export function returnRoomToLobby(room) {
  if (room.status === 'racing') throw new Error('请等待本场比赛结束后返回大厅');
  room.status = 'lobby'; room.race = null; room.tick = 0;
}
