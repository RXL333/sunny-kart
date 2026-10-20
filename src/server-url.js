const LOCAL_HOST = /^(localhost|127(?:\.\d+){3}|\[?::1\]?|10(?:\.\d+){3}|192\.168(?:\.\d+){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d+){2})$/;

export function resolveServerUrl({configured='',location,development=false}={}) {
  if (configured.trim()) {
    const url=new URL(configured.trim());
    if(!['http:','https:','ws:','wss:'].includes(url.protocol)||url.username||url.password)throw new Error('联机服务器地址配置无效');
    url.protocol=url.protocol==='https:'||url.protocol==='wss:'?'wss:':'ws:';
    if(location?.protocol==='https:'&&url.protocol!=='wss:')throw new Error('线上联机服务需要安全的 HTTPS / WSS 地址');
    if(url.pathname==='/'||!url.pathname)url.pathname='/ws';
    url.search='';url.hash='';return url.toString();
  }
  if(!development&&!LOCAL_HOST.test(location?.hostname??''))throw new Error('联机服务器尚未配置，单人比赛可以正常游玩');
  const protocol=location?.protocol==='https:'?'wss:':'ws:';
  return `${protocol}//${development?`${location.hostname}:3001`:location.host}/ws`;
}

export function healthUrl(webSocketUrl) {
  const url=new URL(webSocketUrl);url.protocol=url.protocol==='wss:'?'https:':'http:';url.pathname='/health';return url.toString();
}
