import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import RAPIER from '@dimforge/rapier3d-compat';

type WorkerState = 'walking-to-tree' | 'chopping' | 'walking-to-storage' | 'delivering';
type Worker = {
  id: number; name: string; root: THREE.Group; body: THREE.Group;
  leftArm: THREE.Group; rightArm: THREE.Group; leftLeg: THREE.Group; rightLeg: THREE.Group;
  state: WorkerState; targetTree: THREE.Group; phase: number; workTime: number;
  path: THREE.Vector3[]; pathIndex: number; carriedLog?: THREE.Mesh;
};

const scene = new THREE.Scene();
scene.background = new THREE.Color('#a8adbb');
scene.fog = new THREE.Fog('#a8adbb', 24, 48);
const camera = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, 0.1, 100);
camera.position.set(13, 13, 15);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
document.querySelector<HTMLDivElement>('#game-root')!.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.5, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.065;
controls.minDistance = 8;
controls.maxDistance = 26;
controls.maxPolarAngle = Math.PI * 0.47;
controls.minPolarAngle = 0.25;
controls.update();

scene.add(new THREE.HemisphereLight('#f0f2ff', '#64714a', 2.1));
const sun = new THREE.DirectionalLight('#fff1d6', 3.1);
sun.position.set(-7, 13, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -12; sun.shadow.camera.right = 12;
sun.shadow.camera.top = 12; sun.shadow.camera.bottom = -12;
sun.shadow.bias = -0.00035;
scene.add(sun);

const mat = (color: string, roughness = 0.9, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness, ...extra });
const grassMats = ['#8fba68', '#99c675', '#a5cb7c', '#88b563'].map(c => mat(c));
const darkSoil = mat('#51493c');
const waterMat = mat('#668f91', 0.42, { transparent: true, opacity: 0.92 });
const woodMat = mat('#77513b');
const lightWood = mat('#bd8a58');
const stoneMat = mat('#a9a99b');
const leafMat = ['#668b4e', '#779c58', '#88a967', '#547c47'].map(c => mat(c));
const pickables: THREE.Object3D[] = [];
const trees: THREE.Group[] = [];
const world = new THREE.Group();
scene.add(world);

function shadow(mesh: THREE.Mesh, cast = true) {
  mesh.castShadow = cast; mesh.receiveShadow = true; return mesh;
}
function box(parent: THREE.Object3D, size: [number, number, number], material: THREE.Material, pos: [number, number, number], cast = true) {
  const m = shadow(new THREE.Mesh(new THREE.BoxGeometry(...size), material), cast);
  m.position.set(...pos); parent.add(m); return m;
}
function cylinder(parent: THREE.Object3D, rt: number, rb: number, h: number, material: THREE.Material, pos: [number, number, number], segments = 7) {
  const m = shadow(new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, segments), material));
  m.position.set(...pos); parent.add(m); return m;
}
function ico(parent: THREE.Object3D, radius: number, detail: number, material: THREE.Material, pos: [number, number, number]) {
  const m = shadow(new THREE.Mesh(new THREE.IcosahedronGeometry(radius, detail), material));
  m.position.set(...pos); parent.add(m); return m;
}

// A chunky, irregular miniature island with a dark cut-earth edge.
const outline = new THREE.Shape();
outline.moveTo(-5.6, -3.8);
outline.lineTo(-5.9, -1.2); outline.lineTo(-5.5, 2.9); outline.lineTo(-3.7, 4.4);
outline.lineTo(-0.6, 5.0); outline.lineTo(2.6, 4.5); outline.lineTo(5.3, 3.1);
outline.lineTo(5.8, 0.2); outline.lineTo(5.1, -3.6); outline.lineTo(2.2, -4.7);
outline.lineTo(-1.8, -4.8); outline.lineTo(-4.5, -4.5); outline.closePath();
const islandGeo = new THREE.ExtrudeGeometry(outline, { depth: 0.72, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: 0.12, bevelThickness: 0.12, curveSegments: 1 });
islandGeo.rotateX(-Math.PI / 2);
const island = shadow(new THREE.Mesh(islandGeo, darkSoil));
island.position.y = -0.28; world.add(island);
// ExtrudeGeometry's rotated depth forms the island side; place a grass plane on top.
const ground = shadow(new THREE.Mesh(new THREE.ShapeGeometry(outline), grassMats[1]), false);
ground.rotation.x = -Math.PI / 2; ground.position.y = 0.47; world.add(ground);

