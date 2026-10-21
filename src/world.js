import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { optimizeModel } from './optimize-model.js';
import { createTerrainSampler, MAP_LAYOUT } from './game/map-layout.js';
import { viewportProfile, cameraFov, chaseFraming, chaseEye } from './viewport.js';

const PALETTE = [0xf59e42, 0x41bfa2, 0x9982df, 0xf4ce51, 0xef718c, 0x54b4df, 0xdba16b, 0x7bbd66];
const mat = (color, roughness = .72) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
const _v = new THREE.Vector3();
function mesh(geo, material, x=0, y=0, z=0, parent) {
  const m = new THREE.Mesh(geo, material); m.position.set(x,y,z);
  m.castShadow = true; m.receiveShadow = true; parent?.add(m); return m;
}
function ball(parent, x,y,z, sx,sy,sz, material) {
  const m=mesh(new THREE.SphereGeometry(1,14,10),material,x,y,z,parent);m.scale.set(sx,sy,sz);return m;
}
function box(parent,x,y,z,sx,sy,sz,material) {return mesh(new THREE.BoxGeometry(sx,sy,sz),material,x,y,z,parent);}
function label(text, bg='#fff8dc', fg='#143e49', width=512, height=128) {
  const c=document.createElement('canvas');c.width=width;c.height=height;
  const ctx=c.getContext('2d');ctx.fillStyle=bg;ctx.fillRect(0,0,width,height);
  ctx.fillStyle=fg;ctx.font=`900 ${height*.57}px Arial`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,width/2,height*.53);
  const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide});
}

