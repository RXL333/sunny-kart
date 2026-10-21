export function mobileLayout({width,height,coarse=false,touchPoints=0}) {
  const touch=Boolean(coarse||touchPoints>0||width<=600||(width<=1024&&height<=560));
  return {touch,hardwareTouch:Boolean(coarse||touchPoints>0),landscape:width>height,phonePortrait:touch&&width<600&&height>width};
}

// Both APIs are optional; a rejected orientation lock must never block racing.
export async function requestLandscape(doc,screenObject) {
  let fullscreen=Boolean(doc.fullscreenElement||doc.webkitFullscreenElement),locked=false;
  const root=doc.documentElement;
  if(!fullscreen) {
    try {
      if(root.requestFullscreen)await root.requestFullscreen({navigationUI:'hide'});
      else if(root.webkitRequestFullscreen)await root.webkitRequestFullscreen();
      fullscreen=Boolean(doc.fullscreenElement||doc.webkitFullscreenElement);
    } catch {}
  }
  try {if(screenObject?.orientation?.lock){await screenObject.orientation.lock('landscape');locked=true;}}catch {}
  return {fullscreen,locked};
}

export class MobileExperience {
  constructor(root,{clear=()=>{},toast=()=>{},mode=()=>{}}={}) {
    this.root=root;this.clear=clear;this.toast=toast;this.mode=mode;this.dismissed=false;this.blocked=false;
    this.coarse=window.matchMedia('(any-pointer: coarse)');
    this.update=()=>this.sync();
    window.addEventListener('resize',this.update);
    window.addEventListener('orientationchange',this.update);
    window.visualViewport?.addEventListener('resize',this.update);
    this.coarse.addEventListener?.('change',this.update);
    document.addEventListener('fullscreenchange',this.update);
    document.addEventListener('webkitfullscreenchange',this.update);
    root.querySelector('.rotate-dismiss').addEventListener('click',()=>{this.dismissed=true;this.sync();});
    root.querySelector('.rotate-fullscreen').addEventListener('click',()=>this.enterFullscreen());
    root.querySelector('.fullscreen-button').addEventListener('click',()=>this.toggleFullscreen());
    this.sync();
  }
  sync() {
    const box=this.root.getBoundingClientRect();
    const layout=mobileLayout({width:box.width||innerWidth,height:box.height||innerHeight,coarse:this.coarse.matches,touchPoints:navigator.maxTouchPoints});
    if(this.touch!==layout.touch||this.hardwareTouch!==layout.hardwareTouch)this.mode(layout.touch,layout.hardwareTouch);
    this.touch=layout.touch;this.hardwareTouch=layout.hardwareTouch;
    this.root.classList.toggle('touch-device',layout.touch);
    this.root.classList.toggle('mobile-landscape',layout.touch&&layout.landscape);
    this.root.classList.toggle('phone-portrait',layout.phonePortrait);
    if(!layout.phonePortrait)this.dismissed=false;
    const blocked=this.root.classList.contains('in-race')&&layout.phonePortrait&&!this.dismissed;
    if(blocked!==this.blocked)this.clear();
    this.blocked=blocked;
    this.root.querySelector('.rotate-overlay').hidden=!blocked;
    const fullscreen=Boolean(document.fullscreenElement||document.webkitFullscreenElement);
    const button=this.root.querySelector('.fullscreen-button');
    button.setAttribute('aria-label',fullscreen?'退出全屏':'全屏游玩');button.title=fullscreen?'退出全屏':'全屏游玩';
    button.setAttribute('aria-pressed',String(fullscreen));
  }
  beginRace(){this.dismissed=false;this.sync();}
  async enterFullscreen() {
    if(this.pending)return;
    this.pending=true;
    try {
      const result=await requestLandscape(document,window.screen);
      if(!result.locked&&this.root.classList.contains('phone-portrait'))this.toast('请把手机横过来，也可以先竖屏继续');
    } finally {this.pending=false;this.sync();}
  }
  async toggleFullscreen() {
    if(document.fullscreenElement||document.webkitFullscreenElement) {
      try {window.screen.orientation?.unlock?.();if(document.exitFullscreen)await document.exitFullscreen();else await document.webkitExitFullscreen?.();}catch {}
      this.sync();
    } else await this.enterFullscreen();
  }
}
