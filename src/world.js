import * as THREE from 'three';
import { ItemObjectView } from './item-objects.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { optimizeModel } from './optimize-model.js';
import { ModelCache } from './model-cache.js';
import { AdaptiveQuality } from './performance.js';
import { isPickupCollected } from './game/items.js';
import { createTerrainSampler, MAP_LAYOUT } from './game/map-layout.js';
import { viewportProfile, cameraFov, chaseFraming, chaseEye } from './viewport.js';

const PALETTE = [0xf59e42, 0x41bfa2, 0x9982df, 0xf4ce51, 0xef718c, 0x54b4df, 0xdba16b, 0x7bbd66];
const THEMES = {
  'sunny-island': { sky:0xb8e9f5, sea:0x62c9d4, green:0x8acb70, sand:0xf3dfa3, deep:0x58c4c9, high:0x7eb78d, hemisphere:0xc7f2ff, ground:0xa9b887, sun:0xfff1cc, exposure:1.18, banner:'SUNNY CUP', colors:{} },
  'candy-hills': { sky:0xf6dced, sea:0xd9a9d1, green:0xa5d9b1, sand:0xffe1ae, deep:0xc7a9dc, high:0xf5a6ca, hemisphere:0xffedf7, ground:0xbebf9a, sun:0xffedcc, exposure:1.13, banner:'SWEET CUP', colors:{grass:0xa5d9b1,road:0x897788,red:0xf58ea7,sand:0xffe1ae,trunk:0xffe9c8,leaf:0xf3a3c5,leaf2:0xa0dfcd,teal:0x8bcdb9,yellow:0xffdc86} },
  'bay-loop': { sky:0xb3eaf9, sea:0x29bdcf, green:0x8fd184, sand:0xffe5ad, deep:0x27b8c6, high:0x6dbd9e, hemisphere:0xd5f8ff, ground:0xb3c493, sun:0xffefcc, exposure:1.16, banner:'BAY GRAND PRIX', colors:{grass:0x8fd184,road:0x6a8085,red:0xffa06b,sand:0xffe5ad,leaf:0x45b68d,leaf2:0x96d894,teal:0x26b8c6,yellow:0xffd772} },
  'starlight-canyon': { sky:0x242e53, sea:0x344c81, green:0x7688a7, sand:0xc3acce, deep:0x394f83, high:0x9f83b3, hemisphere:0xc3d6ff, ground:0x797798, sun:0xd4dcff, exposure:1.18, banner:'STARLIGHT CUP', colors:{grass:0x8996af,road:0x8795ae,white:0xfff0d8,red:0xc29ce5,sand:0xc3acce,trunk:0x8585a8,leaf:0xa5a0d2,leaf2:0x91b6cd,teal:0x8abed6,yellow:0xffdfa0} },
};
const mat = (color, roughness = .72) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
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

function resources(roots) {
  const geometries=new Set(),materials=new Set(),textures=new Set();
  for(const root of roots.filter(Boolean))root.traverse(object=>{
    if(object.geometry)geometries.add(object.geometry);
    for(const material of Array.isArray(object.material)?object.material:[object.material])if(material){
      materials.add(material);
      for(const value of Object.values(material))if(value?.isTexture)textures.add(value);
    }
  });
  return {geometries,materials,textures};
}
function releaseResources(roots,extraMaterials=[],retained={}) {
  const found=resources(roots);
  for(const material of extraMaterials)found.materials.add(material);
  for(const texture of found.textures)if(!retained.textures?.has(texture))texture.dispose();
  for(const geometry of found.geometries)if(!retained.geometries?.has(geometry))geometry.dispose();
  for(const material of found.materials)if(!retained.materials?.has(material))material.dispose();
}
const kartModels = new ModelCache(async base => {
  const loader=new GLTFLoader();
  const results=await Promise.allSettled(['models/kart.glb','models/kart-rabbit.glb','models/kart-panda.glb'].map(url=>loader.loadAsync(`${base}${url}`)));
  const sources=results.filter(result=>result.status==='fulfilled').map(result=>result.value.scene);
  if(results.some(result=>result.status==='rejected')) { releaseResources(sources); throw new Error('Kart assets unavailable'); }
  const models={};
  try {
    for(const [i,character] of ['fox','rabbit','panda'].entries()){
      await new Promise(resolve=>setTimeout(resolve,0));
      models[character]=optimizeModel(sources[i]);
    }
    for(const geometry of resources(sources).geometries)geometry.dispose();
    return {models,resources:resources(Object.values(models))};
  } catch(error) { releaseResources([...sources,...Object.values(models)]); throw error; }
});

function starGeometry() {
  const shape=new THREE.Shape();
  for(let i=0;i<10;i++){const a=i*Math.PI/5+Math.PI/2,r=i%2?.47:1,x=Math.cos(a)*r,y=Math.sin(a)*r;i?shape.lineTo(x,y):shape.moveTo(x,y);}
  shape.closePath();return new THREE.ExtrudeGeometry(shape,{depth:.2,steps:1,bevelEnabled:false});
}

