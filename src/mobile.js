export function detectInputMode({coarse=false,fine=false,touchPoints=0,lastInput}={}) {
  if(lastInput==='keyboard'||lastInput==='touch')return lastInput;
  if(fine)return 'keyboard';
  return coarse||touchPoints>0?'touch':'keyboard';
}

export function mobileLayout({width,height,coarse=false,fine=false,touchPoints=0,inputMode}) {
  const touch=detectInputMode({coarse,fine,touchPoints,lastInput:inputMode})==='touch';
  return {touch,hardwareTouch:Boolean(coarse||touchPoints>0),landscape:width>height,phonePortrait:touch&&width<600&&height>width};
}

function keyboardDrivingEvent(event) {
  if(event.repeat||event.isComposing||event.key==='Process'||event.keyCode===229||event.ctrlKey||event.altKey||event.metaKey)return false;
  if(event.target?.closest?.('.settings-overlay,.control-layout-editor,.courses-overlay,.new-player-guide,input,textarea,select,[contenteditable]'))return false;
  return /^(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right)|Shift(Left|Right)|Space|Enter|Escape|Numpad([0-9]|Add|Subtract|Multiply|Divide|Decimal|Enter)|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash)$/.test(event.code);
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
    this.document=root.ownerDocument;this.window=this.document.defaultView;
    this.coarse=this.window.matchMedia('(pointer: coarse)');
    this.fine=this.window.matchMedia('(pointer: fine)');
    this.anyCoarse=this.window.matchMedia('(any-pointer: coarse)');
    this.update=()=>this.sync();
    this.keyboardInput=event=>{if(keyboardDrivingEvent(event)&&this.inputMode!=='keyboard'){this.lastInput='keyboard';this.sync();}};
    this.touchInput=event=>{if(event.pointerType==='touch'&&this.hardwareTouch&&this.inputMode!=='touch'){this.lastInput='touch';this.sync();}};
    this.window.addEventListener('resize',this.update);
    this.window.addEventListener('orientationchange',this.update);
    this.window.addEventListener('keydown',this.keyboardInput);
    root.addEventListener('pointerdown',this.touchInput);
    this.window.visualViewport?.addEventListener('resize',this.update);
    for(const media of [this.coarse,this.fine,this.anyCoarse])media.addEventListener?.('change',this.update);
    this.document.addEventListener('fullscreenchange',this.update);
    this.document.addEventListener('webkitfullscreenchange',this.update);
    root.querySelector('.rotate-dismiss').addEventListener('click',()=>{this.dismissed=true;this.sync();});
    root.querySelector('.rotate-fullscreen').addEventListener('click',()=>this.enterFullscreen());
    root.querySelector('.fullscreen-button').addEventListener('click',()=>this.toggleFullscreen());
    this.sync();
  }
  sync() {
    const box=this.root.getBoundingClientRect();
    const touchPoints=this.window.navigator.maxTouchPoints;
    const inputMode=detectInputMode({coarse:this.coarse.matches,fine:this.fine.matches,touchPoints,lastInput:this.lastInput});
    const layout=mobileLayout({width:box.width||this.window.innerWidth,height:box.height||this.window.innerHeight,coarse:this.coarse.matches||this.anyCoarse.matches,fine:this.fine.matches,touchPoints,inputMode});
    const changed=this.inputMode!==inputMode,hardwareChanged=this.hardwareTouch!==layout.hardwareTouch;
    if(changed&&this.inputMode!==undefined)this.clear();
    this.inputMode=inputMode;
    this.touch=layout.touch;this.hardwareTouch=layout.hardwareTouch;
    this.root.dataset.inputMode=inputMode;
    this.root.classList.toggle('touch-device',layout.touch);
    this.root.classList.toggle('mobile-landscape',layout.touch&&layout.landscape);
    this.root.classList.toggle('phone-portrait',layout.phonePortrait);
    if(changed||hardwareChanged)this.mode(layout.touch,layout.hardwareTouch,inputMode);
    if(changed)this.root.dispatchEvent(new this.window.Event('inputmodechange'));
    if(!layout.phonePortrait)this.dismissed=false;
    const blocked=this.root.classList.contains('in-race')&&layout.phonePortrait&&!this.dismissed;
    if(blocked!==this.blocked)this.clear();
    this.blocked=blocked;
    this.root.querySelector('.rotate-overlay').hidden=!blocked;
    const fullscreen=Boolean(this.document.fullscreenElement||this.document.webkitFullscreenElement);
    const button=this.root.querySelector('.fullscreen-button');
    button.setAttribute('aria-label',fullscreen?'退出全屏':'全屏游玩');button.title=fullscreen?'退出全屏':'全屏游玩';
    button.setAttribute('aria-pressed',String(fullscreen));
  }
  destroy() {
    this.window.removeEventListener('resize',this.update);this.window.removeEventListener('orientationchange',this.update);
    this.window.removeEventListener('keydown',this.keyboardInput);this.root.removeEventListener('pointerdown',this.touchInput);
    this.window.visualViewport?.removeEventListener('resize',this.update);
    for(const media of [this.coarse,this.fine,this.anyCoarse])media.removeEventListener?.('change',this.update);
    this.document.removeEventListener('fullscreenchange',this.update);this.document.removeEventListener('webkitfullscreenchange',this.update);
  }
  beginRace(){this.dismissed=false;this.sync();}
  async enterFullscreen() {
    if(this.pending)return;
    this.pending=true;
    try {
      const result=await requestLandscape(this.document,this.window.screen);
      if(!result.locked&&this.root.classList.contains('phone-portrait'))this.toast('请把手机横过来，也可以先竖屏继续');
    } finally {this.pending=false;this.sync();}
  }
  async toggleFullscreen() {
    if(this.document.fullscreenElement||this.document.webkitFullscreenElement) {
      try {this.window.screen.orientation?.unlock?.();if(this.document.exitFullscreen)await this.document.exitFullscreen();else await this.document.webkitExitFullscreen?.();}catch {}
      this.sync();
    } else await this.enterFullscreen();
  }
}