// Soft grass facets create a handcrafted miniature terrain rather than a grid.
for (let i = 0; i < 38; i++) {
  const x = -5 + Math.random() * 10, z = -4 + Math.random() * 8;
  if (Math.abs(x) > 5.15 || Math.abs(z) > 4.2) continue;
  const patch = new THREE.Mesh(new THREE.CircleGeometry(0.45 + Math.random() * 0.8, 5 + Math.floor(Math.random() * 3)), grassMats[Math.floor(Math.random() * grassMats.length)]);
  patch.rotation.x = -Math.PI / 2; patch.position.set(x, 0.482 + Math.random() * 0.008, z);
  patch.scale.set(1.0 + Math.random() * 0.8, 0.65 + Math.random() * 0.5, 1);
  world.add(patch);
}

// Meandering creek and the stones that lead through it.
const creekPoints = [
  new THREE.Vector3(-0.15, 0.50, 5.1), new THREE.Vector3(0.05, 0.50, 3.5),
  new THREE.Vector3(-0.6, 0.50, 2.0), new THREE.Vector3(0.1, 0.50, 0.5),
  new THREE.Vector3(0.55, 0.50, -0.9), new THREE.Vector3(0.05, 0.50, -2.5),
  new THREE.Vector3(0.6, 0.50, -4.8)
];
const creekCurve = new THREE.CatmullRomCurve3(creekPoints);
const creek = new THREE.Mesh(new THREE.TubeGeometry(creekCurve, 70, 0.48, 8, false), waterMat);
creek.scale.y = 0.16; creek.position.y = 0.02; world.add(creek);
for (let i = 0; i < 21; i++) {
  const t = 0.05 + i * 0.044;
  const p = creekCurve.getPoint(t);
  const stone = ico(world, 0.22 + Math.random() * 0.13, 0, stoneMat, [p.x + (Math.random() - 0.5) * 0.9, 0.54, p.z]);
  stone.scale.set(1.25, 0.25, 0.85); stone.rotation.y = Math.random() * 2;
}
function makeBridge() {
  const g = new THREE.Group(); g.position.set(-0.05, 0.55, 0.45); g.rotation.y = -0.15; world.add(g);
  const deck = box(g, [2.05, 0.13, 0.78], lightWood, [0, 0.2, 0]);
  deck.rotation.z = -0.09;
  for (const z of [-0.33, 0.33]) {
    const rail = box(g, [2.05, 0.12, 0.09], mat('#8e523b'), [0, 0.62, z]); rail.rotation.z = -0.09;
    for (let i = -3; i <= 3; i++) box(g, [0.09, 0.52, 0.09], woodMat, [i * 0.29, 0.42 + (i + 3) * 0.012, z]);
  }
  for (let i = -4; i <= 4; i++) {
    const plank = box(g, [0.19, 0.035, 0.72], mat(i % 2 ? '#c38b5b' : '#b77d51'), [i * 0.23, 0.29, 0]);
    plank.rotation.z = -0.09;
  }
}
makeBridge();

function makeTree(x: number, z: number, size = 1, pink = false) {
  const g = new THREE.Group(); g.position.set(x, 0.49, z); g.scale.setScalar(size); world.add(g);
  const trunk = cylinder(g, 0.13, 0.2, 1.5, mat('#55473b'), [0, 0.74, 0], 6);
  trunk.rotation.z = (Math.random() - 0.5) * 0.28;
  const branch = cylinder(g, 0.07, 0.11, 0.76, mat('#55473b'), [0.15, 1.35, 0], 5);
  branch.rotation.z = -0.55;
  for (let i = 0; i < 5; i++) {
    const crownMat = pink ? mat(['#dca9c9', '#e6b9d5', '#c991b8', '#edc7df'][i % 4]) : leafMat[i % leafMat.length];
    const crown = ico(g, 0.55 + Math.random() * 0.22, 1, crownMat, [(Math.random() - 0.5) * 0.65, 1.75 + Math.random() * 0.6, (Math.random() - 0.5) * 0.6]);
    crown.scale.set(1.2, 0.85, 1.05);
  }
  trees.push(g); pickables.push(g);
  g.userData.kind = 'tree'; g.userData.wood = 8;
  return g;
}
makeTree(-3.9, 2.45, 1.0, true);
makeTree(-4.65, 0.75, 0.78, false);
makeTree(3.75, 2.55, 0.98, true);
makeTree(4.4, -0.4, 0.72, false);
makeTree(2.8, -2.8, 0.82, false);
makeTree(-3.9, -2.5, 0.8, false);
makeTree(0.1, 3.85, 0.78, true);

