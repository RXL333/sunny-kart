// Frontend and server must agree before a room or a reserved seat is entered.
export const PROTOCOL_VERSION = 4;
export const MULTIPLAYER_MODES = Object.freeze(['race', 'items']);
export const NETWORK_CAPABILITIES = Object.freeze(['manual-items', 'input-ack', 'seat-resume']);
export const UPDATE_MESSAGE = '联机版本正在更新，请刷新游戏后重试；更新完成前可以先玩单人模式';
export const isRaceMode = mode => MULTIPLAYER_MODES.includes(mode);
export const isCompatibleServer = message => message.protocolVersion === PROTOCOL_VERSION
  && MULTIPLAYER_MODES.every(mode => message.modes?.includes(mode))
  && NETWORK_CAPABILITIES.every(capability => message.capabilities?.includes(capability));