export class World {
  constructor(canvas,track) {
    this.track=track; this.time=0; this.overview=false; this.karts=[]; this.windmills=[]; this.clouds=[]; this.particles=[];this.graphicsQuality='auto';
    this.terrainSampler=createTerrainSampler(track);
    this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.18;
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color(0xb8e9f5);
    this.scene.fog=new THREE.Fog(0xb8e9f5,330,1250);
    this.camera=new THREE.PerspectiveCamera(52,1,.15,1900);
    this.scene.add(new THREE.HemisphereLight(0xc7f2ff,0xa9b887,2.25));
    const sun=new THREE.DirectionalLight(0xfff1cc,3.1);sun.position.set(-65,130,-45);sun.castShadow=true;
    sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-78;sun.shadow.camera.right=78;
    sun.shadow.camera.top=78;sun.shadow.camera.bottom=-78;sun.shadow.camera.far=390;
    sun.shadow.normalBias=.055;sun.shadow.bias=-.0002;this.scene.add(sun);this.scene.add(sun.target);this.sun=sun;
    this.materials={grass:mat(0x83c56b),road:mat(0x627178),white:mat(0xfff7dd),red:mat(0xf28364),sand:mat(0xf1dfaa),dark:mat(0x203e49),trunk:mat(0x9f7760),leaf:mat(0x52aa64),leaf2:mat(0x91ca69),yellow:mat(0xffdf69),teal:mat(0x46bba9)};
    this.buildIsland();this.buildRoad();this.buildBridge();this.buildScenery();this.buildStart();this.buildPickups();
    this.resize();const start=this.track.sample(0);this.camera.position.set(start.x+start.tx*8.5+start.nx*8,start.y+5.4,start.z+start.tz*8.5+start.nz*8);this.camera.lookAt(start.x,start.y+1.2,start.z);
    this.queueResize=()=>{if(this.resizeRequest)return;this.resizeRequest=requestAnimationFrame(()=>{this.resizeRequest=0;this.resize();});};
    window.addEventListener('resize',this.queueResize);window.addEventListener('orientationchange',this.queueResize);
    window.visualViewport?.addEventListener('resize',this.queueResize);
    document.addEventListener('fullscreenchange',this.queueResize);document.addEventListener('webkitfullscreenchange',this.queueResize);
    if(typeof ResizeObserver!=='undefined'){this.canvasResize=new ResizeObserver(this.queueResize);this.canvasResize.observe(canvas);}
  }
  resize(){
    const profile=viewportProfile({rect:this.renderer.domElement.getBoundingClientRect(),visualViewport:window.visualViewport||{},width:innerWidth,height:innerHeight,pixelRatio:window.devicePixelRatio||1,touch:Boolean(window.matchMedia?.('(any-pointer: coarse)').matches||navigator.maxTouchPoints>0),quality:this.graphicsQuality});
    const previous=this.viewport;
    if(previous&&previous.width===profile.width&&previous.height===profile.height&&previous.pixelRatio===profile.pixelRatio&&previous.shadowSize===profile.shadowSize)return;
    if(previous?.pixelRatio!==profile.pixelRatio)this.renderer.setPixelRatio(profile.pixelRatio);
    if(!previous||previous.width!==profile.width||previous.height!==profile.height)this.renderer.setSize(profile.width,profile.height,false);
    if(!previous||chaseFraming(previous).relativeToPlayer!==chaseFraming(profile).relativeToPlayer)this.resetChase=true;
    this.camera.aspect=profile.aspect;this.camera.updateProjectionMatrix();this.viewport=profile;
    if(this.sun&&this.sun.shadow.mapSize.x!==profile.shadowSize){this.sun.shadow.mapSize.set(profile.shadowSize,profile.shadowSize);this.sun.shadow.map?.dispose();this.sun.shadow.map=null;this.sun.shadow.needsUpdate=true;}
  }
  setGraphicsQuality(mode){this.graphicsQuality=['auto','smooth','sharp'].includes(mode)?mode:'auto';this.resize();}
  nearest(x,z){return this.terrainSampler.nearest(x,z);}
  terrainHeight(x,z){return this.terrainSampler.terrainHeight(x,z);}
  buildIsland(){
    const seaGeo=new THREE.PlaneGeometry(4000,4000);seaGeo.rotateX(-Math.PI/2);
    this.sea=mesh(seaGeo,mat(0x62c9d4,.3),0,-.55,0,this.scene);this.sea.receiveShadow=false;
    const {width,depth,chunksX,chunksZ,segments}=MAP_LAYOUT.terrain;
    const green=new THREE.Color(0x8acb70),sand=new THREE.Color(0xf3dfa3),deep=new THREE.Color(0x58c4c9),high=new THREE.Color(0x7eb78d);
    const terrainMaterial=new THREE.MeshStandardMaterial({vertexColors:true,roughness:1});
    for(let cx=0;cx<chunksX;cx++)for(let cz=0;cz<chunksZ;cz++){
      const terrain=new THREE.PlaneGeometry(width/chunksX,depth/chunksZ,segments,segments);terrain.rotateX(-Math.PI/2);
      const pos=terrain.attributes.position,colors=[],ox=(cx+.5)*width/chunksX-width/2,oz=(cz+.5)*depth/chunksZ-depth/2;
      for(let i=0;i<pos.count;i++){const x=pos.getX(i)+ox,z=pos.getZ(i)+oz,h=this.terrainHeight(x,z);pos.setXYZ(i,x,h,z);const c=h<1?sand.clone().lerp(deep,THREE.MathUtils.smoothstep(-h,1,2.8)):green.clone().lerp(sand,1-THREE.MathUtils.smoothstep(h,.6,3.5)).lerp(high,THREE.MathUtils.smoothstep(h,17,43)*.55);colors.push(c.r,c.g,c.b);}
      terrain.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));terrain.computeVertexNormals();
      mesh(terrain,terrainMaterial,0,0,0,this.scene).castShadow=false;
    }
    for(let i=0;i<3;i++){const ring=mesh(new THREE.RingGeometry(389+i*9,390+i*9,180),new THREE.MeshBasicMaterial({color:0xb8efdf,transparent:true,opacity:.22-i*.05,side:THREE.DoubleSide}),-5,-.48+i*.008,7,this.scene);ring.rotation.x=-Math.PI/2;ring.scale.y=.86;}
  }
  ribbon(left,right,height,material,start=0,end=this.track.length){
    const positions=[],indices=[],count=Math.ceil((end-start)/1.8);
    for(let i=0;i<=count;i++){const p=this.track.sample(start+i/count*(end-start));for(const k of [left,right])positions.push(p.x+p.nx*k,p.y+height,p.z+p.nz*k);if(i<count){const j=i*2;indices.push(j,j+2,j+1,j+1,j+2,j+3);}}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();return mesh(g,material,0,0,0,this.scene);
  }
  buildRoad(){
    const half=this.track.width/2;
    const verge=mat(0x70b16a);this.ribbon(-11.6,-half,-.045,verge);this.ribbon(half,11.6,-.045,verge);this.ribbon(-half,half,.01,this.materials.road);
    this.ribbon(-half+.4,-half+.58,.028,this.materials.white);this.ribbon(half-.58,half-.4,.028,this.materials.white);
    const curbGeo=new THREE.BoxGeometry(.85,.16,3.05),total=Math.floor(this.track.length/3);
    const curbs=[new THREE.InstancedMesh(curbGeo,this.materials.red,total+2),new THREE.InstancedMesh(curbGeo,this.materials.white,total+2)];const counts=[0,0];const dummy=new THREE.Object3D();
    for(let i=0;i<total;i++){const p=this.track.sample(i*3);for(const side of [-1,1]){dummy.position.set(p.x+p.nx*(half+.15)*side,p.y+.06,p.z+p.nz*(half+.15)*side);dummy.rotation.set(-p.pitch,p.heading,0,'YXZ');dummy.updateMatrix();const k=i%2;curbs[k].setMatrixAt(counts[k]++,dummy.matrix);}}
    for(let k=0;k<2;k++){curbs[k].count=counts[k];curbs[k].receiveShadow=true;this.scene.add(curbs[k]);}
    const dashes=new THREE.InstancedMesh(new THREE.BoxGeometry(.12,.016,2.4),this.materials.white,Math.ceil(this.track.length/9));
    for(let i=0;i<dashes.count;i++){const p=this.track.sample(i*9);dummy.position.set(p.x,p.y+.032,p.z);dummy.rotation.set(-p.pitch,p.heading,0,'YXZ');dummy.updateMatrix();dashes.setMatrixAt(i,dummy.matrix);}this.scene.add(dashes);
    this.buildGuardrails();
    for(const d of this.track.boostPads??[]){const p=this.track.sample(d.distance);const group=new THREE.Group();group.position.set(p.x+p.nx*d.lane,p.y+.05,p.z+p.nz*d.lane);group.rotation.y=p.heading;this.scene.add(group);
      group.rotation.x=-p.pitch;group.rotation.order='YXZ';box(group,0,0,0,3.8,.045,5.5,this.materials.teal);
      for(let i=-1;i<=1;i++){for(const s of [-1,1]){const b=box(group,s*.52,.035,i*1.45,.28,.04,1.5,this.materials.yellow);b.rotation.y=s*-.72;}}
    }
  }
  instances(geometry,material,items,shadows=true){
    if(!items.length)return null;
    const group=new THREE.InstancedMesh(geometry,material,items.length),dummy=new THREE.Object3D();
    for(let i=0;i<items.length;i++){const p=items[i];dummy.position.set(p.x??0,p.y??0,p.z??0);dummy.rotation.set(p.rx??0,p.ry??0,p.rz??0);dummy.scale.set(p.sx??1,p.sy??1,p.sz??1);dummy.updateMatrix();group.setMatrixAt(i,dummy.matrix);}
    group.castShadow=shadows;group.receiveShadow=true;group.computeBoundingSphere();this.scene.add(group);return group;
  }
  buildGuardrails(){
    const count=Math.ceil(this.track.length/8),step=this.track.length/count,posts=[],beams=[],dummy=new THREE.Object3D(),forward=new THREE.Vector3(0,0,1);
    const geo=new THREE.BoxGeometry(.2,.2,1),rail=new THREE.InstancedMesh(geo,this.materials.white,count*2);
    let index=0;
    for(let i=0;i<count;i++){const a=this.track.sample(i*step),b=this.track.sample((i+1)*step);for(const side of [-1,1]){
      const p=new THREE.Vector3(a.x+a.nx*11.5*side,a.y+1.15,a.z+a.nz*11.5*side),q=new THREE.Vector3(b.x+b.nx*11.5*side,b.y+1.15,b.z+b.nz*11.5*side),delta=q.clone().sub(p);
      dummy.position.copy(p).add(q).multiplyScalar(.5);dummy.quaternion.setFromUnitVectors(forward,delta.clone().normalize());dummy.scale.set(1,1,delta.length()+.15);dummy.updateMatrix();rail.setMatrixAt(index++,dummy.matrix);
      posts.push({x:p.x,y:a.y+.65,z:p.z,sx:.2,sy:1.3,sz:.2});
    }}
    rail.castShadow=true;rail.receiveShadow=true;this.scene.add(rail);this.instances(new THREE.BoxGeometry(1,1,1),this.materials.teal,posts);
  }
  buildBridge(){
    const length=this.track.length,start=.713*length,end=.829*length;
    this.ribbon(-11.55,11.55,-.25,this.materials.white,start,end);
    const supports=[];
    for(let d=start;d<end;d+=17){const p=this.track.sample(d);for(const s of [-1,1])supports.push({x:p.x+p.nx*10.4*s,y:(p.y-3)/2,z:p.z+p.nz*10.4*s,sx:1.2,sy:p.y+3,sz:1.35});}
    this.instances(new THREE.BoxGeometry(1,1,1),mat(0xabc6bc),supports);
    const a=.735*length,b=.808*length;
    for(const d of [a,b]){const p=this.track.sample(d),g=new THREE.Group();g.position.set(p.x,p.y,p.z);g.rotation.y=p.heading;this.scene.add(g);for(const s of [-1,1]){box(g,s*11,9.5,0,1.5,20,1.8,this.materials.teal);ball(g,s*11,20,0,1,1,1,this.materials.yellow);}box(g,0,16.5,0,22,1.2,1.4,this.materials.teal);}
    for(const s of [-1,1]){const points=[],hangers=[];for(let i=0;i<=32;i++){const t=i/32,p=this.track.sample(a+(b-a)*t),height=3+16*(2*t-1)**2;points.push(new THREE.Vector3(p.x+p.nx*11*s,p.y+height,p.z+p.nz*11*s));if(i%2===0)hangers.push({x:p.x+p.nx*11*s,y:p.y+(height+1.25)/2,z:p.z+p.nz*11*s,sx:.1,sy:height-1.25,sz:.1});}const curve=new THREE.CatmullRomCurve3(points);mesh(new THREE.TubeGeometry(curve,100,.11,5,false),this.materials.white,0,0,0,this.scene);this.instances(new THREE.BoxGeometry(1,1,1),this.materials.white,hangers);}
  }
  buildScenery(){
    let seed=94827;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
    const trunkGeo=new THREE.CylinderGeometry(.32,.48,1,7),leafGeo=new THREE.SphereGeometry(1,10,7),pineGeo=new THREE.ConeGeometry(1,1,7);
    for(const zone of this.track.zones){const trunks=[],round=[],light=[],pines=[];const count={coast:90,forest:650,mountain:380,bridge:40,village:140}[zone.kind];
      for(let i=0;i<count;i++){const p=this.track.sample(zone.start+random()*(zone.end-zone.start)),side=random()>.5?1:-1,k=(18+random()*(zone.kind==='forest'?85:65))*side,x=p.x+p.nx*k,z=p.z+p.nz*k,near=this.nearest(x,z),h=this.terrainSampler.terrainHeight(x,z,near);if(h<2||near.d<16)continue;const size=.8+random()*1.1,stem=3.4*size;
        trunks.push({x,y:h+stem/2,z,sx:size,sy:stem,sz:size});
        if(zone.kind==='mountain'||(zone.kind==='forest'&&i%4===0)){pines.push({x,y:h+5.2*size,z,sx:2.8*size,sy:6.7*size,sz:2.8*size});pines.push({x,y:h+7.7*size,z,sx:2.1*size,sy:5.3*size,sz:2.1*size});}
        else{round.push({x,y:h+5.1*size,z,sx:2.9*size,sy:3.4*size,sz:2.7*size});if(i%3===0)light.push({x:x-1.3*size,y:h+4.4*size,z:z+.4*size,sx:2.4*size,sy:2.5*size,sz:2.2*size});}
      }
      this.instances(trunkGeo,this.materials.trunk,trunks);this.instances(leafGeo,this.materials.leaf,round);this.instances(leafGeo,this.materials.leaf2,light);this.instances(pineGeo,mat(zone.kind==='mountain'?0x5fa68d:0x529f6b),pines);
    }
    const palmTrunks=[],palmLeaves=[];for(let i=0;i<62;i++){const p=this.track.sample((.015+random()*.215)*this.track.length),offset=22+random()*48,x=p.x+p.nx*offset,z=p.z+p.nz*offset,h=this.terrainHeight(x,z);if(h<.8||this.nearest(x,z).d<17)continue;const size=.8+random()*.6;palmTrunks.push({x,y:h+3.6*size,z,sx:.75*size,sy:7.2*size,sz:.75*size});for(let j=0;j<5;j++){const a=j/5*Math.PI*2;palmLeaves.push({x:x+Math.sin(a)*2.1*size,y:h+7.2*size,z:z+Math.cos(a)*2.1*size,sx:.9*size,sy:.23*size,sz:3.1*size,ry:a,rx:.16});}}
    this.instances(trunkGeo,this.materials.trunk,palmTrunks);this.instances(leafGeo,this.materials.leaf,palmLeaves);
    for(const [x,z,radius,height,color] of MAP_LAYOUT.peaks){const h=this.terrainHeight(x,z);if(this.nearest(x,z).d<radius+14)continue;mesh(new THREE.ConeGeometry(radius,height,6),mat(color),x,h+height/2-1,z,this.scene).rotation.y=.45;mesh(new THREE.ConeGeometry(radius*.29,height*.29,6),this.materials.white,x,h+height*.855,z,this.scene).rotation.y=.45;}
    for(const [x,z,radius,height] of MAP_LAYOUT.distantPeaks){const peak=mesh(new THREE.ConeGeometry(radius,height,5),mat(0x96c6bd),x,height/2-5,z,this.scene);peak.castShadow=false;peak.rotation.y=.55;}
    const village=this.track.zones.find(z=>z.kind==='village');for(let i=0;i<20;i++){const p=this.track.sample(village.start+20+i/20*(village.end-village.start-45)),k=(21+(i%3)*7)*(i%2?1:-1),x=p.x+p.nx*k,z=p.z+p.nz*k;if(this.nearest(x,z).d>16&&this.terrainHeight(x,z)>1.5)this.house(x,z,[0xffd58c,0xefa095,0xa9c9e6,0xc5d8a4][i%4]);}
    for(const u of [.06,.88,.945]){const p=this.track.sample(u*this.track.length),x=p.x-p.nx*38,z=p.z-p.nz*38;this.windmill(x,z);}
    this.buildCoastLandmarks();
    const clouds=[];for(let i=0;i<34;i++){const a=i/34*Math.PI*2,r=470+random()*270,y=85+random()*90;for(let j=0;j<4;j++)clouds.push({x:Math.cos(a)*r+(j-1.5)*11,y:y+Math.sin(j*2)*3,z:Math.sin(a)*r,sx:14,sy:8+random()*6,sz:10});}this.instances(leafGeo,new THREE.MeshBasicMaterial({color:0xfffdf4}),clouds,false);
    const rocks=[],flowers=[],flowersWhite=[];for(let i=0;i<850;i++){const p=this.track.sample(random()*this.track.length),k=(13.8+random()*20)*(random()>.5?1:-1),x=p.x+p.nx*k,z=p.z+p.nz*k,h=this.terrainHeight(x,z);if(h<1.5||this.nearest(x,z).d<12.8)continue;if(i%4===0){const size=.6+random()*1.7;rocks.push({x,y:h+.35*size,z,sx:size,sy:size*.7,sz:size,ry:random()*6});}else(i%2?flowers:flowersWhite).push({x,y:h+.27,z,sx:.26,sy:.31,sz:.26});}this.instances(new THREE.DodecahedronGeometry(1),mat(0xb2c5b3),rocks);this.instances(leafGeo,this.materials.yellow,flowers,false);this.instances(leafGeo,this.materials.white,flowersWhite,false);
    for(let d=35;d<this.track.length;d+=54){const p=this.track.sample(d);if(Math.abs(p.curvature)<.006)continue;const side=p.curvature>0?-1:1,g=new THREE.Group();g.position.set(p.x+p.nx*13.2*side,p.y,p.z+p.nz*13.2*side);g.rotation.y=p.heading;this.scene.add(g);box(g,0,1.6,0,.18,3.2,.18,this.materials.dark);box(g,0,3.1,0,3.2,1.3,.18,this.materials.yellow);for(let j=-1;j<=1;j++){const sign=box(g,j*.75,3.1,-.11,.18,.85,.025,this.materials.dark);sign.rotation.z=(p.curvature>0?1:-1)*-.55;}}
    for(const zone of this.track.zones.slice(1)){const p=this.track.sample(zone.start+18),g=new THREE.Group();g.position.set(p.x+p.nx*15,p.y,p.z+p.nz*15);g.rotation.y=p.heading;this.scene.add(g);box(g,0,2.8,0,.24,5.6,.24,this.materials.dark);box(g,0,4.7,0,7,1.8,.2,this.materials.white);mesh(new THREE.PlaneGeometry(6.6,1.5),label(zone.name),0,4.7,-.12,g).rotation.y=Math.PI;mesh(new THREE.PlaneGeometry(6.6,1.5),label(zone.name),0,4.7,.12,g);}
  }
  buildCoastLandmarks(){
    const p=this.track.sample(this.track.length*.182),x=p.x+p.nx*43,z=p.z+p.nz*43,h=this.terrainHeight(x,z),base=Math.max(1.4,h),g=new THREE.Group();g.position.set(x,base,z);this.scene.add(g);
    mesh(new THREE.CylinderGeometry(5,6.3,base-h+1,12),mat(0xb1c5b6),x,(base+h-1)/2,z,this.scene);
    mesh(new THREE.CylinderGeometry(2.25,3.15,19,14),this.materials.white,0,9.5,0,g);mesh(new THREE.CylinderGeometry(2.53,2.69,3,14),this.materials.red,0,11.8,0,g);mesh(new THREE.CylinderGeometry(2.7,2.7,1,14),this.materials.dark,0,19.4,0,g);mesh(new THREE.CylinderGeometry(1.9,1.9,3.2,12),this.materials.yellow,0,21.1,0,g);mesh(new THREE.ConeGeometry(3.4,2.5,12),this.materials.teal,0,23.4,0,g);
    for(let i=0;i<9;i++){const q=this.track.sample((.018+i*.018)*this.track.length),k=22+(i%2)*9,x=q.x+q.nx*k,z=q.z+q.nz*k,h=this.terrainHeight(x,z);if(h<.7)continue;const umbrella=new THREE.Group();umbrella.position.set(x,h,z);this.scene.add(umbrella);mesh(new THREE.CylinderGeometry(.09,.09,3,6),this.materials.white,0,1.5,0,umbrella);mesh(new THREE.ConeGeometry(2.3,.9,8),i%2?this.materials.red:this.materials.teal,0,3,0,umbrella);box(umbrella,0,.35,1.1,2.2,.3,1.8,this.materials.white);}
    for(const [x,z] of [[-85,-330],[90,-347],[370,-95],[-380,12]]){const boat=new THREE.Group();boat.position.set(x,-.1,z);boat.rotation.y=x*.02;this.scene.add(boat);const hull=ball(boat,0,0,0,1.6,.65,4.6,this.materials.white);box(boat,0,4.4,0,.12,8.8,.12,this.materials.trunk);const sail=mesh(new THREE.ConeGeometry(3.2,6.5,3),this.materials.yellow,0,5.5,0,boat);sail.scale.z=.045;}
  }
  house(x,z,color){const g=new THREE.Group();g.position.set(x,this.terrainHeight(x,z),z);this.scene.add(g);box(g,0,2.3,0,6,4.6,5,mat(color));const roof=mesh(new THREE.ConeGeometry(5,3,4),this.materials.red,0,5.5,0,g);roof.rotation.y=Math.PI/4;box(g,0,1.2,2.53,1.2,2.4,.05,this.materials.teal);for(const s of [-1,1])box(g,s*1.8,2.7,2.54,1.2,1.2,.06,this.materials.white);}
  windmill(x,z){const g=new THREE.Group();g.position.set(x,this.terrainHeight(x,z),z);g.rotation.y=-.5;this.scene.add(g);mesh(new THREE.CylinderGeometry(1.1,2.4,9,10),this.materials.white,0,4.5,0,g);mesh(new THREE.ConeGeometry(1.8,2.6,10),this.materials.red,0,10,0,g);const rotor=new THREE.Group();rotor.position.set(0,8,1.2);g.add(rotor);for(let i=0;i<4;i++){const arm=new THREE.Group();arm.rotation.z=i*Math.PI/2;box(arm,0,2.5,0,.28,5.7,.15,this.materials.trunk);box(arm,.65,3,0,1.2,3,.18,this.materials.white);rotor.add(arm);}ball(rotor,0,0,.15,.5,.5,.4,this.materials.yellow);this.windmills.push(rotor);}
  buildStart(){
    const p=this.track.sample(0),g=new THREE.Group();g.position.set(p.x,p.y,p.z);g.rotation.y=p.heading;this.scene.add(g);
    for(const s of [-1,1]){mesh(new THREE.CylinderGeometry(.42,.6,8,12),this.materials.teal,s*11.5,4,0,g);ball(g,s*11.5,8.3,0,.75,.75,.75,this.materials.yellow);}
    box(g,0,7.6,0,23.7,1.7,.6,this.materials.white);const banner=mesh(new THREE.PlaneGeometry(12,1.28),label('SUNNY CUP'),0,7.65,-.32,g);banner.rotation.y=Math.PI;
    mesh(new THREE.PlaneGeometry(12,1.28),label('SUNNY CUP'),0,7.65,.32,g);
    for(let x=0;x<16;x++)for(let z=0;z<2;z++)box(g,x-7.5,.045,z*.65-.33,1,.025,.65,(x+z)%2?this.materials.dark:this.materials.white);
    for(const s of [-1,1]){const stand=box(g,s*18.5,1.5,-8,7,3,15,this.materials.white);for(let row=0;row<3;row++)box(g,s*18.5,3.4+row*.65,-8+row*2.5,7,.7,2,this.materials.teal);for(let j=0;j<6;j++)ball(g,s*18.5+(j%2?1.7:-1.7),3.6+(j%3)*.5,-12+j*1.7,.5,.65,.5,mat(PALETTE[j]));}
    this.startSample=p;
  }
  buildPickups(){this.crystals=[];const material=new THREE.MeshStandardMaterial({color:0xffd857,emissive:0xffa72b,emissiveIntensity:.25,roughness:.35,metalness:.3}),geometry=new THREE.OctahedronGeometry(.55);for(const item of (this.track.coins??[])){const p=this.track.sample(item.distance),m=mesh(geometry,material,p.x+p.nx*item.lane,p.y+1.05,p.z+p.nz*item.lane,this.scene);m.castShadow=false;this.crystals.push({mesh:m,item,baseY:p.y+1.05});}}
  fallbackKart(color=0x49b6ba,animal='fox'){
    const g=new THREE.Group(),paint=mat(color),cream=this.materials.white,tire=mat(0x283d46),orange=mat(animal==='fox'?0xf4a452:animal==='rabbit'?0xdceacb:0xf8edda);
    const body=ball(g,0,.72,.2,.94,.38,1.45,paint);body.name='KartPaint';box(g,0,.6,1.5,1.7,.21,.25,cream);box(g,0,.6,-1.3,1.8,.22,.25,cream);
    ball(g,0,.97,.8,.75,.2,.6,cream);box(g,0,1,-.4,.9,.7,.7,tire);
    const wheels=[];for(const x of [-1,1])for(const z of [-.92,.95]){const w=mesh(new THREE.CylinderGeometry(.42,.42,.38,16),tire,x,.43,z,g);w.rotation.z=Math.PI/2;wheels.push(w);const hub=mesh(new THREE.CylinderGeometry(.23,.23,.395,12),cream,x,.43,z,g);hub.rotation.z=Math.PI/2;}
    ball(g,0,1.3,-.25,.48,.6,.4,orange);ball(g,0,2,-.12,.6,.53,.5,orange);ball(g,0,1.82,.29,.44,.3,.2,cream);
    for(const s of [-1,1]){const ear=mesh(new THREE.ConeGeometry(animal==='rabbit'?.16:.25,animal==='rabbit'?.92:.65,3),orange,s*.4,2.58,-.15,g);ear.rotation.z=s*-.16;ball(g,s*.23,2.05,.34,.11,.14,.07,this.materials.dark);ball(g,s*.25,2.09,.395,.027,.035,.025,cream);}
    ball(g,0,1.85,.5,.11,.075,.07,this.materials.dark);const tail=ball(g,0,1.4,-1.04,.32,.35,.64,orange);tail.rotation.x=-.45;
    return {group:g,wheels,paint};
  }
  async createKarts(){
    for(let i=0;i<8;i++){const visual=this.fallbackKart(i===0?0x42bbbd:PALETTE[i]);const root=new THREE.Group();root.add(visual.group);this.scene.add(root);this.karts.push({...visual,root});}
    try{const loader=new GLTFLoader(),base=import.meta.env.BASE_URL;const models=await Promise.all(['models/kart.glb','models/kart-rabbit.glb','models/kart-panda.glb'].map(url=>loader.loadAsync(`${base}${url}`)));this.models={fox:optimizeModel(models[0].scene),rabbit:optimizeModel(models[1].scene),panda:optimizeModel(models[2].scene)};this.assetLoaded=true;
    }catch(e){console.warn('Model unavailable, using built-in kart',e.message);this.assetLoaded=false;}
  }
  setLineup(racers){
    for(let i=0;i<this.karts.length;i++){const r=racers[i],k=this.karts[i];if(!r)continue;
      if(this.models){const model=(this.models[r.character]??this.models.fox).clone(true),wheels=[];model.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;if(o.material?.name==='KartPaint'){o.material=o.material.clone();o.material.color.set(r.color??PALETTE[i]);}}if(o.name.startsWith('Wheel')&&o.isGroup)wheels.push(o);});k.root.remove(k.group);k.root.add(model);k.group=model;k.wheels=wheels;}
      k.lastDistance=r.distance;
    }
  }
  setCharacter(character){const color={fox:0x43b9bb,rabbit:0x88c58d,panda:0x9d88d3}[character]??0x43b9bb;this.karts[0]?.group.traverse(o=>{if(o.isMesh&&o.material?.name==='KartPaint')o.material.color.setHex(color);});}
  update(dt,race,menu=false){
    this.time+=dt;for(const rotor of this.windmills)rotor.rotation.z+=dt*.35;
    for(const c of this.crystals){c.mesh.rotation.y+=dt;c.mesh.position.y=c.baseY+Math.sin(this.time*2+c.item.distance)*.15;}
    for(let i=0;i<this.karts.length;i++){const k=this.karts[i],r=race.racers[i];if(!r)continue;const p=this.track.sample(r.distance),offset=r.offset??0;
      const target=new THREE.Vector3(p.x+p.nx*offset,p.y+.08,p.z+p.nz*offset);
      if(!k.placed||Math.abs(r.distance-(k.lastDistance??r.distance))>20){k.root.position.copy(target);k.placed=true;}else k.root.position.lerp(target,1-Math.exp(-dt*24));
      k.lastDistance=r.distance;k.root.rotation.set(-p.pitch,p.heading+(r.yaw??0),0,'YXZ');k.group.rotation.z=THREE.MathUtils.damp(k.group.rotation.z,(r.isDrifting?-.12:0)*Math.sign(r.yaw||1),8,dt);for(const w of k.wheels)w.rotation.x+=(r.speed??0)*dt*2;
      if(!menu&&(r.boost>0||r.isDrifting||r.nitroActive)&&Math.random()<.7)this.spark(k.root.position,r.nitroActive?0x6eeaff:r.boost>0?0xffdd62:0x64d8ff,p,r.isDrifting);
    }
    for(let i=this.particles.length-1;i>=0;i--){const a=this.particles[i];a.life-=dt;a.mesh.position.addScaledVector(a.velocity,dt);a.mesh.scale.setScalar(Math.max(.01,a.life*1.1));if(a.life<=0){this.scene.remove(a.mesh);a.mesh.geometry.dispose();a.mesh.material.dispose();this.particles.splice(i,1);}}
    const overview=menu&&this.overview,overviewFit=overview?Math.max(1,1.15/this.camera.aspect):1;this.scene.fog.near=overview?1100*overviewFit:330;this.scene.fog.far=overview?2700*overviewFit:1250;this.camera.near=overview?5:.2;this.camera.far=overview?2400*overviewFit:1900;
    if(overview){const b=this.track.bounds,t=this.time*.035-.6,fit=overviewFit,scale=this.track.mapScale/636;
      const eye=new THREE.Vector3(b.centerX+Math.sin(t)*750*fit*scale,540*fit*scale,b.centerZ+Math.cos(t)*750*fit*scale);
      this.camera.position.lerp(eye,1-Math.exp(-dt*3));this.camera.lookAt(b.centerX,12,b.centerZ);this.camera.fov=48;
    }else if(menu){const p=this.startSample;const hero=this.karts[0]?.root.position??new THREE.Vector3(p.x,p.y,p.z);const t=this.time*.13;
      const eye=new THREE.Vector3(hero.x+p.tx*8.5+p.nx*(8+Math.sin(t)*.8),hero.y+5.4,hero.z+p.tz*8.5+p.nz*(8+Math.sin(t)*.8));
      const screenRight=new THREE.Vector3(eye.z-hero.z,0,hero.x-eye.x).normalize();const focus=hero.clone().add(new THREE.Vector3(0,1.2,0)).addScaledVector(screenRight,this.camera.aspect>1.3?-3.9:0);
      this.camera.position.lerp(eye,1-Math.exp(-dt*3));this.camera.lookAt(focus);this.camera.fov=cameraFov(48,this.camera.aspect);
    }else{const r=race.player,framing=chaseFraming(this.viewport,r.speed),ahead=this.track.sample(r.distance+framing.ahead),eye=chaseEye(this.track,r.distance,r.offset,framing),back=new THREE.Vector3(eye.x,eye.y,eye.z),snap=framing.relativeToPlayer&&(this.wasMenu||this.resetChase);
      if(snap)this.camera.position.copy(back);else this.camera.position.lerp(back,1-Math.exp(-dt*6));this.camera.lookAt(ahead.x+ahead.nx*r.offset*.65,ahead.y+framing.targetHeight,ahead.z+ahead.nz*r.offset*.65);const targetFov=cameraFov(53+(r.speed??0)*.17,this.camera.aspect);this.camera.fov=snap?targetFov:THREE.MathUtils.damp(this.camera.fov,targetFov,4,dt);this.resetChase=false;
    }
    const focus=menu?this.karts[0]?.root.position:this.karts[race.racers.indexOf(race.player)]?.root.position;
    if(focus){this.sun.target.position.copy(focus);this.sun.position.set(focus.x-80,focus.y+145,focus.z-65);this.sun.target.updateMatrixWorld();}
    this.wasMenu=menu;this.camera.updateProjectionMatrix();this.renderer.render(this.scene,this.camera);
  }
  spark(position,color,p,drift){if(this.particles.length>100)return;const m=mesh(new THREE.SphereGeometry(.16,5,4),new THREE.MeshBasicMaterial({color}),position.x-p.tx*1.3,position.y+.35,position.z-p.tz*1.3,this.scene);m.castShadow=false;this.particles.push({mesh:m,life:.35+Math.random()*.25,velocity:new THREE.Vector3((Math.random()-.5)*3-p.tx*3,Math.random()*2,-p.tz*3+(Math.random()-.5)*3)});}
}