function makeRock(x: number, z: number, scale = 1) {
  const g = new THREE.Group(); g.position.set(x, 0.5, z); g.scale.setScalar(scale); world.add(g);
  ico(g, 0.33, 0, stoneMat, [0, 0.2, 0]).scale.set(1.15, 0.75, 0.9);
  ico(g, 0.18, 0, mat('#c6c4b3'), [0.22, 0.2, 0.1]).scale.set(1.1, 0.8, 0.85);
}
[[-2.6,3.5],[1.5,3.2],[4.2,1.5],[2.4,-1.6],[-2.7,-1.8],[-4.6,-0.5],[1.9,0.9]].forEach(([x,z],i)=>makeRock(x,z,0.7+(i%3)*0.2));

// Decorative tufts, distributed away from the creek and buildings.
const grassBladeMat = mat('#4d7c45');
for (let i = 0; i < 72; i++) {
  const x = -5 + Math.random() * 10, z = -4 + Math.random() * 8;
  if (Math.abs(x) > 5.05 || Math.abs(z) > 4.1 || (Math.abs(x) < 1.2 && Math.abs(z) < 1.5) || Math.abs(x + 2.9) < 1.4 && Math.abs(z - 1.0) < 1.2) continue;
  const tuft = new THREE.Group(); tuft.position.set(x, 0.49, z); world.add(tuft);
  for (let j=0;j<3;j++) {
    const blade = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.35 + Math.random()*0.24, 3), grassBladeMat);
    blade.position.set((Math.random()-0.5)*0.18, 0.15, (Math.random()-0.5)*0.15);
    blade.rotation.z = (Math.random()-0.5)*0.7; tuft.add(blade);
  }
}

function makeHut() {
  const g = new THREE.Group(); g.position.set(-3.15, 0.5, 0.55); g.rotation.y = 0.12; world.add(g);
  box(g,[2.15,1.38,1.72],mat('#e6dfc9'),[0,0.72,0]);
  for (const x of [-0.72,0.72]) for (const z of [-0.62,0.62]) box(g,[0.12,1.55,0.12],mat('#834a3d'),[x,0.78,z]);
  box(g,[0.76,0.8,0.06],mat('#8d5c43'),[0,0.48,0.88]);
  box(g,[0.92,0.09,0.09],lightWood,[0,1.56,0.9]);
  // Four low-poly roof planes meet at a ridge.
  const roofMat = mat('#414247');
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.55,0.74,4),roofMat);
  roof.position.set(0,1.9,0); roof.rotation.y=Math.PI/4; roof.scale.set(1,0.65,0.86); shadow(roof); g.add(roof);
  // Porch and timber posts.
  box(g,[2.55,0.12,0.48],lightWood,[0,0.1,1.1]);
  for (const x of [-1.08,1.08]) box(g,[0.08,0.65,0.08],woodMat,[x,0.39,1.27]);
  return g;
}
makeHut();

function makeStorage() {
  const g = new THREE.Group(); g.position.set(2.75,0.5,-1.9); world.add(g);
  box(g,[1.3,0.12,0.9],woodMat,[0,0.08,0]);
  for(let i=0;i<4;i++) box(g,[0.22,0.2,0.7],lightWood,[-0.38+i*0.24,0.22,0]);
  for(let i=0;i<3;i++) box(g,[0.18,0.2,0.68],mat('#9b6b44'),[-0.25+i*0.24,0.42,0]);
  box(g,[1.4,0.08,0.98],mat('#d5bd8b'),[0,0.58,0]);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.9,0.42,4),mat('#8b6b4e')); roof.position.set(0,0.76,0); roof.rotation.y=Math.PI/4; roof.scale.set(1,0.55,0.72); shadow(roof); g.add(roof);
  return g;
}
const storage = makeStorage();
const storagePosition = new THREE.Vector3(2.75,0.5,-1.9);