export class World {
  constructor(canvas,track,{createRenderer=options=>new THREE.WebGLRenderer(options),modelCache=kartModels}={}) {
    this.modelCache=modelCache;this.track=track;this.theme=THEMES[track.theme]??THEMES[track.id]??THEMES['sunny-island'];this.themeId=THEMES[track.theme]?track.theme:THEMES[track.id]?track.id:'sunny-island';this.disposed=false;
    this.time=0; this.adaptive=new AdaptiveQuality();this.frameStats={};this.ready=Promise.resolve();this.particlePool=[];this.scratch={target:new THREE.Vector3(),eye:new THREE.Vector3(),right:new THREE.Vector3(),focus:new THREE.Vector3()}; this.overview=false; this.karts=[]; this.windmills=[]; this.clouds=[]; this.particles=[];this.graphicsQuality='auto';
    this.terrainSampler=createTerrainSampler(track);
    this.renderer=createRenderer({canvas,antialias:true,powerPreference:'high-performance'});
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=this.theme.exposure;
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color(this.theme.sky);
    this.scene.fog=new THREE.Fog(this.theme.sky,330,1250);
    this.camera=new THREE.PerspectiveCamera(52,1,.15,1900);
    this.scene.add(new THREE.HemisphereLight(this.theme.hemisphere,this.theme.ground,2.25));
    const sun=new THREE.DirectionalLight(this.theme.sun,this.themeId==='starlight-canyon'?2.4:3.1);sun.position.set(-65,130,-45);sun.castShadow=true;
    sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-78;sun.shadow.camera.right=78;
    sun.shadow.camera.top=78;sun.shadow.camera.bottom=-78;sun.shadow.camera.far=390;
    sun.shadow.normalBias=.055;sun.shadow.bias=-.0002;this.scene.add(sun);this.scene.add(sun.target);this.sun=sun;
    this.materials={grass:mat(0x83c56b),road:mat(0x627178),white:mat(0xfff7dd),red:mat(0xf28364),sand:mat(0xf1dfaa),dark:mat(0x203e49),trunk:mat(0x9f7760),leaf:mat(0x52aa64),leaf2:mat(0x91ca69),yellow:mat(0xffdf69),teal:mat(0x46bba9)};
    for(const [key,color] of Object.entries(this.theme.colors))this.materials[key].color.setHex(color);
    this.buildIsland();this.buildRoad();this.buildBridge();this.buildScenery();this.buildStart();this.buildPickups();
    this.resize();const start=this.track.sample(0);this.camera.position.set(start.x+start.tx*8.5+start.nx*8,start.y+5.4,start.z+start.tz*8.5+start.nz*8);this.camera.lookAt(start.x,start.y+1.2,start.z);
    this.queueResize=()=>{if(this.disposed||this.resizeRequest)return;this.resizeRequest=requestAnimationFrame(()=>{this.resizeRequest=0;if(!this.disposed)this.resize();});};
    window.addEventListener('resize',this.queueResize);window.addEventListener('orientationchange',this.queueResize);
    window.visualViewport?.addEventListener('resize',this.queueResize);
    document.addEventListener('fullscreenchange',this.queueResize);document.addEventListener('webkitfullscreenchange',this.queueResize);
    if(typeof ResizeObserver!=='undefined'){this.canvasResize=new ResizeObserver(this.queueResize);this.canvasResize.observe(canvas);}
  }
  resize(){
    if(this.disposed)return;
    const profile=viewportProfile({rect:this.renderer.domElement.getBoundingClientRect(),visualViewport:window.visualViewport||{},width:innerWidth,height:innerHeight,pixelRatio:window.devicePixelRatio||1,touch:Boolean(window.matchMedia?.('(any-pointer: coarse)').matches||navigator.maxTouchPoints>0),quality:this.graphicsQuality});
    if(this.graphicsQuality==='auto'&&this.adaptive.level>0){
      profile.pixelRatio=Math.min(profile.pixelRatio,this.adaptive.level===1?1:.75);
      profile.shadowSize=512;
    }
    this.renderer.shadowMap.enabled=this.graphicsQuality==='sharp'||(this.graphicsQuality==='auto'&&this.adaptive.level<2);
    const previous=this.viewport;
    if(previous&&previous.width===profile.width&&previous.height===profile.height&&previous.pixelRatio===profile.pixelRatio&&previous.shadowSize===profile.shadowSize)return;
    if(previous?.pixelRatio!==profile.pixelRatio)this.renderer.setPixelRatio(profile.pixelRatio);
    if(!previous||previous.width!==profile.width||previous.height!==profile.height)this.renderer.setSize(profile.width,profile.height,false);
    if(!previous||chaseFraming(previous).relativeToPlayer!==chaseFraming(profile).relativeToPlayer)this.resetChase=true;
    this.camera.aspect=profile.aspect;this.camera.updateProjectionMatrix();this.viewport=profile;
    if(this.sun&&this.sun.shadow.mapSize.x!==profile.shadowSize){this.sun.shadow.mapSize.set(profile.shadowSize,profile.shadowSize);this.sun.shadow.map?.dispose();this.sun.shadow.map=null;this.sun.shadow.needsUpdate=true;}
  }
  setGraphicsQuality(mode){this.graphicsQuality=['auto','smooth','sharp'].includes(mode)?mode:'auto';this.adaptive.reset();this.resize();}
  nearest(x,z){return this.terrainSampler.nearest(x,z);}
  terrainHeight(x,z){return this.terrainSampler.terrainHeight(x,z);}
  buildIsland(){
    const seaGeo=new THREE.PlaneGeometry(4000,4000);seaGeo.rotateX(-Math.PI/2);
    this.sea=mesh(seaGeo,mat(this.theme.sea,.3),0,-.55,0,this.scene);this.sea.receiveShadow=false;
    const {width,depth,chunksX,chunksZ,segments}=MAP_LAYOUT.terrain;
    const green=new THREE.Color(this.theme.green),sand=new THREE.Color(this.theme.sand),deep=new THREE.Color(this.theme.deep),high=new THREE.Color(this.theme.high);
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
    const verge=mat(this.themeId==='sunny-island'?0x70b16a:this.theme.green);this.ribbon(-11.6,-half,-.045,verge);this.ribbon(half,11.6,-.045,verge);this.ribbon(-half,half,.01,this.materials.road);
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
    const length=this.track.length,zone=this.track.zones.find(zone=>zone.kind==='bridge');
    if(!zone)return;
    const themed=this.themeId!=='sunny-island',start=themed?zone.start+(zone.end-zone.start)*.04:.713*length,end=themed?zone.end-(zone.end-zone.start)*.05:.829*length;
    this.ribbon(-11.55,11.55,-.25,this.materials.white,start,end);
    const supports=[];
    for(let d=start;d<end;d+=17){const p=this.track.sample(d);for(const s of [-1,1])supports.push({x:p.x+p.nx*10.4*s,y:(p.y-3)/2,z:p.z+p.nz*10.4*s,sx:1.2,sy:p.y+3,sz:1.35});}
    this.instances(new THREE.BoxGeometry(1,1,1),mat(0xabc6bc),supports);
    const a=themed?start+(end-start)*.18:.735*length,b=themed?end-(end-start)*.18:.808*length;
    for(const d of [a,b]){const p=this.track.sample(d),g=new THREE.Group();g.position.set(p.x,p.y,p.z);g.rotation.y=p.heading;this.scene.add(g);for(const s of [-1,1]){box(g,s*11,9.5,0,1.5,20,1.8,this.materials.teal);ball(g,s*11,20,0,1,1,1,this.materials.yellow);}box(g,0,16.5,0,22,1.2,1.4,this.materials.teal);}
    for(const s of [-1,1]){const points=[],hangers=[];for(let i=0;i<=32;i++){const t=i/32,p=this.track.sample(a+(b-a)*t),height=3+16*(2*t-1)**2;points.push(new THREE.Vector3(p.x+p.nx*11*s,p.y+height,p.z+p.nz*11*s));if(i%2===0)hangers.push({x:p.x+p.nx*11*s,y:p.y+(height+1.25)/2,z:p.z+p.nz*11*s,sx:.1,sy:height-1.25,sz:.1});}const curve=new THREE.CatmullRomCurve3(points);mesh(new THREE.TubeGeometry(curve,100,.11,5,false),this.materials.white,0,0,0,this.scene);this.instances(new THREE.BoxGeometry(1,1,1),this.materials.white,hangers);}
  }
  buildScenery(){
    if(this.themeId!=='sunny-island'){this.buildThemedScenery();this.buildRouteSigns();return;}
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
    this.buildRouteSigns();
  }
  buildRouteSigns(){
    for(let d=35;d<this.track.length;d+=54){const p=this.track.sample(d);if(Math.abs(p.curvature)<.006)continue;const side=p.curvature>0?-1:1,g=new THREE.Group();g.position.set(p.x+p.nx*13.2*side,p.y,p.z+p.nz*13.2*side);g.rotation.y=p.heading;this.scene.add(g);box(g,0,1.6,0,.18,3.2,.18,this.materials.dark);box(g,0,3.1,0,3.2,1.3,.18,this.materials.yellow);for(let j=-1;j<=1;j++){const sign=box(g,j*.75,3.1,-.11,.18,.85,.025,this.materials.dark);sign.rotation.z=(p.curvature>0?1:-1)*-.55;}}
    for(const zone of this.track.zones.slice(1)){const p=this.track.sample(zone.start+18),g=new THREE.Group();g.position.set(p.x+p.nx*15,p.y,p.z+p.nz*15);g.rotation.y=p.heading;this.scene.add(g);box(g,0,2.8,0,.24,5.6,.24,this.materials.dark);box(g,0,4.7,0,7,1.8,.2,this.materials.white);mesh(new THREE.PlaneGeometry(6.6,1.5),label(zone.name),0,4.7,-.12,g).rotation.y=Math.PI;mesh(new THREE.PlaneGeometry(6.6,1.5),label(zone.name),0,4.7,.12,g);}
  }
  buildThemedScenery(){
    let seed={ 'candy-hills':8241,'bay-loop':48125,'starlight-canyon':19271 }[this.themeId];
    const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
    const roundGeo=new THREE.SphereGeometry(1,10,7),stemGeo=new THREE.CylinderGeometry(.32,.46,1,7),crystalGeo=new THREE.OctahedronGeometry(1),rockGeo=new THREE.DodecahedronGeometry(1,0);
    const stems=[],round=[],alternate=[],leaves=[],rocks=[],flowers=[];
    const candy=this.themeId==='candy-hills',night=this.themeId==='starlight-canyon';
    // Decorations use the nearest road, not only their source sample, so close
    // neighbouring turns retain a clear, consistent driving corridor.
    for(let i=0;i<260;i++){
      const p=this.track.sample(random()*this.track.length),side=random()>.5?1:-1,k=(19+random()*62)*side,x=p.x+p.nx*k,z=p.z+p.nz*k,near=this.nearest(x,z),h=this.terrainSampler.terrainHeight(x,z,near);
      if(h<.7||near.d<17)continue;
      const size=.8+random()*1.3;
      if(candy){
        stems.push({x,y:h+3.1*size,z,sx:.9*size,sy:6.2*size,sz:.9*size});
        (i%2?round:alternate).push({x,y:h+6.9*size,z,sx:2.7*size,sy:2.7*size,sz:1.1*size,ry:p.heading+random()});
        if(i%4===0)leaves.push({x,y:h+6.9*size,z,sx:2.9*size,sy:2.9*size,sz:1.1*size,ry:p.heading+.5});
      }else if(night){
        (i%2?round:alternate).push({x,y:h+3.4*size,z,sx:1.8*size,sy:5.2*size,sz:1.8*size,ry:random()*6});
        if(i%3===0)rocks.push({x:x+2.1,y:h+2.2*size,z:z+.8,sx:2.8*size,sy:3.1*size,sz:2.7*size,ry:random()*6});
      }else{
        stems.push({x,y:h+4.2*size,z,sx:.8*size,sy:8.4*size,sz:.8*size,rz:side*.075});
        for(let j=0;j<5;j++){const a=j/5*Math.PI*2;leaves.push({x:x+Math.sin(a)*2.2*size,y:h+8.4*size,z:z+Math.cos(a)*2.2*size,sx:1.1*size,sy:.25*size,sz:3.6*size,ry:a,rx:.18});}
        if(i%3===0)rocks.push({x:x+2,y:h+.8*size,z:z+2,sx:1.7*size,sy:1.1*size,sz:1.7*size});
      }
    }
    if(candy){
      this.instances(stemGeo,this.materials.white,stems);
      this.instances(roundGeo,this.materials.leaf,round);this.instances(roundGeo,this.materials.leaf2,alternate);
      this.instances(new THREE.TorusGeometry(1,.12,5,16),this.materials.white,leaves);
      for(const [i,u] of [.12,.36,.58,.9].entries())this.buildThemeGate(u,i);
      const scoops=[],bases=[],sprinkles=[];
      for(let i=0;i<24;i++){
        const p=this.track.sample((i+.4)/24*this.track.length),side=i%2?1:-1,k=43+(i%3)*13,x=p.x+p.nx*k*side,z=p.z+p.nz*k*side,near=this.nearest(x,z),h=this.terrainSampler.terrainHeight(x,z,near);
        if(h<.7||near.d<30)continue;
        const size=3.5+i%3;bases.push({x,y:h+size*.7,z,sx:size,sy:size*1.4,sz:size});
        scoops.push({x,y:h+size*1.6,z,sx:size*1.15,sy:size*.85,sz:size*1.15});
        sprinkles.push({x:x+.6,y:h+size*2.4,z,sx:.45,sy:.45,sz:.45});
      }
      this.instances(new THREE.CylinderGeometry(.8,1,1,9),this.materials.sand,bases);
      this.instances(roundGeo,this.materials.leaf,scoops);this.instances(roundGeo,this.materials.red,sprinkles);
    }else if(night){
      const glow=new THREE.MeshStandardMaterial({color:0x93d7ef,emissive:0x4f9cd3,emissiveIntensity:.55,roughness:.45});
      const lavender=new THREE.MeshStandardMaterial({color:0xc7a9ef,emissive:0x8972b9,emissiveIntensity:.35,roughness:.55});
      this.instances(crystalGeo,glow,round);this.instances(crystalGeo,lavender,alternate);this.instances(rockGeo,mat(0x777b9c),rocks);
      const towers=[];
      for(let i=0;i<42;i++){
        const p=this.track.sample((i+.2)/42*this.track.length),side=i%2?1:-1,k=48+(i%4)*10,x=p.x+p.nx*k*side,z=p.z+p.nz*k*side,near=this.nearest(x,z),h=this.terrainSampler.terrainHeight(x,z,near);
        if(near.d<36||h<.5)continue;
        const height=16+i%5*5;towers.push({x,y:h+height*.42,z,sx:5+i%4,sy:height*.6,sz:5+i%3,ry:i*.7});
      }
      this.instances(rockGeo,mat(0x8c86a8),towers);
      const stars=[];for(let i=0;i<120;i++){const a=random()*Math.PI*2,r=410+random()*380,size=.7+random()*1.4;stars.push({x:Math.cos(a)*r,y:90+random()*175,z:Math.sin(a)*r,sx:size,sy:size,sz:.5,ry:a});}
      this.instances(starGeometry(),new THREE.MeshBasicMaterial({color:0xffe7af,side:THREE.DoubleSide}),stars,false);
      const moon=mesh(new THREE.SphereGeometry(23,16,12),new THREE.MeshBasicMaterial({color:0xffefd0}),this.track.bounds.centerX+250,150,this.track.bounds.centerZ-380,this.scene);moon.castShadow=false;
      for(const [i,u] of [.16,.42,.65,.91].entries())this.buildThemeGate(u,i);
    }else{
      this.instances(stemGeo,this.materials.trunk,stems);this.instances(roundGeo,this.materials.leaf,leaves);this.instances(rockGeo,mat(0xbad5c4),rocks);
      this.buildCoastLandmarks();
      for(let i=0;i<22;i++){
        const p=this.track.sample((i+.3)/22*this.track.length),side=i%2?1:-1,k=24+i%3*7,x=p.x+p.nx*k*side,z=p.z+p.nz*k*side,near=this.nearest(x,z),h=this.terrainSampler.terrainHeight(x,z,near);
        if(h<1||near.d<19)continue;
        this.beachHut(x,h,z,p.heading,[0xffc07c,0x8acfd7,0xf3b7c2,0xc8dc9b][i%4]);
      }
      const floats=[],caps=[];
      for(let i=0;i<55;i++){
        const p=this.track.sample((i+.2)/55*this.track.length),side=i%2?1:-1,k=28+i%5*9,x=p.x+p.nx*k*side,z=p.z+p.nz*k*side,near=this.nearest(x,z);
        if(near.d<23||this.terrainSampler.terrainHeight(x,z,near)>-.65)continue;
        floats.push({x,y:.1,z,sx:1.25,sy:1,sz:1.25});caps.push({x,y:1.15,z,sx:.7,sy:1.5,sz:.7});
      }
      this.instances(new THREE.TorusGeometry(1,.3,6,12),this.materials.white,floats.map(p=>({...p,rx:Math.PI/2})));
      this.instances(new THREE.ConeGeometry(1,1,7),this.materials.red,caps);
      for(const [i,u] of [.1,.38,.62,.9].entries())this.buildThemeGate(u,i);
    }
    if(!night){
      const clouds=[];for(let i=0;i<20;i++){const a=i/20*Math.PI*2,r=470+random()*220,y=90+random()*75;for(let j=0;j<3;j++)clouds.push({x:Math.cos(a)*r+(j-1)*14,y:y+(j%2)*5,z:Math.sin(a)*r,sx:17,sy:9+random()*6,sz:12});}
      this.instances(roundGeo,new THREE.MeshBasicMaterial({color:candy?0xfff1ed:0xfffdf3}),clouds,false);
    }
    for(let i=0;i<380;i++){
      const p=this.track.sample(random()*this.track.length),k=(14+random()*10)*(i%2?1:-1),x=p.x+p.nx*k,z=p.z+p.nz*k,near=this.nearest(x,z),h=this.terrainSampler.terrainHeight(x,z,near);
      if(h<.8||near.d<13.5)continue;flowers.push({x,y:h+.35,z,sx:.3,sy:night?.65:.35,sz:.3,ry:random()*6});
    }
    this.instances(night?crystalGeo:roundGeo,this.materials.yellow,flowers,false);
    // A geometry that generated no instances never belongs to the scene.
    for(const geometry of [roundGeo,stemGeo,crystalGeo,rockGeo])if(![...this.scene.children].some(object=>object.geometry===geometry))geometry.dispose();
  }
  buildThemeGate(fraction,index){
    const p=this.track.sample(fraction*this.track.length);
    if(Math.abs(p.curvature)>.035)return;
    const g=new THREE.Group();g.position.set(p.x,p.y,p.z);g.rotation.set(-p.pitch,p.heading,0,'YXZ');this.scene.add(g);
    const candy=this.themeId==='candy-hills',night=this.themeId==='starlight-canyon';
    if(candy||night){
      for(const side of [-1,1])mesh(new THREE.CylinderGeometry(.7,.9,8,8),this.materials.white,side*13,4,0,g);
      const arch=mesh(new THREE.TorusGeometry(13,.7,6,36,Math.PI),candy?this.materials.red:this.materials.teal,0,8,0,g);arch.castShadow=false;
      if(night){const star=mesh(starGeometry(),new THREE.MeshStandardMaterial({color:0xffdf8e,emissive:0xffb95e,emissiveIntensity:.6}),0,22.1,0,g);star.scale.setScalar(2);}
      else for(const side of [-1,1])ball(g,side*13,8,0,1.4,1.4,1.4,index%2?this.materials.leaf:this.materials.leaf2);
    }else{
      for(const side of [-1,1]){mesh(new THREE.CylinderGeometry(.38,.45,11,8),this.materials.white,side*13.5,5.5,0,g);const flag=mesh(new THREE.ConeGeometry(2.2,4,3),index%2?this.materials.red:this.materials.yellow,side*13.5,11,0,g);flag.scale.z=.09;}
      box(g,0,9.7,0,28,.45,.5,this.materials.teal);
      for(let i=-5;i<=5;i++){const pennant=mesh(new THREE.ConeGeometry(.55,1.3,3),i%2?this.materials.red:this.materials.yellow,i*2.2,8.85,0,g);pennant.rotation.z=Math.PI;pennant.scale.z=.08;}
    }
  }
  beachHut(x,y,z,heading,color){
    const g=new THREE.Group();g.position.set(x,y,z);g.rotation.y=heading;this.scene.add(g);
    const paint=mat(color);box(g,0,1.8,0,4.8,3.6,4.2,paint);
    const roof=mesh(new THREE.ConeGeometry(4.1,1.7,4),this.materials.white,0,4.2,0,g);roof.rotation.y=Math.PI/4;
    for(const side of [-1,1])box(g,side*1.7,2,2.13,.65,2.7,.08,this.materials.white);
    box(g,0,1.3,2.15,1.2,2.6,.09,this.materials.teal);
    box(g,0,.2,3.2,5.5,.4,2.8,this.materials.sand);
    box(g,-3.2,1.2,1.5,.45,2.4,1.6,this.materials.red).rotation.z=-.17;
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
    box(g,0,7.6,0,23.7,1.7,.6,this.materials.white);const bannerMaterial=label(this.theme.banner);const banner=mesh(new THREE.PlaneGeometry(12,1.28),bannerMaterial,0,7.65,-.32,g);banner.rotation.y=Math.PI;
    mesh(new THREE.PlaneGeometry(12,1.28),bannerMaterial,0,7.65,.32,g);
    for(let x=0;x<16;x++)for(let z=0;z<2;z++)box(g,x-7.5,.045,z*.65-.33,1,.025,.65,(x+z)%2?this.materials.dark:this.materials.white);
    for(const s of [-1,1]){const stand=box(g,s*18.5,1.5,-8,7,3,15,this.materials.white);for(let row=0;row<3;row++)box(g,s*18.5,3.4+row*.65,-8+row*2.5,7,.7,2,this.materials.teal);for(let j=0;j<6;j++)ball(g,s*18.5+(j%2?1.7:-1.7),3.6+(j%3)*.5,-12+j*1.7,.5,.65,.5,mat(PALETTE[j]));}
    this.startSample=p;
  }
  buildPickups(){
    this.itemObjectView=new ItemObjectView(this.scene,this.track);
    this.crystals=[];this.itemVisuals=[];
    const material=new THREE.MeshStandardMaterial({color:0xffd857,emissive:0xffa72b,emissiveIntensity:.4,roughness:.35,metalness:.3}),geometry=new THREE.OctahedronGeometry(.55);
    for(const item of (this.track.coins??[])){
      const p=this.track.sample(item.distance),m=mesh(geometry,material,p.x+p.nx*item.lane,p.y+1.05,p.z+p.nz*item.lane,this.scene);m.castShadow=false;
      this.crystals.push({mesh:m,item,baseY:p.y+1.05,stamp:undefined,hidden:false});
    }
  }
  buildItemBoxes(items){
    const geometry=new THREE.BoxGeometry(1.15,1.15,1.15);
    for(const item of items){
      const colors={shield:0x80dcff,magnet:0xf49bcf,rocket:0xffb14f,bubble:0x8fb9ff,jelly:0xb59aee},color=colors[item.type]??[0x80dcff,0xf49bcf,0xffb14f,0xb59aee][this.itemVisuals.length%4],material=new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:.25,roughness:.25});
      const p=this.track.sample(item.distance),group=new THREE.Group();group.position.set(p.x+p.nx*item.lane,p.y+1.2,p.z+p.nz*item.lane);this.scene.add(group);
      const cube=mesh(geometry,material,0,0,0,group);cube.castShadow=false;
      // A bright star on both sides makes a box distinct from nitro crystals.
      const icon=label({shield:'◇',magnet:'U',rocket:'↑'}[item.type]??'?', '#ffffff', '#163c55',128,128);
      for(const z of [-.59,.59]){const face=mesh(new THREE.PlaneGeometry(.84,.84),icon,0,0,z,group);if(z<0)face.rotation.y=Math.PI;face.castShadow=false;}
      this.itemVisuals.push({mesh:group,item,baseY:p.y+1.2,stamp:undefined,hidden:false});
    }
  }
  updatePickups(dt,race,menu){
    if(this.pickupRace!==race||(race.phase==='countdown'&&this.pickupPhase!=='countdown')){
      this.clearParticles();
      for(const c of [...this.crystals,...this.itemVisuals]){c.stamp=undefined;c.hidden=false;c.mesh.visible=true;}
      this.pickupRace=race;
    }
    this.pickupPhase=race.phase;
    if(this.itemRace!==race){
      for(const c of this.itemVisuals){this.scene.remove(c.mesh);releaseResources([c.mesh]);}
      this.itemVisuals=[];this.itemRace=race;
      if(race.itemBoxes?.length)this.buildItemBoxes(race.itemBoxes);
    }
    const update=(c,item)=>{
      const collection=item?race.player.itemCollected:race.player.collectedLaps;
      const stamp=collection?.[c.item.id];
      const hidden=!menu&&isPickupCollected(race.player,c.item.id,this.track,item);
      if(hidden&&!c.hidden&&stamp!==c.stamp&&race.phase==='racing')this.pickupBurst(c.mesh.position,item?0x9ce9ff:0xffdf6d,race.player);
      c.stamp=stamp;c.hidden=hidden;c.mesh.visible=!hidden;
      if(!hidden){c.mesh.rotation.y+=dt*(item ? .8 : 1.5);c.mesh.position.y=c.baseY+Math.sin(this.time*2+c.item.distance)*.15;}
    };
    for(const c of this.crystals)update(c,false);
    for(const c of this.itemVisuals)update(c,true);
  }
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
  async createKarts({progressive=false}={}){
    if(this.disposed)return;
    if(this.karts.length)return progressive?undefined:this.ready;
    for(let i=0;i<8;i++){
      const visual=this.fallbackKart(i===0?0x42bbbd:PALETTE[i]),owned=resources([visual.group]);
      for(const material of Object.values(this.materials))owned.materials.delete(material);
      const root=new THREE.Group();root.add(visual.group);this.scene.add(root);this.karts.push({...visual,root,owned});
    }
    this.ready=this.modelCache.get(import.meta.env?.BASE_URL??'/').then(entry=>{
      if(this.disposed)return;
      this.models=entry.models;this.sharedModelResources=entry.resources;this.assetLoaded=true;
      if(this.lineup)this.setLineup(this.lineup);
    }).catch(error=>{if(!this.disposed){this.assetLoaded=false;console.warn('Model unavailable, using built-in kart',error.message);}});
    return progressive?undefined:this.ready;
  }
  setLineup(racers){
    if(this.disposed)return;this.lineup=racers;
    for(let i=0;i<this.karts.length;i++){const r=racers[i],k=this.karts[i];k.root.visible=Boolean(r);if(!r)continue;
      if(this.models&&(k.character!==r.character||k.color!==r.color)){
        const model=(this.models[r.character]??this.models.fox).clone(true),wheels=[],owned={geometries:new Set(),materials:new Set(),textures:new Set()};
        model.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;const recolor=material=>{if(material?.name!=='KartPaint')return material;const paint=material.clone();paint.color.set(r.color??PALETTE[i]);owned.materials.add(paint);return paint;};o.material=Array.isArray(o.material)?o.material.map(recolor):recolor(o.material);}if(o.name.startsWith('Wheel')&&o.isGroup)wheels.push(o);});
        k.root.remove(k.group);for(const geometry of k.owned.geometries)geometry.dispose();for(const material of k.owned.materials)material.dispose();
        k.root.add(model);k.group=model;k.wheels=wheels;k.owned=owned;k.character=r.character;k.color=r.color;
      }
      k.lastDistance=r.distance;
    }
  }
  setCharacter(character){const color={fox:0x43b9bb,rabbit:0x88c58d,panda:0x9d88d3}[character]??0x43b9bb;this.karts[0]?.group.traverse(o=>{if(o.isMesh&&o.material?.name==='KartPaint')o.material.color.setHex(color);});}
  update(dt,race,menu=false,rawFrameMs=dt*1000){
    if(this.disposed)return;
    const qualityChanged=!document.hidden&&this.adaptive.sample(rawFrameMs/1000);
    if(this.graphicsQuality==='auto'&&qualityChanged)this.resize();
    this.time+=dt;for(const rotor of this.windmills)rotor.rotation.z+=dt*.35;
    this.itemObjectView?.update(race,this.time,menu);
    this.updatePickups(dt,race,menu);
    for(let i=0;i<this.karts.length;i++){const k=this.karts[i],r=race.racers[i];k.root.visible=Boolean(r);if(!r)continue;const p=this.track.sample(r.distance),offset=r.offset??0;
      const target=this.scratch.target.set(p.x+p.nx*offset,p.y+.08,p.z+p.nz*offset);
      if(!k.placed||Math.abs(r.distance-(k.lastDistance??r.distance))>20){k.root.position.copy(target);k.placed=true;}else k.root.position.lerp(target,1-Math.exp(-dt*24));
      k.lastDistance=r.distance;k.root.rotation.set(-p.pitch,p.heading+(r.yaw??0),0,'YXZ');k.group.rotation.z=THREE.MathUtils.damp(k.group.rotation.z,(r.isDrifting?-.12:0)*Math.sign(r.yaw||1),8,dt);for(const w of k.wheels)w.rotation.x+=(r.speed??0)*dt*2;
      if(!k.effects){
        this.effectAssets??={shieldGeometry:new THREE.SphereGeometry(2.05,16,10),magnetGeometry:new THREE.TorusGeometry(2,.06,5,28),shieldMaterial:new THREE.MeshBasicMaterial({color:0x7fdfff,transparent:true,opacity:.2,depthWrite:false}),magnetMaterial:new THREE.MeshBasicMaterial({color:0xff9ed9,transparent:true,opacity:.65})};
        const shield=mesh(this.effectAssets.shieldGeometry,this.effectAssets.shieldMaterial,0,1.2,0,k.root);shield.scale.y=.8;shield.castShadow=false;
        const magnet=mesh(this.effectAssets.magnetGeometry,this.effectAssets.magnetMaterial,0,.4,0,k.root);magnet.rotation.x=Math.PI/2;magnet.castShadow=false;
        k.effects={shield,magnet};
      }
      k.effects.shield.visible=!menu&&r.shield>0;k.effects.magnet.visible=!menu&&r.magnet>0;
      const pulse=1+Math.sin(this.time*5)*.025;k.effects.shield.scale.set(pulse,pulse*.8,pulse);k.effects.magnet.rotation.z+=dt*2;
      if(!menu&&(r.boost>0||r.isDrifting||r.nitroActive||r.rocket>0)&&Math.random()<.7)this.spark(k.root.position,r.rocket>0?0xff995f:r.nitroActive?0x6eeaff:r.boost>0?0xffdd62:0x64d8ff,p,r.isDrifting);
    }
    for(let i=this.particles.length-1;i>=0;i--){const a=this.particles[i];a.life-=dt;a.mesh.position.addScaledVector(a.velocity,dt);if(a.absorb){const kart=this.karts[race.racers.indexOf(race.player)]?.root;if(kart)a.mesh.position.lerp(kart.position,Math.min(1,dt*9));}a.mesh.scale.setScalar(Math.max(.01,a.life*(a.absorb?1.8:1.1)));if(a.life<=0){a.mesh.visible=false;this.particles.splice(i,1);this.particlePool.push(a);}}
    const overview=menu&&this.overview,overviewFit=overview?Math.max(1,1.15/this.camera.aspect):1;this.scene.fog.near=overview?1100*overviewFit:330;this.scene.fog.far=overview?2700*overviewFit:1250;this.camera.near=overview?5:.2;this.camera.far=overview?2400*overviewFit:1900;
    if(overview){const b=this.track.bounds,t=this.time*.035-.6,fit=overviewFit,scale=this.track.mapScale/636;
      const eye=this.scratch.eye.set(b.centerX+Math.sin(t)*750*fit*scale,540*fit*scale,b.centerZ+Math.cos(t)*750*fit*scale);
      this.camera.position.lerp(eye,1-Math.exp(-dt*3));this.camera.lookAt(b.centerX,12,b.centerZ);this.camera.fov=48;
    }else if(menu){const p=this.startSample;const hero=this.karts[0]?.root.position??new THREE.Vector3(p.x,p.y,p.z);const t=this.time*.13;
      const eye=this.scratch.eye.set(hero.x+p.tx*8.5+p.nx*(8+Math.sin(t)*.8),hero.y+5.4,hero.z+p.tz*8.5+p.nz*(8+Math.sin(t)*.8));
      const screenRight=this.scratch.right.set(eye.z-hero.z,0,hero.x-eye.x).normalize();const focus=this.scratch.focus.copy(hero);focus.y+=1.2;focus.addScaledVector(screenRight,this.camera.aspect>1.3?-3.9:0);
      this.camera.position.lerp(eye,1-Math.exp(-dt*3));this.camera.lookAt(focus);this.camera.fov=cameraFov(48,this.camera.aspect);
    }else{const r=race.player,framing=chaseFraming(this.viewport,r.speed),ahead=this.track.sample(r.distance+framing.ahead),eye=chaseEye(this.track,r.distance,r.offset,framing),back=this.scratch.eye.set(eye.x,eye.y,eye.z),snap=framing.relativeToPlayer&&(this.wasMenu||this.resetChase);
      if(snap)this.camera.position.copy(back);else this.camera.position.lerp(back,1-Math.exp(-dt*6));this.camera.lookAt(ahead.x+ahead.nx*r.offset*.65,ahead.y+framing.targetHeight,ahead.z+ahead.nz*r.offset*.65);const targetFov=cameraFov(53+(r.speed??0)*.17,this.camera.aspect);this.camera.fov=snap?targetFov:THREE.MathUtils.damp(this.camera.fov,targetFov,4,dt);this.resetChase=false;
    }
    const focus=menu?this.karts[0]?.root.position:this.karts[race.racers.indexOf(race.player)]?.root.position;
    if(focus){this.sun.target.position.copy(focus);this.sun.position.set(focus.x-80,focus.y+145,focus.z-65);this.sun.target.updateMatrixWorld();}
    this.wasMenu=menu;this.camera.updateProjectionMatrix();this.renderer.render(this.scene,this.camera);
    this.frameStats={quality:this.graphicsQuality,frameMs:rawFrameMs,averageMs:this.adaptive.averageMs,qualityLevel:this.adaptive.level,particles:this.particles.length,particleObjects:this.particles.length+this.particlePool.length,drawCalls:this.renderer.info?.render?.calls??null,triangles:this.renderer.info?.render?.triangles??null,modelLoads:this.modelCache.loads};
  }
  clearParticles(){
    for(const particle of this.particles){particle.mesh.visible=false;this.particlePool.push(particle);}
    this.particles.length=0;
  }
  particle(position,color,velocity,life,absorb=false){
    const limit=this.graphicsQuality==='auto'?this.adaptive.particleLimit:112;
    if(this.particles.length>=limit)return;
    let a=this.particlePool.pop();
    if(!a){
      this.particleGeometry??=new THREE.SphereGeometry(.16,5,4);
      const m=mesh(this.particleGeometry,new THREE.MeshBasicMaterial({color}),0,0,0,this.scene);m.castShadow=false;m.receiveShadow=false;
      a={mesh:m,velocity:new THREE.Vector3()};
    }
    a.mesh.visible=true;a.mesh.position.copy(position);a.mesh.material.color.setHex(color);a.mesh.scale.setScalar(1);a.velocity.copy(velocity);a.life=life;a.absorb=absorb;this.particles.push(a);
  }
  spark(position,color,p,drift){
    this.scratch.focus.set(position.x-p.tx*1.3,position.y+.35,position.z-p.tz*1.3);
    this.scratch.right.set((Math.random()-.5)*3-p.tx*3,Math.random()*2,-p.tz*3+(Math.random()-.5)*3);
    this.particle(this.scratch.focus,color,this.scratch.right,.35+Math.random()*.25);
  }
  pickupBurst(position,color){
    for(let i=0;i<12;i++){
      const a=i*Math.PI/6;
      this.scratch.right.set(Math.cos(a)*3,1.5+(i%3),Math.sin(a)*3);
      this.particle(position,color,this.scratch.right,.55+(i%3)*.08,true);
    }
  }
  updateGhost(pose){
    if(this.disposed)return;
    if(!pose){if(this.ghost)this.ghost.visible=false;return;}
    if(this.ghost&&pose.character&&pose.character!==this.ghostCharacter){this.scene.remove(this.ghost);releaseResources([this.ghost]);this.ghost=null;}
    if(!this.ghost){
      this.ghostCharacter=pose.character??'fox';
      const visual=this.fallbackKart(0x92edff,pose.character??'fox');this.ghost=visual.group;
      this.ghost.traverse(o=>{if(o.isMesh){o.material=o.material.clone();o.material.transparent=true;o.material.opacity=.3;o.material.depthWrite=false;o.castShadow=false;o.receiveShadow=false;}});
      this.scene.add(this.ghost);
    }
    const p=this.track.sample(pose.distance),offset=pose.offset??0;
    this.ghost.visible=true;this.ghost.position.set(p.x+p.nx*offset,p.y+.08,p.z+p.nz*offset);this.ghost.rotation.set(-p.pitch,p.heading+(pose.yaw??0),0,'YXZ');
  }
  dispose(){
    if(this.disposed)return;this.disposed=true;
    window.removeEventListener('resize',this.queueResize);window.removeEventListener('orientationchange',this.queueResize);
    window.visualViewport?.removeEventListener('resize',this.queueResize);
    document.removeEventListener('fullscreenchange',this.queueResize);document.removeEventListener('webkitfullscreenchange',this.queueResize);
    this.canvasResize?.disconnect();if(this.resizeRequest)cancelAnimationFrame(this.resizeRequest);
    releaseResources([this.scene],Object.values(this.materials),this.sharedModelResources);
    this.sun.shadow.dispose();this.renderer.renderLists.dispose();this.renderer.dispose();
    this.scene.clear();this.models=null;this.karts.length=0;this.particles.length=0;this.particlePool.length=0;this.windmills.length=0;
  }
}
