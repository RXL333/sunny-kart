const positive=(...values)=>values.find(value=>Number.isFinite(value)&&value>0)||1;

// Measure CSS pixels, not the canvas backing buffer. CSS owns the full-screen
// size; renderer.setSize(..., false) only updates its resolution.
export function viewportProfile({rect={},visualViewport={},width=1,height=1,pixelRatio=1,touch=false,quality='auto'}={}) {
  const w=Math.max(1,Math.round(positive(rect.width,visualViewport.width,width)));
  const h=Math.max(1,Math.round(positive(rect.height,visualViewport.height,height)));
  const mobile=Boolean(touch||w<=600||(w<=1024&&h<=560));
  const cap=quality==='smooth'?1:quality==='sharp'?1.75:mobile?1.25:1.75;
  const shadowSize=quality==='smooth'?512:quality==='sharp'?2048:mobile?1024:2048;
  return {width:w,height:h,aspect:w/h,touch:mobile,pixelRatio:Math.min(positive(pixelRatio),cap),shadowSize};
}

// A fixed vertical field of view crops most of the road on portrait phones.
// Preserve the usual camera on landscape screens and widen portrait fallback.
export function cameraFov(base,aspect) {
  const safeAspect=positive(aspect);
  const roadFov=2*Math.atan(Math.tan(46*Math.PI/360)/safeAspect)*180/Math.PI;
  return Math.min(88,Math.max(base,roadFov));
}

export function chaseFraming(viewport={},speed=0) {
  const extension=Math.min(1.5,Math.max(0,Number(speed)||0)*.025);
  const phoneLandscape=viewport.touch&&viewport.width>viewport.height&&viewport.height<=560;
  return phoneLandscape
    ? {behind:14.5+extension,height:6.7,ahead:8,targetHeight:1.3,relativeToPlayer:true}
    : {behind:11.5+extension,height:5.8,ahead:14,targetHeight:1.7,relativeToPlayer:false};
}

export function chaseEye(track,distance,offset,framing) {
  const p=track.sample(distance);
  // Sampling the inner road edge several metres behind can put the camera
  // very close to the kart in tight bends. Keep the short phone view at a
  // fixed tangent-relative distance instead.
  if(framing.relativeToPlayer)return {x:p.x-p.tx*framing.behind+p.nx*offset,y:p.y+framing.height,z:p.z-p.tz*framing.behind+p.nz*offset};
  const behind=track.sample(distance-framing.behind);
  return {x:behind.x+behind.nx*offset,y:behind.y+framing.height,z:behind.z+behind.nz*offset};
}