function makeLantern(x:number,z:number) {
  const g=new THREE.Group();g.position.set(x,0.5,z);world.add(g);
  cylinder(g,0.055,0.07,0.8,mat('#d6c8a3'),[0,0.4,0],5);
  box(g,[0.22,0.16,0.22],mat('#d6c8a3'),[0,0.86,0]);
  const glow= new THREE.Mesh(new THREE.OctahedronGeometry(0.09,0),mat('#ffe5a0',0.4,{emissive:'#ffb84a',emissiveIntensity:0.5}));
  glow.position.y=0.86;g.add(glow);
}
makeLantern(-1.7,0.4);makeLantern(-1.65,1.8);makeLantern(1.65,1.8);

function makePerson(name:string,id:number,x:number,z:number,shirt:string):Worker {
  const root=new THREE.Group();root.position.set(x,0.5,z);world.add(root);
  const body=new THREE.Group();body.position.y=0.78;root.add(body);
  const skin=mat('#d4a27d'), tunic=mat(shirt), trousers=mat('#4c5961'), boots=mat('#453b32');
  cylinder(body,0.16,0.19,0.46,tunic,[0,0.02,0],7);
  const head=ico(body,0.17,1,skin,[0,0.36,0]);head.scale.set(0.88,1.1,0.9);
  // Simple hair cap and belt give the figures a more human, RTS-like silhouette.
  ico(body,0.17,1,mat('#5a4434'),[0,0.48,-0.015]).scale.set(1,0.45,1);
  cylinder(body,0.2,0.2,0.055,lightWood,[0,-0.02,0],7);
  const limb=(length:number,r:number,m:THREE.Material)=> {
    const pivot=new THREE.Group(); const mesh=cylinder(pivot,r*0.78,r,length,m,[0,-length/2,0],6); pivot.add(mesh); return pivot;
  };
  const leftArm=limb(0.34,0.07,tunic),rightArm=limb(0.34,0.07,tunic);
  leftArm.position.set(-0.19,0.17,0);rightArm.position.set(0.19,0.17,0);body.add(leftArm,rightArm);
  const leftLeg=limb(0.32,0.085,trousers),rightLeg=limb(0.32,0.085,trousers);
  leftLeg.position.set(-0.1,-0.19,0);rightLeg.position.set(0.1,-0.19,0);body.add(leftLeg,rightLeg);
  cylinder(leftLeg,0.075,0.09,0.11,boots,[0,-0.32,0.045],6);
  cylinder(rightLeg,0.075,0.09,0.11,boots,[0,-0.32,0.045],6);
  const worker:Worker={id,name,root,body,leftArm,rightArm,leftLeg,rightLeg,state:'walking-to-tree',targetTree:trees[id%trees.length]!,phase:Math.random()*6,workTime:0,path:[],pathIndex:0};
  root.userData.worker=worker;pickables.push(root);
  // Ground shadow marker for easy selection.
  const marker=new THREE.Mesh(new THREE.CircleGeometry(0.27,20),mat('#4d6d50',0.9,{transparent:true,opacity:0.0}));
  marker.rotation.x=-Math.PI/2;marker.position.y=0.015;root.add(marker);root.userData.marker=marker;
  return worker;
}
const workers:Worker[]=[
  makePerson('Milo',0,-1.6,-0.7,'#bd7851'),
  makePerson('Anya',1,-2.0,-1.25,'#6b8492'),
  makePerson('Tomas',2,1.1,-2.8,'#8a9c65')
];

function setPath(w:Worker,points:THREE.Vector3[]) { w.path=points;w.pathIndex=0; }
function walkToTree(w:Worker) {
  const t=w.targetTree.position;
  setPath(w,[new THREE.Vector3(t.x+0.8,0.5,t.z+0.65)]);
  w.state='walking-to-tree';
}
function walkToStorage(w:Worker) {
  setPath(w,[new THREE.Vector3(storagePosition.x-0.65,0.5,storagePosition.z+0.6)]);
  w.state='walking-to-storage';
}
workers.forEach(w=>walkToTree(w));

const clock=new THREE.Clock();
let paused=false, speed=1, labelsOn=true, wood=24, food=18, stone=12, selected:Worker|null=null, toastTimer=0;
const labelLayer=document.createElement('div');labelLayer.className='label-layer';document.querySelector('#app')!.append(labelLayer);
const labelElements=new Map<number,HTMLDivElement>();
for(const w of workers){
  const el=document.createElement('div');el.className='world-label';el.textContent=w.name;labelLayer.append(el);labelElements.set(w.id,el);
}
function showToast(message:string){
 const toast=document.querySelector<HTMLDivElement>('#toast')!;toast.textContent=message;toast.classList.remove('hidden');toastTimer=2.2;
}
function updateHud(){
 document.querySelector('#wood-count')!.textContent=String(wood);
 document.querySelector('#food-count')!.textContent=String(food);
 document.querySelector('#stone-count')!.textContent=String(stone);
 document.querySelector('#population-count')!.textContent=`${workers.length} / 12`;
 document.querySelector('#wood-rate')!.textContent=workers.filter(w=>w.state==='chopping').length.toString();
 const p=Math.min(96,18+Math.floor(wood/3));document.querySelector('#prosperity-value')!.textContent=p+'%';
 (document.querySelector('#prosperity-bar') as HTMLElement).style.width=p+'%';
}
function setSelected(w:Worker|null){
 selected=w;
 document.querySelector('#inspector')!.classList.toggle('hidden',!w);
 for(const person of workers){
  const marker=person.root.userData.marker as THREE.Mesh;
  (marker.material as THREE.MeshStandardMaterial).opacity=person===w?0.82:0;
  const label=labelElements.get(person.id);if(label)label.classList.toggle('active',person===w);
 }
 if(w){
  document.querySelector('#inspector-name')!.textContent=w.name;
  document.querySelector('#inspector-job')!.textContent=w.state==='chopping'?'Woodcutter · Working':w.state==='delivering'?'Carrier · Delivering':w.state==='walking-to-storage'?'Carrier · Returning':'Woodcutter · Walking';
 }
}
function updateWorker(w:Worker,dt:number){
 w.phase+=dt*5;
 const moving=w.state==='walking-to-tree'||w.state==='walking-to-storage';
 if(moving && w.pathIndex<w.path.length){
  const target=w.path[w.pathIndex]!;
  const dx=target.x-w.root.position.x,dz=target.z-w.root.position.z;
  const dist=Math.hypot(dx,dz),step=dt*1.3*speed;
  if(dist<step+0.04){w.root.position.x=target.x;w.root.position.z=target.z;w.pathIndex++;}
  else {w.root.position.x+=dx/dist*step;w.root.position.z+=dz/dist*step;w.root.rotation.y=Math.atan2(dx,dz);}
  w.leftLeg.rotation.x=Math.sin(w.phase)*0.65;w.rightLeg.rotation.x=-Math.sin(w.phase)*0.65;
  w.leftArm.rotation.x=-Math.sin(w.phase)*0.42;w.rightArm.rotation.x=Math.sin(w.phase)*0.42;
  w.body.position.y=0.78+Math.abs(Math.sin(w.phase*2))*0.025;
 } else if(moving){
  if(w.state==='walking-to-tree'){w.state='chopping';w.workTime=0;}
  else {w.state='delivering';w.workTime=0;}
 } else if(w.state==='chopping'){
  w.workTime+=dt*speed;w.rightArm.rotation.x=-1.05+Math.sin(w.workTime*8)*0.72;w.leftArm.rotation.x=-0.4;
  w.leftLeg.rotation.x=0;w.rightLeg.rotation.x=0;w.body.position.y=0.78+Math.sin(w.workTime*8)*0.015;
  if(w.workTime>4.2){
   if(w.targetTree.userData.wood>0)w.targetTree.userData.wood--;
   if(w.targetTree.userData.wood===0){
    // Replenish the stylized tree stock after a short regrowth cycle.
    w.targetTree.userData.wood=8;showToast('A tree has been harvested. Timber delivered soon.');
   }
   w.carriedLog=box(w.root,[0.43,0.1,0.11],lightWood,[0.25,0.88,0.1]);
   walkToStorage(w);
  }
 } else if(w.state==='delivering'){
  w.workTime+=dt*speed;w.rightArm.rotation.x=-0.4;w.leftArm.rotation.x=-0.4;
  if(w.workTime>0.7){
   if(w.carriedLog){w.root.remove(w.carriedLog);w.carriedLog.geometry.dispose();w.carriedLog=null;}
   wood+=3;updateHud();walkToTree(w);
   w.targetTree=trees[(w.id+Math.floor(wood/3))%trees.length]!;
  }
 }
 if(selected===w){
  document.querySelector('#inspector-job')!.textContent=w.state==='chopping'?'Woodcutter · Working':w.state==='delivering'?'Carrier · Delivering':w.state==='walking-to-storage'?'Carrier · Returning':'Woodcutter · Walking';
 }
}

const raycaster=new THREE.Raycaster(), pointer=new THREE.Vector2();
renderer.domElement.addEventListener('pointerdown',event=>{
 if(event.button!==0)return;
 const rect=renderer.domElement.getBoundingClientRect();
 pointer.set(((event.clientX-rect.left)/rect.width)*2-1,-((event.clientY-rect.top)/rect.height)*2+1);
 raycaster.setFromCamera(pointer,camera);
 const hits=raycaster.intersectObjects(pickables,true);
 let object:THREE.Object3D|undefined=hits[0]?.object;
 while(object && !object.userData.worker && object.parent!==world)object=object.parent??undefined;
 if(object?.userData.worker){setSelected(object.userData.worker as Worker);}
 else if(hits.length && hits[0]?.object){const hit=hits[0].object;let p:THREE.Object3D|null=hit;while(p&&!p.userData.kind)p=p.parent;if(p?.userData.kind==='tree')showToast('Timber stand · Select a villager to assign work.');}
});
function updateLabels(){
 for(const w of workers){
  const el=labelElements.get(w.id);if(!el)continue;
  const pos=w.root.position.clone();pos.y+=2.0;pos.project(camera);
  el.style.left=((pos.x+1)*0.5*innerWidth)+'px';
  el.style.top=((-pos.y+1)*0.5*innerHeight)+'px';
  el.style.display=labelsOn&&pos.z<1?'block':'none';
 }
}
document.querySelector('#pause-button')!.addEventListener('click',()=>{
 paused=!paused;document.querySelector('#pause-button')!.textContent=paused?'▶':'Ⅱ';
 showToast(paused?'Simulation paused':'Settlement resumed');
});
document.querySelector('#speed-button')!.addEventListener('click',()=>{
 speed=speed===1?2:speed===2?3:1;
 document.querySelector('#speed-button')!.textContent=speed+'× SPEED';
});
document.querySelector('#home-button')!.addEventListener('click',()=>{
 camera.position.set(13,13,15);controls.target.set(0,0.5,0);controls.update();
});
document.querySelector('#toggle-labels')!.addEventListener('click',event=>{
 labelsOn=!labelsOn;(event.currentTarget as HTMLElement).classList.toggle('selected',labelsOn);
});
document.querySelector('#close-inspector')!.addEventListener('click',()=>setSelected(null));
addEventListener('resize',()=>{
 camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);
 renderer.setPixelRatio(Math.min(devicePixelRatio,1.8));
});

let lastHud=0;
function animate(){
 requestAnimationFrame(animate);
 const dt=Math.min(clock.getDelta(),0.05);
 if(!paused){for(const w of workers)updateWorker(w,dt);toastTimer=Math.max(0,toastTimer-dt);if(toastTimer===0)document.querySelector('#toast')!.classList.add('hidden');}
 controls.update();updateLabels();renderer.render(scene,camera);
 if(clock.elapsedTime-lastHud>0.3){updateHud();lastHud=clock.elapsedTime;}
}
setTimeout(()=>document.querySelector('#loading-screen')?.classList.add('finished'),650);
animate();

// Initialize the physics runtime as a foundation for the next interaction milestone.
// The first scene intentionally uses lightweight kinematic movement; Rapier colliders
// will be introduced alongside robust pathfinding and obstacle avoidance.
void RAPIER.init().then(()=>{document.body.dataset.physics='ready';}).catch(()=>{document.body.dataset.physics='fallback';});
