"use strict";
/* ===========================================================
   RINK LAB — single-file hockey drill animator
   Model: pieces (positions in feet) + paths (polylines).
   A path that starts on a piece becomes that piece's motion track.
   =========================================================== */

const LOGO_SRC={"anchorage": "images/logo-anchorage.png", "krakenS": "images/logo-krakenS.png", "youthS": "images/logo-youthS.png", "anchorLight": "images/logo-anchorLight.png", "anchorNavy": "images/logo-anchorNavy.png"};
const LOGO_NAMES={anchorage:'Anchorage Academy',krakenS:'Seattle Kraken',youthS:'Kraken (mono)',anchorLight:'Anchor (ice)',anchorNavy:'Anchor (navy)'};
const LOGO_IMG={};
for(const k in LOGO_SRC){const im=new Image(); im.src=LOGO_SRC[k]; im.onload=()=>{try{render();}catch(e){}}; LOGO_IMG[k]=im;}
let centerLogo='anchorage';
const REF_SRC={"stations": "images/ref-stations.png", "swing": "images/ref-swing.png", "flow": "images/ref-flow.png", "cones": "images/ref-cones.png"};
const REF_NAMES={stations:'10U Stealth (stations)',swing:'Figure-8 swing',flow:'Flow / regroup',cones:'Cone weave'};
const REF_IMG={};
for(const k in REF_SRC){const im=new Image(); im.src=REF_SRC[k]; im.onload=()=>{try{render();}catch(e){}}; REF_IMG[k]=im;}
const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
let DPR = Math.min(window.devicePixelRatio||1, 2);

// ---- world / rink geometry (feet) ----
const RW=200, RH=85, GAP=24;           // full-sheet size + gap between sheets
const FW=210, FH=120;                  // grass field (dryland) dimensions in feet
// KCI Iceplex floor plan (feet, scaled to match piece scale)
const IW=520, IH=290;                  // total facility footprint
let rinkConfig='full';
let showTrap=true;
const CONFIGS={
  full:    {label:'Full sheet',      panels:[{ox:0,oy:0,kind:'full'}]},
  half:    {label:'Half sheet',      panels:[{ox:0,oy:0,kind:'halfL'}]},
  halves:  {label:'Two half sheets', panels:[{ox:0,oy:0,kind:'halfL'},{ox:100+GAP,oy:0,kind:'halfL'}]},
  twofull: {label:'Two full sheets', panels:[{ox:0,oy:0,kind:'full'},{ox:0,oy:RH+GAP,kind:'full'}]},
  field:   {label:'Grass Field',     panels:[{ox:0,oy:0,kind:'field'}]},
  iceplex: {label:'KCI Iceplex',     panels:[{ox:0,oy:0,kind:'iceplex'}]},
};
function panels(){ return CONFIGS[rinkConfig].panels; }
function panelW(k){ return k==='iceplex'?IW:k==='field'?FW:k==='full'?RW:100; }
function panelH(k){ return k==='iceplex'?IH:k==='field'?FH:RH; }
function worldBounds(){ let mx=0,my=0; panels().forEach(p=>{mx=Math.max(mx,p.ox+panelW(p.kind)); my=Math.max(my,p.oy+panelH(p.kind));}); return {x:0,y:0,w:mx,h:my}; }

// ---- camera ----
let cam={s:4,tx:60,ty:40};
function W2S(x,y){ return [x*cam.s+cam.tx, y*cam.s+cam.ty]; }
function S2W(px,py){ return [(px-cam.tx)/cam.s, (py-cam.ty)/cam.s]; }
function fitRect(r,pad=24){
  const cw=cv.clientWidth, ch=cv.clientHeight;
  const s=Math.min((cw-pad*2)/r.w,(ch-pad*2)/r.h);
  cam.s=s; cam.tx=(cw - r.w*s)/2 - r.x*s; cam.ty=(ch - r.h*s)/2 - r.y*s;
}

// view presets depend on the rink configuration
function defaultView(){ return rinkConfig==='full'?'full': rinkConfig==='half'?'zone': rinkConfig==='field'?'full':'both'; }
function viewPresets(){
  const b=worldBounds();
  if(rinkConfig==='iceplex') return [
    {k:'full', t:'Full',      r:{x:-8, y:-22,w:480,h:310}},
    {k:'sb',   t:'Starbucks', r:{x:36, y:32, w:104,h:210}},
    {k:'gap',  t:'Floor Gap', r:{x:128,y:32, w:44, h:210}},
    {k:'ss',   t:'Smartsheet',r:{x:160,y:32, w:104,h:210}},
    {k:'lock', t:'Lockers',   r:{x:254,y:-20,w:62, h:280}},
    {k:'vm',   t:'VM Rink',   r:{x:304,y:32, w:104,h:210}},
  ];
  if(rinkConfig==='field') return [
    {k:'full', t:'Full',     r:{x:-15,y:-40,w:FW+55,h:FH+110}},
    {k:'field',t:'Field',    r:{x:-5, y:-5, w:FW+10,h:FH+10}},
    {k:'pp',   t:'Ping Pong',r:{x:FW-30,y:-40,w:45,h:30}},
    {k:'kci',  t:'KCI',      r:{x:-5, y:FH+20,w:FW+10,h:40}},
  ];
  if(rinkConfig==='full') return [
    {k:'full',t:'Full',   r:{x:0,y:0,w:RW,h:RH}},
    {k:'dz',  t:'D-Zone', r:{x:0,y:0,w:92,h:RH}},
    {k:'nz',  t:'Neutral',r:{x:54,y:0,w:92,h:RH}},
    {k:'oz',  t:'O-Zone', r:{x:108,y:0,w:92,h:RH}},
  ];
  if(rinkConfig==='half') return [
    {k:'zone', t:'Zone', r:{x:0,y:0,w:100,h:RH}},
    {k:'tight',t:'Slot', r:{x:0,y:0,w:62,h:RH}},
  ];
  if(rinkConfig==='halves') return [
    {k:'both', t:'Both', r:b},
    {k:'left', t:'Left', r:{x:0,y:0,w:100,h:RH}},
    {k:'right',t:'Right',r:{x:100+GAP,y:0,w:100,h:RH}},
  ];
  return [
    {k:'both',t:'Both',  r:b},
    {k:'top', t:'Top',   r:{x:0,y:0,w:RW,h:RH}},
    {k:'bot', t:'Bottom',r:{x:0,y:RH+GAP,w:RW,h:RH}},
  ];
}
let currentView='full';
function buildViewSeg(){
  const seg=document.getElementById('viewSeg'); seg.innerHTML='';
  viewPresets().forEach((p,i)=>{
    const b=document.createElement('button'); b.textContent=p.t; b.dataset.k=p.k;
    if(p.k===currentView) b.classList.add('on');
    b.onclick=()=>{ currentView=p.k; fitRect(p.r); [...seg.children].forEach(c=>c.classList.toggle('on',c.dataset.k===p.k)); render(); };
    seg.appendChild(b);
  });
}

// =========================================================
//  SCENES (multi-drill practice)
// =========================================================
function makeScene(name){ return {name, pieces:[], paths:[], rinkType:'full', undoStack:[], redoStack:[], notes:'', equip:''}; }
let scenes=[makeScene('Drill 1')];
let currentScene=0;

// =========================================================
//  STATE
// =========================================================
let pieces=scenes[0].pieces;
let paths=scenes[0].paths;
let uid=1;
const id=()=>uid++;

function syncScene(){
  scenes[currentScene].pieces=pieces;
  scenes[currentScene].paths=paths;
  scenes[currentScene].rinkType=rinkConfig;
  scenes[currentScene].undoStack=undoStack;
  scenes[currentScene].redoStack=redoStack;
  const nt=document.getElementById('drillNotes'); if(nt) scenes[currentScene].notes=nt.value;
  const eq=document.getElementById('equipNotes'); if(eq) scenes[currentScene].equip=eq.value;
}
function loadScene(idx){
  syncScene();
  currentScene=idx;
  const s=scenes[idx];
  pieces=s.pieces; paths=s.paths;
  undoStack=s.undoStack; redoStack=s.redoStack;
  rinkConfig=s.rinkType||'full';
  document.getElementById('rinkSel').value=rinkConfig;
  const nt=document.getElementById('drillNotes'); if(nt) nt.value=s.notes||'';
  const eq=document.getElementById('equipNotes'); if(eq) eq.value=s.equip||'';
  selOne(null); building=null; passBuilding=null; shotBuilding=null; skateBuilding=null; skateBackBuilding=null; skateBackCursor=null; skateRevBuilding=null; skateRevCursor=null;
  tNow=0; playing=false;
  try{setPlayUI();}catch(e){}
  currentView=defaultView(); buildLayoutSeg(); buildViewSeg();
  fitRect(viewPresets()[0].r);
  updateInspector(); updateSceneTabs(); render(); updateHint();
}
function addScene(){
  syncScene();
  const n=scenes.length+1;
  scenes.push(makeScene('Drill '+n));
  loadScene(scenes.length-1);
}
function deleteScene(idx){
  if(scenes.length===1){ toast('Need at least one drill'); return; }
  if(!confirm('Delete "'+scenes[idx].name+'"?')) return;
  scenes.splice(idx,1);
  const next=Math.min(idx,scenes.length-1);
  currentScene=next;
  const s=scenes[next];
  pieces=s.pieces; paths=s.paths;
  undoStack=s.undoStack; redoStack=s.redoStack;
  rinkConfig=s.rinkType||'full';
  document.getElementById('rinkSel').value=rinkConfig;
  selOne(null); currentView=defaultView(); buildLayoutSeg(); buildViewSeg();
  fitRect(viewPresets()[0].r);
  updateInspector(); updateSceneTabs(); render();
}
function renameScene(idx){
  const s=prompt('Drill name:',scenes[idx].name); if(s&&s.trim()) scenes[idx].name=s.trim(); updateSceneTabs();
}
function duplicateScene(idx){
  syncScene();
  const s=scenes[idx];
  const ns=makeScene(s.name+' copy');
  ns.pieces=JSON.parse(JSON.stringify(s.pieces));
  ns.paths=JSON.parse(JSON.stringify(s.paths));
  ns.rinkType=s.rinkType;
  ns.notes=s.notes||'';
  scenes.splice(idx+1,0,ns);
  loadScene(idx+1);
}
function updateSceneTabs(){
  const bar=document.getElementById('scenebar'); if(!bar)return; bar.innerHTML='';
  scenes.forEach((s,i)=>{
    const t=document.createElement('button'); t.className='scenetab'+(i===currentScene?' on':'');
    t.textContent=s.name;
    t.onclick=()=>loadScene(i);
    t.ondblclick=(e)=>{ e.stopPropagation(); renameScene(i); };
    const dup=document.createElement('span'); dup.textContent='⧉'; dup.className='scenetab-x';
    dup.title='Duplicate drill'; dup.onclick=(e)=>{ e.stopPropagation(); duplicateScene(i); };
    const x=document.createElement('span'); x.textContent='×'; x.className='scenetab-x';
    x.title='Delete drill'; x.onclick=(e)=>{ e.stopPropagation(); deleteScene(i); };
    t.appendChild(dup); t.appendChild(x); bar.appendChild(t);
  });
  const add=document.createElement('button'); add.className='scenetab scenetab-add'; add.textContent='+ Drill';
  add.onclick=addScene; bar.appendChild(add);
}

let tool='select';
let pendingType=null, pendingOpts=null;   // piece (and template) armed to drop at next click
let pendingPick=null;   // {puckId, kind} — waiting for a carrier/receiver click
let activeColor=null;   // null = each object's own default; otherwise applies to new objects + lines
let clip=null;          // copied piece/path
let pendingStamp=false; // keep placing copies until Esc
let playerColor='blue';
let passBuilding=null;  // {path} click-based pass being built
let passCursor=null;    // current mouse pos for live pass preview
let shotBuilding=null;  // {path} click-based shot being built
let shotCursor=null;    // current mouse pos for live shot preview
let skateBuilding=null;     // {anchors, path} click-based annotation skate being built
let skateCursor=null;       // current mouse pos for live skate preview
let skateBackBuilding=null; // same for backwards skate
let skateBackCursor=null;
let skateRevBuilding=null;  // true backwards skating
let skateRevCursor=null;
let sel=null;            // primary {kind:'piece'|'path', id}
let selSet=[];           // full selection (one or many)
let marquee=null;        // rubber-band box
function selOne(kind,idv){ if(kind===null){ selSet=[]; sel=null; } else { sel={kind,id:idv}; selSet=[sel]; } }
function selToggle(kind,idv){ const i=selSet.findIndex(s=>s.kind===kind&&s.id===idv);
  if(i>=0) selSet.splice(i,1); else selSet.push({kind,id:idv});
  sel = selSet.length? selSet[selSet.length-1] : null; }
function selContains(kind,idv){ return selSet.some(s=>s.kind===kind&&s.id===idv); }
function selPieces(){ return selSet.filter(s=>s.kind==='piece').map(s=>getPiece(s.id)).filter(Boolean); }
function selPaths(){ return selSet.filter(s=>s.kind==='path').map(s=>getPath(s.id)).filter(Boolean); }
const COLORS={
  blue:'#1E7FA0', red:'#E9072B', white:'#EEF5F8', black:'#10202C',
  yellow:'#E7B416', green:'#2FA866'
};

// undo — per-scene stacks
let undoStack=scenes[0].undoStack, redoStack=scenes[0].redoStack;
function snapshot(){ return JSON.stringify({pieces,paths,rinkConfig,uid}); }
function pushUndo(){ undoStack.push(snapshot()); if(undoStack.length>60)undoStack.shift(); redoStack.length=0; }
function restore(s){ const o=JSON.parse(s); pieces=o.pieces; paths=o.paths; rinkConfig=o.rinkConfig||'full'; uid=o.uid;
  paths.forEach(p=>p._lut=null);
  scenes[currentScene].pieces=pieces; scenes[currentScene].paths=paths; scenes[currentScene].rinkType=rinkConfig;
  buildLayoutSeg(); buildViewSeg(); render(); }
function undo(){ if(!undoStack.length)return; redoStack.push(snapshot()); restore(undoStack.pop()); selOne(null); updateInspector(); }
function redo(){ if(!redoStack.length)return; undoStack.push(snapshot()); restore(redoStack.pop()); selOne(null); updateInspector(); }
document.getElementById('undoBtn').onclick=()=>undo();
document.getElementById('redoBtn').onclick=()=>redo();

// =========================================================
//  TRAY
// =========================================================
const TOOLS=[
  {k:'select', n:'Select', svg:'<path d="M5 3l14 7-6 2-2 6z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>'},
  {k:'motion', n:'Move',   svg:'<circle cx="5" cy="18" r="2.5" fill="var(--accent)"/><path d="M6 16q3-9 9-9" fill="none" stroke="var(--accent)" stroke-width="2" stroke-dasharray="2 2"/><path d="M12 4l5 3-5 3" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'},
  {k:'skate',    n:'Skate', svg:'<path d="M3 16q3-6 5 0t5 0 5 0" fill="none" stroke="var(--accent)" stroke-width="2"/><path d="M19 13l3 3-3 3" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'},
  {k:'skateback',n:'Puck',  svg:'<path d="M3 16q1.5-3 2.5 0t2.5 0 2.5 0 2.5 0 2.5 0" fill="none" stroke="var(--accent)" stroke-width="2"/><circle cx="21" cy="16" r="2.5" fill="var(--accent)"/>'},
  {k:'skaterev', n:'Back',  svg:'<path d="M3 16q1-4 2.5 0t2 2 2.5-2 2 2 2.5-2" fill="none" stroke="var(--accent)" stroke-width="2"/><path d="M19 13l3 3-3 3" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'},
  {k:'pass',   n:'Pass',   svg:'<path d="M3 12h14" fill="none" stroke="var(--accent)" stroke-width="2" stroke-dasharray="3 3"/><path d="M16 8l5 4-5 4" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'},
  {k:'shot',   n:'Shot',   svg:'<path d="M3 12h14M7 8v8M10 8v8" fill="none" stroke="var(--accent)" stroke-width="2"/><path d="M16 8l5 4-5 4" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'},
  {k:'arrow',  n:'Arrow',  svg:'<path d="M3 12h14" fill="none" stroke="var(--accent)" stroke-width="2"/><path d="M16 8l5 4-5 4" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'},
  {k:'pen',    n:'Pen',    svg:'<path d="M4 20l3-1L19 7l-2-2L5 17z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>'},
  {k:'text',   n:'Text',   svg:'<path d="M5 5h14M12 5v14M9 19h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'},
  {k:'pan',    n:'Pan',    svg:'<path d="M12 3v8M8 7l4-4 4 4M5 12h14M9 16l3 4 3-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'},
  {k:'erase',  n:'Erase',  svg:'<path d="M6 18l-3-3 9-9 6 6-6 6z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9 21h11" stroke="currentColor" stroke-width="2"/>'},
];
function buildTools(){
  const g=document.getElementById('tools'); g.innerHTML='';
  TOOLS.forEach(t=>{
    const b=document.createElement('button'); b.className='tool'+(tool===t.k?' on':'');
    b.dataset.k=t.k; b.innerHTML=`<svg viewBox="0 0 24 24">${t.svg}</svg>${t.n}`;
    b.onclick=()=>setTool(t.k);
    g.appendChild(b);
  });
}
function setTool(k){ if(building) finishBuilding(); tool=k; pendingType=null; pendingOpts=null; pendingStamp=false;
  [...document.querySelectorAll('#tools .tool')].forEach(b=>b.classList.toggle('on',b.dataset.k===k));
  cv.className = (k==='select'?'select':k==='pan'?'pan':''); cv.style.cursor=''; updateHint(); }

function buildObjColors(){
  const el=document.getElementById('objcolors'); if(!el)return; el.innerHTML='';
  const auto=document.createElement('button');
  auto.textContent='Default'; auto.dataset.k='auto';
  auto.style.cssText='font-size:10px;font-weight:700;padding:2px 6px;border-radius:6px;border:2px solid '+(activeColor===null?'#fff':'#244A66')+';background:'+(activeColor===null?'#5BC2D6':'var(--panel)')+';color:'+(activeColor===null?'#04141c':'var(--muted)')+';cursor:pointer;white-space:nowrap;';
  auto.title="Reset to each object's own default colour";
  auto.onclick=()=>pickObjColor(null,auto); el.appendChild(auto);
  [['black','#11181f'],['red','#E8313A'],['green','#2FA866'],['blue','#2F6FE0'],['orange','#F2811D'],['purple','#8A2BE2'],['white','#FFFFFF']]
    .forEach(([k,v])=>{ const d=document.createElement('div'); d.className='sw'; d.style.background=v; d.dataset.k=v;
      if(v==='#FFFFFF') d.style.border='2px solid #244A66';
      d.onclick=()=>pickObjColor(v,d); el.appendChild(d); });
}
function pickObjColor(v,el){
  if(selSet.length){ pushUndo();
    selPieces().forEach(p=>{ p.color = v||undefined; });
    selPaths().forEach(pa=>{ pa.color = v||'#0C2233'; });
    render(); updateInspector();
  } else {
    activeColor=v;
    document.querySelectorAll('#objcolors .sw').forEach(x=>x.classList.toggle('on',x===el));
    const defBtn=document.querySelector('#objcolors [data-k="auto"]');
    if(defBtn){ const on=v===null; defBtn.style.borderColor=on?'#fff':'#244A66'; defBtn.style.background=on?'#5BC2D6':'var(--panel)'; defBtn.style.color=on?'#04141c':'var(--muted)'; }
    fillTray('equip',EQUIP); fillTray('positions',POSITIONS);
  }
}
function buildSwatches(){
  const s=document.getElementById('swatches'); s.innerHTML='';
  Object.entries(COLORS).forEach(([k,v])=>{
    const d=document.createElement('div'); d.className='sw'+(playerColor===k?' on':''); d.style.background=v; d.dataset.k=k;
    d.onclick=()=>{ playerColor=k; [...s.children].forEach(c=>c.classList.toggle('on',c.dataset.k===k)); fillTray('skaters',SKATERS); };
    s.appendChild(d);
  });
}

const SKATERS=[
  {type:'player', n:'Skater'},
  {type:'goalie', n:'Goalie'},
  {type:'coach',  n:'Coach'},
];
const EQUIP=[
  {type:'puck',     n:'Puck'},
  {type:'puckstack',n:'Pucks'},
  {type:'ball',     n:'Ball'},
  {type:'net',      n:'Net'},
  {type:'cone',     n:'Cone'},
  {type:'tire',     n:'Tire'},
  {type:'bumper',   n:'Bumper'},
  {type:'ring',     n:'Ring'},
  {type:'dot',      n:'Dot'},
  {type:'zone',     n:'Zone'},
];
const POSITIONS=[
  {type:'player',n:'F', opts:{num:'F'}},
  {type:'player',n:'C', opts:{num:'C'}},
  {type:'player',n:'LW',opts:{num:'LW'}},
  {type:'player',n:'RW',opts:{num:'RW'}},
  {type:'player',n:'D', opts:{num:'D'}},
  {type:'player',n:'LD',opts:{num:'LD'}},
  {type:'player',n:'RD',opts:{num:'RD'}},
  {type:'goalie',n:'G', opts:{}},
  {type:'player',n:'△ D',opts:{num:'D',shape:'triangle'}},
];
function buildPieceTray(){
  fillTray('skaters', SKATERS);
  fillTray('positions', POSITIONS);
  fillTray('equip', EQUIP);
}
function fillTray(elid, list){
  const g=document.getElementById(elid); g.innerHTML='';
  list.forEach(it=>{
    const b=document.createElement('button'); b.className='piece';
    const c=document.createElement('canvas'); c.width=56;c.height=36;
    drawThumb(c.getContext('2d'), it.type, it.opts);
    b.appendChild(c);
    const playerType=(it.type==='player'||it.type==='goalie'||it.type==='coach');
    if(!playerType){ const nm=document.createElement('span'); nm.className='nm'; nm.textContent=it.n; b.appendChild(nm); }
    b.onclick=()=>armPlace(it.type, it.opts);
    g.appendChild(b);
  });
}
function drawThumb(c,type,opts){
  c.clearRect(0,0,56,36); c.save(); c.translate(28,16);
  const base={type, size:1, color:undefined, num:''};
  if(type==='player'||type==='goalie') base.color=COLORS[playerColor];
  if(type==='player') base.num='7';
  if(activeColor && type!=='player' && type!=='goalie') base.color=activeColor;
  Object.assign(base, opts||{});
  const thumbScale={net:3.2, bumper:2.2, tire:3.5, ring:3.5, zone:1.2}[type]||4.5;
  drawPieceShape(c, base, thumbScale, true);
  c.restore();
}

// =========================================================
//  ADD / MODIFY PIECES
// =========================================================
function viewCenterWorld(){
  const [x,y]=S2W(cv.clientWidth/2, cv.clientHeight/2); return {x,y};
}
function armPlace(type,opts){ pendingType=type; pendingOpts=opts||null; pendingStamp=true; selOne(null); updateInspector(); cv.style.cursor='crosshair'; updateHint(); }
function cloneOpts(src){ const o={...src}; delete o.id; delete o.x; delete o.y; delete o._wft; delete o._hft; delete o._lut; return o; }
function clonePiece(p,dx,dy){ const np={...p,id:id(),x:p.x+dx,y:p.y+dy}; if(p.legs) np.legs=p.legs.map(l=>({...l})); return np; }
function clonePath(pa,dx,dy){ return {...pa,id:id(),_lut:null,
  anchors:pa.anchors?pa.anchors.map(q=>({x:q.x+dx,y:q.y+dy})):null,
  pts:pa.pts?pa.pts.map(q=>({x:q.x+dx,y:q.y+dy})):[]}; }
function copySelection(){ if(!selSet.length)return;
  if(selSet.length===1){ const s=selSet[0];
    if(s.kind==='piece'){ const p=getPiece(s.id); if(p){ const mp=motionPathOf(p.id);
      clip={kind:'piece',data:{...p, legs:p.legs?p.legs.map(l=>({...l})):undefined},
        motion: mp? {...mp,_lut:undefined,pts:mp.pts.map(q=>({...q})),anchors:mp.anchors?mp.anchors.map(q=>({...q})):null} : null};
      toast('Copied '+prettyType(p.type)+(mp?' (with route)':'')); } }
    else { const pa=getPath(s.id); if(pa){ clip={kind:'path',data:{...pa,_lut:undefined,pts:pa.pts.map(q=>({...q})),anchors:pa.anchors?pa.anchors.map(q=>({...q})):null}}; toast('Copied path'); } }
  } else { clip={kind:'group', pieces:selPieces().map(p=>({...p, legs:p.legs?p.legs.map(l=>({...l})):undefined})),
      paths:pathsForPieceCopy(selPieces(),selPaths()) }; toast('Copied '+selSet.length+' objects'); }
}
// owned motion/puck-journey paths ride along even if only the piece (not its path) was selected
function pathsForPieceCopy(ps,explicitPaths){
  const ownedIds=new Set(ps.map(p=>p.id)); const already=new Set(explicitPaths.map(p=>p.id));
  const owned=paths.filter(p=>p.owner&&ownedIds.has(p.owner)&&!already.has(p.id));
  return explicitPaths.concat(owned);
}
function pasteGroup(srcPieces,srcPaths,dx,dy){ pushUndo(); const idMap={}, ns=[];
  (srcPieces||[]).forEach(p=>{ const np=clonePiece(p,dx,dy); idMap[p.id]=np.id; pieces.push(np); ns.push({kind:'piece',id:np.id}); });
  (srcPaths||[]).forEach(pa=>{ const np=clonePath(pa,dx,dy); if(np.owner&&idMap[np.owner])np.owner=idMap[np.owner]; else if(np.owner)np.owner=null; paths.push(np); ns.push({kind:'path',id:np.id}); });
  selSet=ns; sel=ns.length?ns[ns.length-1]:null; updateInspector(); render(); }
function pasteFromClip(){ if(!clip){ toast('Nothing copied yet'); return; }
  if(clip.kind==='group'){ pasteGroup(clip.pieces,clip.paths,6,5); toast('Pasted '+(clip.pieces.length+clip.paths.length)); return; }
  if(clip.kind==='piece'){
    if(clip.motion){ pasteGroup([clip.data],[clip.motion],6,5); toast('Pasted '+prettyType(clip.data.type)+' with its route'); return; }
    pendingType=clip.data.type; pendingOpts=cloneOpts(clip.data); pendingStamp=true; selOne(null); updateInspector();
    cv.style.cursor='crosshair'; updateHint(); toast('Click to stamp '+prettyType(clip.data.type)+' (Esc to stop)'); return; }
  pushUndo(); const d=clip.data; const np={...d,id:id(),owner:null,_lut:null,pts:d.pts.map(q=>({x:q.x+5,y:q.y+5})),anchors:d.anchors?d.anchors.map(q=>({x:q.x+5,y:q.y+5})):null};
  paths.push(np); selOne('path',np.id); updateInspector(); render();
}
function duplicateSelection(){ if(!selSet.length)return; pasteGroup(selPieces(),pathsForPieceCopy(selPieces(),selPaths()),5,4); toast('Duplicated '+selSet.length); }
function deleteSelection(){ if(!selSet.length)return; pushUndo();
  const pids=selPieces().map(p=>p.id), paIds=selPaths().map(p=>p.id);
  pieces=pieces.filter(p=>!pids.includes(p.id));
  paths=paths.filter(p=>!paIds.includes(p.id) && !pids.includes(p.owner));
  selOne(null); updateInspector(); render(); }
function finalizeMarquee(){ const x0=Math.min(marquee.x0,marquee.x1),x1=Math.max(marquee.x0,marquee.x1),y0=Math.min(marquee.y0,marquee.y1),y1=Math.max(marquee.y0,marquee.y1);
  const hits=[];
  pieces.forEach(p=>{ if(p.x>=x0&&p.x<=x1&&p.y>=y0&&p.y<=y1) hits.push({kind:'piece',id:p.id}); });
  paths.forEach(p=>{ const arr=p.anchors||p.pts||[]; if(arr.some(q=>q.x>=x0&&q.x<=x1&&q.y>=y0&&q.y<=y1)) hits.push({kind:'path',id:p.id}); });
  if(marquee.add){ hits.forEach(h=>{ if(!selContains(h.kind,h.id)) selSet.push(h); }); }
  else { selSet=hits; }
  sel = selSet.length? selSet[selSet.length-1] : null; updateInspector(); }
function addPiece(type, at, opts){
  pushUndo();
  const c=viewCenterWorld(); const pt=at||{x:c.x,y:c.y};
  const piece={ id:id(), type, x:pt.x, y:pt.y, size:1, rot:0,
    color: (type==='player'||type==='goalie') ? COLORS[playerColor] : (activeColor||undefined),
    num: type==='player'? String(nextNum()) : '', label:'', img:null };
  Object.assign(piece, opts||{});
  pieces.push(piece);
  selOne('piece',piece.id); updateInspector(); render(); toast(prettyType(piece.type)+' added');
}
function nextNum(){ const used=pieces.filter(p=>p.type==='player'&&p.color===COLORS[playerColor]).length; return used+1; }
function prettyType(t){ return ({player:'Skater',goalie:'Goalie',coach:'Coach',puck:'Puck',puckstack:'Pucks',ball:'Ball',net:'Net',cone:'Cone',tire:'Tire',bumper:'Bumper',ring:'Ring',dot:'Dot',zone:'Zone',image:'Image',text:'Text'})[t]||t; }
function defColor(t){ return ({cone:'#F2811D',net:'#D11C2C',bumper:'#E7B416',dot:'#D11C2C',tire:'#E7B416',puck:'#111418',puckstack:'#111418',ball:'#ffffff',ring:'#222831',coach:'#E7B416',zone:'#2FA866'})[t]||'#11181f'; }
function isDark(hex){ if(!hex)return true; const c=(hex+'').replace('#',''); const r=parseInt(c.substr(0,2),16),g=parseInt(c.substr(2,2),16),b=parseInt(c.substr(4,2),16); return (0.299*r+0.587*g+0.114*b)<140; }
function escapeHtml(s){ return (s||'').replace(/[&<>"\']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function getPiece(i){ return pieces.find(p=>p.id===i); }
function getPath(i){ return paths.find(p=>p.id===i); }

// =========================================================
//  RINK + PIECE RENDERING
// =========================================================
function clear(){ ctx.setTransform(DPR,0,0,DPR,0,0); ctx.clearRect(0,0,cv.clientWidth,cv.clientHeight); }

function drawRinkBg(p){
  const s=cam.s, kind=p.kind, full=(kind==='full');
  const W=full?RW:100, corner=Math.min(28, W*0.34);
  const X=x=>(x+p.ox)*s+cam.tx, Y=y=>(y+p.oy)*s+cam.ty;
  const red='#E8313A', blue='#3A9BDC', ink='#111418', greyfill='#E7ECEF';
  const thin=Math.max(1,0.55*s);      // circles, goal lines, trapezoid
  const thick=Math.max(1.4,0.85*s);   // blue lines + center line
  const board=Math.max(1.8,1.05*s);   // boards

  function boardPath(){ if(full){ roundRectPath(X(0),Y(0),W*s,RH*s,corner*s); }
    else { const r=corner*s;
      ctx.beginPath();
      ctx.moveTo(X(0)+r,Y(0)); ctx.lineTo(X(W),Y(0)); ctx.lineTo(X(W),Y(RH)); ctx.lineTo(X(0)+r,Y(RH));
      ctx.arcTo(X(0),Y(RH),X(0),Y(RH)-r,r); ctx.lineTo(X(0),Y(0)+r); ctx.arcTo(X(0),Y(0),X(0)+r,Y(0),r); ctx.closePath();
    } }

  boardPath(); ctx.fillStyle=document.body.classList.contains('dark-ice')?'#1a2835':'#FFFFFF'; ctx.fill();
  ctx.save(); boardPath(); ctx.clip();

  const V=(gx,col,w)=>{ ctx.strokeStyle=col; ctx.lineWidth=w; ctx.beginPath(); ctx.moveTo(X(gx),Y(0)); ctx.lineTo(X(gx),Y(RH)); ctx.stroke(); };
  const faceoff=(fx,fy)=>{ ctx.strokeStyle=red; ctx.lineWidth=thin; ctx.beginPath(); ctx.arc(X(fx),Y(fy),15*s,0,7); ctx.stroke();
    ctx.fillStyle=red; ctx.beginPath(); ctx.arc(X(fx),Y(fy),1.0*s,0,7); ctx.fill(); };
  const nzdot=(fx,fy)=>{ ctx.fillStyle=red; ctx.beginPath(); ctx.arc(X(fx),Y(fy),0.95*s,0,7); ctx.fill(); };
  const crease=(gx,dir)=>{ ctx.fillStyle='rgba(120,180,235,.18)'; ctx.strokeStyle=red; ctx.lineWidth=thin;
    ctx.beginPath(); ctx.arc(X(gx),Y(42.5),6*s, dir>0?-Math.PI/2:Math.PI/2, dir>0?Math.PI/2:3*Math.PI/2, false); ctx.closePath(); ctx.fill(); ctx.stroke(); };
  const netbox=(gx,dir)=>{
    // dir=1: left net (goal line at X(gx), net extends LEFT toward end boards)
    // dir=-1: right net (goal line at X(gx), net extends RIGHT toward end boards)
    const d=3.4*s, w=6*s, r=0.8*s;
    const gl=X(gx), bk=gl-dir*d;  // goal line x, back-of-net x
    const L=Math.min(gl,bk), R=Math.max(gl,bk);
    const T=Y(42.5)-w/2, B=Y(42.5)+w/2;
    ctx.fillStyle=greyfill; ctx.strokeStyle=red;
    // filled interior
    ctx.beginPath();
    if(dir>0){ // left net: back on left, goal line on right
      ctx.moveTo(R,T); ctx.lineTo(R,B);
      ctx.lineTo(L+r,B); ctx.quadraticCurveTo(L,B,L,B-r);
      ctx.lineTo(L,T+r); ctx.quadraticCurveTo(L,T,L+r,T);
    } else {   // right net: back on right, goal line on left
      ctx.moveTo(L,T); ctx.lineTo(L,B);
      ctx.lineTo(R-r,B); ctx.quadraticCurveTo(R,B,R,B-r);
      ctx.lineTo(R,T+r); ctx.quadraticCurveTo(R,T,R-r,T);
    }
    ctx.closePath(); ctx.fill();
    // goal line — thick vertical bar
    ctx.lineWidth=thin*2; ctx.beginPath(); ctx.moveTo(gl,T); ctx.lineTo(gl,B); ctx.stroke();
    // posts and back — thin
    ctx.lineWidth=thin; ctx.beginPath();
    if(dir>0){
      ctx.moveTo(gl,T); ctx.lineTo(L+r,T); ctx.quadraticCurveTo(L,T,L,T+r);
      ctx.lineTo(L,B-r); ctx.quadraticCurveTo(L,B,L+r,B); ctx.lineTo(gl,B);
    } else {
      ctx.moveTo(gl,T); ctx.lineTo(R-r,T); ctx.quadraticCurveTo(R,T,R,T+r);
      ctx.lineTo(R,B-r); ctx.quadraticCurveTo(R,B,R-r,B); ctx.lineTo(gl,B);
    }
    ctx.stroke(); };
  const trapezoid=(gx,boardx)=>{ if(!showTrap)return; ctx.strokeStyle=red; ctx.lineWidth=thin;
    ctx.beginPath(); ctx.moveTo(X(gx),Y(42.5-11)); ctx.lineTo(X(boardx),Y(42.5-14)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(X(gx),Y(42.5+11)); ctx.lineTo(X(boardx),Y(42.5+14)); ctx.stroke(); };

  if(full){
    V(11,red,thin); V(189,red,thin);
    V(75,blue,thick); V(125,blue,thick); V(100,red,thick);
    [[31,20.5],[31,64.5],[169,20.5],[169,64.5]].forEach(([a,b])=>faceoff(a,b));
    [[80,20.5],[80,64.5],[120,20.5],[120,64.5]].forEach(([a,b])=>nzdot(a,b));
    ctx.strokeStyle=blue; ctx.lineWidth=thin; ctx.beginPath(); ctx.arc(X(100),Y(42.5),15*s,0,7); ctx.stroke();
    ctx.fillStyle=red; ctx.beginPath(); ctx.arc(X(100),Y(42.5),0.95*s,0,7); ctx.fill();
    trapezoid(11,0); trapezoid(189,200);
    netbox(11,1); netbox(189,-1); crease(11,1); crease(189,-1);
  } else {
    V(11,red,thin); V(75,blue,thick); V(100,red,thick);
    [[31,20.5],[31,64.5]].forEach(([a,b])=>faceoff(a,b));
    [[80,20.5],[80,64.5]].forEach(([a,b])=>nzdot(a,b));
    ctx.strokeStyle=blue; ctx.lineWidth=thin; ctx.beginPath(); ctx.arc(X(100),Y(42.5),15*s,0,7); ctx.stroke();
    ctx.fillStyle=red; ctx.beginPath(); ctx.arc(X(100),Y(42.5),0.95*s,0,7); ctx.fill();
    trapezoid(11,0); netbox(11,1); crease(11,1);
  }
  ctx.restore();
  // redraw board outline on top so line bleeds are covered
  ctx.lineWidth=board; ctx.strokeStyle=ink; ctx.lineJoin='round'; boardPath(); ctx.stroke();

  if(full && centerLogo && LOGO_IMG[centerLogo] && LOGO_IMG[centerLogo].complete && LOGO_IMG[centerLogo].naturalWidth){
    const img=LOGO_IMG[centerLogo]; const ratio=img.naturalWidth/img.naturalHeight;
    let hh=22*s, ww=hh*ratio; const maxW=28*s; if(ww>maxW){ww=maxW; hh=ww/ratio;}
    ctx.save(); ctx.globalAlpha=0.95; ctx.drawImage(img, X(100)-ww/2, Y(42.5)-hh/2, ww, hh); ctx.restore();
  }
}
function drawIceplexBg(p){
  const s=cam.s;
  const X=x=>(x+p.ox)*s+cam.tx, Y=y=>(y+p.oy)*s+cam.ty;
  const dark=document.body.classList.contains('dark-ice');

  const floor   = dark?'#1c1c24':'#d0ccc4';
  const iceCol  = dark?'#182838':'#ddeef8';
  const wallCol = dark?'#2c2c3a':'#8a8478';
  const lobbyCol= dark?'#20202c':'#b4aca0';
  const tealCol = dark?'#0e3030':'#7ecece';
  const tealDark= dark?'#0a2424':'#52aaaa';
  const greenCol= dark?'#142a18':'#7ab87a';
  const entrCol = dark?'#1a2a3a':'#98b8cc';
  const ink     = dark?'rgba(220,235,255,0.92)':'rgba(12,12,32,0.92)';
  const inkFade = dark?'rgba(180,200,230,0.6)':'rgba(30,30,60,0.5)';
  const wall    = Math.max(2,1.2*s);
  const lw      = Math.max(1,0.45*s);

  // helpers
  function fillBox(x,y,w,h,col){ ctx.fillStyle=col; ctx.fillRect(X(x),Y(y),w*s,h*s); }
  function box(x,y,w,h,fill,stroke,lwd=lw){ fillBox(x,y,w,h,fill); ctx.strokeStyle=stroke; ctx.lineWidth=lwd; ctx.strokeRect(X(x),Y(y),w*s,h*s); }
  function hline(x1,x2,y,col,lwd=lw){ ctx.strokeStyle=col; ctx.lineWidth=lwd; ctx.beginPath(); ctx.moveTo(X(x1),Y(y)); ctx.lineTo(X(x2),Y(y)); ctx.stroke(); }
  function vline(x,y1,y2,col,lwd=lw){ ctx.strokeStyle=col; ctx.lineWidth=lwd; ctx.beginPath(); ctx.moveTo(X(x),Y(y1)); ctx.lineTo(X(x),Y(y2)); ctx.stroke(); }
  function txt(cx,cy,str,sz,bold,col,align='center'){
    ctx.fillStyle=col||ink; ctx.textAlign=align; ctx.textBaseline='middle';
    ctx.font=`${bold?'bold ':''}${Math.max(5,sz*s)}px Inter,sans-serif`;
    ctx.fillText(str,X(cx),Y(cy));
  }
  function rotTxt(cx,cy,str,sz,bold,col){
    ctx.save(); ctx.fillStyle=col||ink; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.font=`${bold?'bold ':''}${Math.max(5,sz*s)}px Inter,sans-serif`;
    ctx.translate(X(cx),Y(cy)); ctx.rotate(-Math.PI/2); ctx.fillText(str,0,0); ctx.restore();
  }
  function marker(cx,cy,letter,bgCol){
    const r=Math.max(4,2.8*s);
    ctx.fillStyle=bgCol||'#1a3a6a'; ctx.beginPath(); ctx.arc(X(cx),Y(cy),r,0,7); ctx.fill();
    ctx.fillStyle='#fff'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.font=`bold ${Math.max(5,2.2*s)}px Inter,sans-serif`;
    ctx.fillText(letter,X(cx),Y(cy));
  }

  // ── LAYOUT (all in "feet" units) ─────────────────────────
  // Horizontal — left to right:
  const xHops=0,  wHops=20;          // Hockey Ops solid wall
  const xCorL=20, wCorL=22;          // open corridor L of SB
  const xSB=42,   wRink=92;          // Starbucks rink
  const xGap=134, wGap=34;           // floor gap SB↔SS
  const xSS=168,  _wSS=wRink;        // Smartsheet rink (same width)
  const xLock=260,wLock=50;          // MPR + locker section
  const xVM=310,  wVM=wRink;         // Virginia Mason rink
  const xRwall=402,wRwall=12;        // thin right wall
  const xPark=414, wPark=44;         // external park

  // Vertical — top to bottom:
  const yEntrance=-18, hEntrance=18; // East entrance above main box
  const yLobby=0,  hLobby=36;       // lobby/concessions band
  const yRink=36,  hRink=200;        // rink length
  const yBot=236,  hBot=22;          // bottom corridor
  // (IH = 258 ≈ 260 set above)

  // MPR + locker sub-layout (within xLock column):
  const yMPR=yEntrance, hMPR=hEntrance+hLobby+14; // MPR spans entrance+lobby+into rink zone
  const yLockers=yMPR+hMPR, hLockers=yBot+hBot-yLockers;

  // ── Building floor (main rectangle) ──────────────────────
  fillBox(0,yLobby,xPark,IH-yLobby-0, floor);

  // ── Public park (outside right) ──────────────────────────
  fillBox(xPark,yLobby,wPark,IH-yLobby, greenCol);
  ctx.strokeStyle='#4a7a4a'; ctx.lineWidth=lw;
  ctx.strokeRect(X(xPark),Y(yLobby),wPark*s,(IH-yLobby)*s);
  rotTxt(xPark+wPark/2, yLobby+(IH-yLobby)/2,'PUBLIC PARK',2.4,true,dark?'#2a5a2a':'#1a4a1a');

  // ── Hockey Operations wall (left) ────────────────────────
  box(xHops,yLobby,wHops,IH-yLobby, wallCol,'#555',wall);
  rotTxt(xHops+wHops/2, yLobby+(IH-yLobby)/2,'HOCKEY OPERATIONS',2.0,true,inkFade);

  // ── Left corridor (SB left side — usable floor) ──────────
  box(xCorL,yRink,wCorL,hRink+hBot, dark?'#1a1a22':'#bab4aa','#666');
  // dashed center line to suggest usable space
  ctx.setLineDash([Math.max(3,1.2*s),Math.max(3,1.2*s)]);
  vline(xCorL+wCorL/2,yRink+4,yRink+hRink-4,dark?'#444':'#999',Math.max(0.5,0.3*s));
  ctx.setLineDash([]);
  rotTxt(xCorL+wCorL/2, yRink+hRink*0.5,'CORRIDOR',1.7,false,inkFade);

  // ── Floor gap SB ↔ SS (substantial dryland/circulation) ──
  box(xGap,yRink,wGap,hRink+hBot, dark?'#1a1a22':'#bab4aa','#666');
  ctx.setLineDash([Math.max(3,1.2*s),Math.max(3,1.2*s)]);
  vline(xGap+wGap/2,yRink+4,yRink+hRink-4,dark?'#444':'#999',Math.max(0.5,0.3*s));
  ctx.setLineDash([]);
  rotTxt(xGap+wGap/2, yRink+hRink*0.5,'FLOOR SPACE',1.7,false,inkFade);

  // ── Bottom corridor (below rinks) ────────────────────────
  box(xCorL,yBot,xRwall-xCorL,hBot, lobbyCol,'#777');

  // ── East Public Entrance (angled notch top-right) ─────────
  // The entrance juts above the main building line
  fillBox(xLock+wLock*0.35,yEntrance,wVM+wRwall+wLock*0.65,hEntrance,entrCol);
  ctx.strokeStyle='#5588aa'; ctx.lineWidth=Math.max(1.5,0.7*s);
  ctx.strokeRect(X(xLock+wLock*0.35),Y(yEntrance),(wVM+wRwall+wLock*0.65)*s,hEntrance*s);
  txt(xLock+wLock*0.35+(wVM+wRwall+wLock*0.65)/2, yEntrance+hEntrance/2,'EAST PUBLIC ENTRANCE',2.0,true,dark?'#aaccee':'#1a3a5a');
  // stairs label
  txt(xVM+wVM*0.65, yEntrance+hEntrance*0.5,'STAIRS\nTO LEVEL 2',1.5,false,dark?'#88aacc':'#2a4a6a');
  // "C" entrance marker
  marker(xVM+wVM*0.7, yLobby-4,'C','#1a5a9a');

  // ── MPR room ─────────────────────────────────────────────
  box(xLock,yMPR,wLock,hMPR, tealCol,'#2a8888',Math.max(1.5,0.7*s));
  txt(xLock+wLock/2, yMPR+hMPR*0.38,'MPR',2.6,true,dark?'#003838':'#002828');
  txt(xLock+wLock/2, yMPR+hMPR*0.65,'815 sq ft',1.8,false,dark?'#003838':'#002828');

  // ── Locker rooms 1-14 (2×7 grid, teal) ──────────────────
  box(xLock,yLockers,wLock,hLockers, tealCol,'#2a8888',Math.max(1.5,0.7*s));
  const lcols=2, lrows=7;
  const cellW=wLock/lcols, cellH=hLockers/lrows;
  for(let r=0;r<lrows;r++) for(let c=0;c<lcols;c++){
    const n=r*lcols+c+1;
    const cx=xLock+c*cellW, cy=yLockers+r*cellH;
    ctx.strokeStyle=tealDark; ctx.lineWidth=Math.max(0.5,0.3*s);
    ctx.strokeRect(X(cx),Y(cy),cellW*s,cellH*s);
    txt(cx+cellW/2, cy+cellH/2, String(n),1.9,true,dark?'#003838':'#002828');
  }
  // "LOCKER ROOMS" vertical label in right half of section
  rotTxt(xLock+wLock*0.78, yLockers+hLockers/2,'LOCKER ROOMS',1.9,true,dark?'#003838':'#002828');

  // ── Top lobby / concessions ───────────────────────────────
  // Spans above SB and SS rinks; NOT above locker/VM section
  box(xCorL,yLobby,xLock-xCorL,hLobby, lobbyCol,'#777');
  // "B" entrance marker (between SB and SS, at lobby top)
  marker(xGap+wGap/2, yLobby+6,'B','#1a5a9a');
  // Guest services label (dark banner, centered above SS)
  const gsX=xSS-8, gsW=wRink+16;
  ctx.fillStyle='rgba(10,20,35,0.72)';
  ctx.fillRect(X(gsX),Y(yLobby+3),(gsW)*s,Math.max(10,6.5*s));
  ctx.fillStyle='#fff'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.font=`bold ${Math.max(5,1.8*s)}px Inter,sans-serif`;
  ctx.fillText('GUEST SERVICES, SKATE RENTALS & CONCESSIONS',X(gsX+gsW/2),Y(yLobby+3)+Math.max(10,6.5*s)/2);

  // Lobby also extends above VM rink
  box(xVM,yLobby,wVM+wRwall,hLobby, lobbyCol,'#777');

  // ── "A" Kraken Office entrance (top of left corridor) ────
  marker(xCorL+wCorL/2, yLobby+6,'A','#1a5a9a');

  // ── "D" West entrance (bottom left) ──────────────────────
  marker(xCorL+4, yBot+hBot/2,'D','#1a5a9a');

  // ── Outer building wall (on top of everything) ────────────
  ctx.strokeStyle='#333'; ctx.lineWidth=wall;
  ctx.strokeRect(X(0),Y(yLobby),xPark*s,(IH-yLobby)*s);

  // ── Ice rink ─────────────────────────────────────────────
  function drawRink(rx,ry,rw,rh,name1,name2,cap){
    // rounded end caps (portrait rink, ends at top/bottom)
    const cr=Math.min(rw*0.52,rh*0.12)*s;
    ctx.fillStyle=iceCol;
    ctx.beginPath();
    ctx.moveTo(X(rx)+cr,Y(ry));
    ctx.arcTo(X(rx+rw),Y(ry),X(rx+rw),Y(ry+rh),cr);
    ctx.arcTo(X(rx+rw),Y(ry+rh),X(rx),Y(ry+rh),cr);
    ctx.arcTo(X(rx),Y(ry+rh),X(rx),Y(ry),cr);
    ctx.arcTo(X(rx),Y(ry),X(rx+rw),Y(ry),cr);
    ctx.closePath(); ctx.fill();
    // boards — red
    ctx.strokeStyle='#cc2233'; ctx.lineWidth=Math.max(2,0.8*s); ctx.stroke();
    const cy=ry+rh/2;
    // red center line
    hline(rx+rw*0.06,rx+rw*0.94,cy,'#cc2233',Math.max(1.5,0.6*s));
    // blue lines at ~30% and ~70% of rink length
    [ry+rh*0.295, ry+rh*0.705].forEach(by=>{
      hline(rx+rw*0.06,rx+rw*0.94,by,'#2244bb',Math.max(1.2,0.5*s));
    });
    // center circle (large)
    ctx.strokeStyle='#2244bb'; ctx.lineWidth=Math.max(1,0.45*s);
    ctx.beginPath(); ctx.arc(X(rx+rw/2),Y(cy),rw*0.23*s,0,7); ctx.stroke();
    ctx.fillStyle='#cc2233'; ctx.beginPath(); ctx.arc(X(rx+rw/2),Y(cy),Math.max(2.5,1.0*s),0,7); ctx.fill();
    // faceoff circles + dots — end zones
    [ry+rh*0.175, ry+rh*0.825].forEach(fy=>{
      [rx+rw*0.27,rx+rw*0.73].forEach(fx=>{
        ctx.strokeStyle='#cc2233'; ctx.lineWidth=Math.max(1,0.4*s);
        ctx.beginPath(); ctx.arc(X(fx),Y(fy),rw*0.145*s,0,7); ctx.stroke();
        ctx.fillStyle='#cc2233'; ctx.beginPath(); ctx.arc(X(fx),Y(fy),Math.max(2,0.9*s),0,7); ctx.fill();
      });
    });
    // neutral zone faceoff dots (at blue lines)
    [ry+rh*0.295,ry+rh*0.705].forEach(fy=>{
      [rx+rw*0.27,rx+rw*0.73].forEach(fx=>{
        ctx.fillStyle='#cc2233'; ctx.beginPath(); ctx.arc(X(fx),Y(fy),Math.max(2,0.9*s),0,7); ctx.fill();
      });
    });
    // goal lines (10% from each end)
    hline(rx+rw*0.08,rx+rw*0.92,ry+rh*0.107,'#cc2233',Math.max(1,0.4*s));
    hline(rx+rw*0.08,rx+rw*0.92,ry+rh*0.893,'#cc2233',Math.max(1,0.4*s));
    // goal creases (semicircle at each end)
    [ry+rh*0.107, ry+rh*0.893].forEach((gy,i)=>{
      ctx.strokeStyle='#cc2233'; ctx.lineWidth=Math.max(1,0.4*s);
      ctx.beginPath();
      const dir=i===0?1:-1;
      ctx.arc(X(rx+rw/2),Y(gy),rw*0.13*s, dir>0?0:Math.PI, dir>0?Math.PI:0, i===0);
      ctx.stroke();
    });
    // player benches — long sides, middle third
    const bW=rw*0.34*s, bH=Math.max(3,1.4*s);
    const bY=Y(cy)-bH/2;
    ctx.fillStyle='#3a6ab8';
    ctx.fillRect(X(rx)-bH, bY, bH, bW);           // left bench
    ctx.fillRect(X(rx+rw), bY, bH, bW);            // right bench
    // penalty boxes (shorter, beside benches)
    ctx.fillStyle='#5a4a8a';
    ctx.fillRect(X(rx)-bH, Y(cy-rh*0.07)-bH/2, bH, Math.max(3,1.0*s));
    ctx.fillRect(X(rx+rw), Y(cy-rh*0.07)-bH/2, bH, Math.max(3,1.0*s));
    // rink name dark banner
    const banH=Math.max(9,6*s);
    ctx.fillStyle='rgba(8,14,24,0.65)';
    ctx.fillRect(X(rx+rw*0.06),Y(cy+3)-banH/2,(rw*0.88)*s,banH);
    ctx.fillStyle='#fff'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.font=`bold ${Math.max(5,2.1*s)}px Inter,sans-serif`;
    ctx.fillText(name1,X(rx+rw/2),Y(cy+3));
    if(name2){
      ctx.font=`${Math.max(4,1.5*s)}px Inter,sans-serif`;
      ctx.fillText(name2,X(rx+rw/2),Y(cy+3)+Math.max(6,3.2*s));
    }
    // capacity label
    if(cap){
      ctx.fillStyle='rgba(8,14,24,0.55)';
      const capH=Math.max(7,4.5*s);
      ctx.fillRect(X(rx+rw*0.28),Y(cy+3+8)-capH/2,rw*0.44*s,capH);
      ctx.fillStyle='#cce'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.font=`${Math.max(4,1.6*s)}px Inter,sans-serif`;
      ctx.fillText(cap,X(rx+rw/2),Y(cy+3+8));
    }
  }

  drawRink(xSB, yRink, wRink, hRink, 'STARBUCKS RINK', null,'👥 500');
  drawRink(xSS, yRink, wRink, hRink, 'SMARTSHEET RINK');
  drawRink(xVM, yRink, wVM,   hRink, 'VIRGINIA MASON','FRANCISCAN HEALTH RINK');
}

function drawFieldBg(p){
  const s=cam.s;
  const X=x=>(x+p.ox)*s+cam.tx, Y=y=>(y+p.oy)*s+cam.ty;
  const dark=document.body.classList.contains('dark-ice');
  const grass=dark?'#1a3320':'#3a7d44';
  const grassAlt=dark?'#1e3d26':'#4a8f54';
  const pavement=dark?'#383530':'#b8b0a0';
  const white='rgba(255,255,255,0.88)';
  const lw=Math.max(1,0.55*s);

  // Stadium shape: straight long sides, large semicircular short ends
  // Corner radius = ~42% of height so short ends are nearly semicircular
  const cr=FH*0.42*s;

  function fieldPath(){
    const x=X(0),y=Y(0),w=FW*s,h=FH*s;
    ctx.beginPath();
    ctx.moveTo(x+cr,y);
    ctx.lineTo(x+w-cr,y);
    ctx.arcTo(x+w,y,x+w,y+h,cr);
    ctx.lineTo(x+w,y+h-cr);  // not needed if arcTo handles it
    ctx.arcTo(x+w,y+h,x,y+h,cr);
    ctx.lineTo(x+cr,y+h);
    ctx.arcTo(x,y+h,x,y,cr);
    ctx.lineTo(x,y+cr);
    ctx.arcTo(x,y,x+w,y,cr);
    ctx.closePath();
  }

  // Wide pavement canvas behind everything
  ctx.fillStyle=pavement;
  ctx.fillRect(X(-15),Y(-40),(FW+55)*s,(FH+110)*s);

  // Grass
  fieldPath(); ctx.fillStyle=grass; ctx.fill();
  ctx.save(); fieldPath(); ctx.clip();

  // Mow stripes
  const stripes=12, sw=FW/stripes;
  for(let i=0;i<stripes;i++){
    if(i%2===0){ ctx.fillStyle=grassAlt; ctx.fillRect(X(i*sw),Y(0),sw*s,FH*s); }
  }

  // Field markings
  ctx.strokeStyle=white; ctx.lineWidth=lw; ctx.lineJoin='round'; ctx.lineCap='round';
  const m=4;

  // boundary line (inset)
  const icr=Math.max(0,cr-m*s);
  const bx=X(m),by=Y(m),bw=(FW-m*2)*s,bh=(FH-m*2)*s;
  ctx.beginPath();
  ctx.moveTo(bx+icr,by); ctx.lineTo(bx+bw-icr,by);
  ctx.arcTo(bx+bw,by,bx+bw,by+bh,icr); ctx.lineTo(bx+bw,by+bh-icr);
  ctx.arcTo(bx+bw,by+bh,bx,by+bh,icr); ctx.lineTo(bx+icr,by+bh);
  ctx.arcTo(bx,by+bh,bx,by,icr); ctx.lineTo(bx,by+icr);
  ctx.arcTo(bx,by,bx+bw,by,icr); ctx.closePath(); ctx.stroke();

  // halfway line
  ctx.beginPath(); ctx.moveTo(X(FW/2),Y(m)); ctx.lineTo(X(FW/2),Y(FH-m)); ctx.stroke();

  // center circle
  ctx.beginPath(); ctx.arc(X(FW/2),Y(FH/2),9*s,0,7); ctx.stroke();
  ctx.fillStyle=white; ctx.beginPath(); ctx.arc(X(FW/2),Y(FH/2),0.85*s,0,7); ctx.fill();

  // penalty areas
  const pa=20,pd=14;
  ctx.strokeRect(X(m),Y(FH/2-pa/2),pd*s,pa*s);
  ctx.strokeRect(X(FW-m-pd),Y(FH/2-pa/2),pd*s,pa*s);

  // goal boxes
  const gb=8,gd=5;
  ctx.strokeRect(X(m),Y(FH/2-gb/2),gd*s,gb*s);
  ctx.strokeRect(X(FW-m-gd),Y(FH/2-gb/2),gd*s,gb*s);

  ctx.restore();

  // Field border
  ctx.strokeStyle=dark?'#1a3a20':'#14421e';
  ctx.lineWidth=Math.max(2,1.4*s); ctx.lineJoin='round';
  fieldPath(); ctx.stroke();

  // --- Ping pong tables: top-right corner of pavement ---
  const tw=5,th=9,tgap=4;
  const ptx=FW-22, pty=-28;
  ctx.lineWidth=Math.max(0.8,0.5*s);
  for(let col=0;col<2;col++){
    const tx=ptx+col*(tw+tgap), ty=pty;
    ctx.fillStyle='rgba(50,90,200,0.18)'; ctx.fillRect(X(tx),Y(ty),tw*s,th*s);
    ctx.strokeStyle='rgba(50,90,200,0.85)'; ctx.strokeRect(X(tx),Y(ty),tw*s,th*s);
    ctx.beginPath(); ctx.moveTo(X(tx),Y(ty+th/2)); ctx.lineTo(X(tx+tw),Y(ty+th/2)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(X(tx+tw/2),Y(ty)); ctx.lineTo(X(tx+tw/2),Y(ty+th)); ctx.stroke();
  }
  ctx.fillStyle='rgba(50,90,200,0.75)';
  ctx.font=`bold ${Math.max(6,2.2*s)}px Inter,sans-serif`;
  ctx.textAlign='center';
  ctx.fillText('Ping Pong', X(ptx+tw+tgap/2), Y(pty+th+3));

  // --- KCI building below the field ---
  const kx=10, ky=FH+28, kw=FW-20, kh=14;
  ctx.fillStyle='rgba(80,60,40,0.25)';
  ctx.fillRect(X(kx),Y(ky),kw*s,kh*s);
  ctx.strokeStyle='rgba(80,60,40,0.7)';
  ctx.lineWidth=Math.max(1,0.6*s);
  ctx.strokeRect(X(kx),Y(ky),kw*s,kh*s);
  // windows/detail lines
  ctx.strokeStyle='rgba(80,60,40,0.35)'; ctx.lineWidth=Math.max(0.5,0.3*s);
  for(let i=1;i<5;i++){
    const wx=kx+i*(kw/5);
    ctx.beginPath(); ctx.moveTo(X(wx),Y(ky)); ctx.lineTo(X(wx),Y(ky+kh)); ctx.stroke();
  }
  ctx.fillStyle='rgba(60,40,20,0.8)';
  ctx.font=`bold ${Math.max(8,3.5*s)}px Inter,sans-serif`;
  ctx.textAlign='center';
  ctx.fillText('KCI', X(FW/2), Y(ky+kh/2+1.5));
}

function roundRectPath(x,y,w,h,r){ r=Math.max(0,Math.min(r,Math.abs(w)/2,Math.abs(h)/2));
  ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }

// piece drawing in screen space. pos optional override (animation)
function drawPiece(p, pos){
  const [sx,sy]= pos? W2S(pos.x,pos.y) : W2S(p.x,p.y);
  ctx.save(); ctx.translate(sx,sy);
  if(p.type==='image') ctx.globalAlpha = p.opacity!=null? p.opacity : 1;
  const scale = cam.s;
  drawPieceShape(ctx, p, scale, false);
  ctx.restore();
  if(selContains('piece',p.id)){
    const r=pieceRadius(p)*cam.s + 6;
    ctx.strokeStyle='#5BC2D6'; ctx.lineWidth=2; ctx.setLineDash([5,4]);
    ctx.beginPath(); ctx.arc(sx,sy,r,0,7); ctx.stroke(); ctx.setLineDash([]);
  }
}
function pieceRadius(p){ // in feet
  const b={player:2.6,goalie:3.0,coach:2.6,puck:1.0,puckstack:2.0,ball:1.6,net:3.4,cone:1.6,tire:2.0,bumper:7,ring:2.2,dot:1.2,image:8,zone:10}[p.type]||2;
  return b*(p.size||1);
}
function drawPieceShape(c, p, scale, thumb){
  const z=scale, size=p.size||1;
  const col=p.color||'#1E7FA0';
  c.save();
  if(p.rot) c.rotate(p.rot*Math.PI/180);
  switch(p.type){
    case 'player':{
      const r=2.6*z*size;
      if(p.shape==='triangle'){
        c.fillStyle=col; c.beginPath(); c.moveTo(0,-r*1.15); c.lineTo(r,r*0.85); c.lineTo(-r,r*0.85); c.closePath(); c.fill();
        c.lineWidth=Math.max(1.5,r*0.13); c.strokeStyle='rgba(0,0,0,.35)'; c.stroke();
        label(c, p.num||'', r, col, r*0.18);
      } else {
        c.fillStyle=col; c.beginPath(); c.arc(0,0,r,0,7); c.fill();
        c.lineWidth=Math.max(1.5,r*0.13); c.strokeStyle='rgba(0,0,0,.35)'; c.stroke();
        label(c, p.num||'', r, col);
      }
      break; }
    case 'goalie':{
      const r=2.8*z*size;
      c.fillStyle=col; c.beginPath();
      c.moveTo(-r*1.15,r*0.2); c.lineTo(-r*1.15,r); c.lineTo(r*1.15,r); c.lineTo(r*1.15,r*0.2); c.closePath(); c.fill(); // pads
      c.beginPath(); c.arc(0,-r*0.1,r,0,7); c.fill();
      c.lineWidth=Math.max(1.5,r*0.12); c.strokeStyle='rgba(0,0,0,.35)'; c.stroke();
      label(c,'G',r,col,-r*0.1);
      break; }
    case 'coach':{
      const r=2.6*z*size; const cc=p.color||'#E7B416';
      c.fillStyle=cc; c.beginPath(); c.arc(0,0,r,0,7); c.fill();
      c.lineWidth=Math.max(1.5,r*0.12); c.strokeStyle='rgba(0,0,0,.4)'; c.stroke();
      label(c,'C',r,cc);
      break; }
    case 'puck':{
      const r=1.1*z*size; c.fillStyle=p.color||'#111'; c.beginPath(); c.ellipse(0,0,r,r*0.6,0,0,7); c.fill();
      c.strokeStyle='#444'; c.lineWidth=1; c.stroke(); break; }
    case 'ball':{
      const r=1.6*z*size;
      // white sphere
      c.fillStyle=p.color||'#fff'; c.beginPath(); c.arc(0,0,r,0,7); c.fill();
      c.strokeStyle='#222'; c.lineWidth=Math.max(0.8,r*0.1); c.stroke();
      // pentagon patches — simplified as small black arcs
      c.fillStyle='#111';
      const pts=[[0,-r*0.55],[r*0.52,-r*0.17],[ r*0.32,r*0.45],[-r*0.32,r*0.45],[-r*0.52,-r*0.17]];
      pts.forEach(([px,py])=>{ c.beginPath(); c.arc(px,py,r*0.22,0,7); c.fill(); });
      break; }
    case 'net':{
      // Top-down hockey net: wide opening at top, rounded back corners
      const W=6*z*size, D=4*z*size, r=1.2*z*size;
      const lw=Math.max(1.8,0.6*z);
      const L=-W/2, R=W/2, T=-D/2, B=D/2;
      c.strokeStyle=p.color||'#D11C2C'; c.fillStyle='rgba(209,28,44,.10)';
      // filled shape: open top, rounded bottom corners
      c.beginPath();
      c.moveTo(L,T); c.lineTo(R,T);
      c.lineTo(R,B-r); c.quadraticCurveTo(R,B,R-r,B);
      c.lineTo(L+r,B); c.quadraticCurveTo(L,B,L,B-r);
      c.closePath(); c.fill();
      // goal line — thick front bar
      c.lineWidth=lw*2; c.beginPath(); c.moveTo(L,T); c.lineTo(R,T); c.stroke();
      // posts and rounded back
      c.lineWidth=lw;
      c.beginPath();
      c.moveTo(L,T); c.lineTo(L,B-r); c.quadraticCurveTo(L,B,L+r,B);
      c.lineTo(R-r,B); c.quadraticCurveTo(R,B,R,B-r); c.lineTo(R,T);
      c.stroke();
      break; }
    case 'cone':{
      const r=1.7*z*size; c.fillStyle=p.color||'#F2811D'; c.beginPath();
      c.moveTo(0,-r*1.3); c.lineTo(r,r); c.lineTo(-r,r); c.closePath(); c.fill();
      c.strokeStyle='#9c4f0a'; c.lineWidth=1; c.stroke(); break; }
    case 'tire':{
      const r=2.0*z*size; c.fillStyle='#222'; c.beginPath(); c.arc(0,0,r,0,7); c.fill();
      c.fillStyle=thumb?'#EAF6FB':'#E2F1F8'; c.beginPath(); c.arc(0,0,r*0.5,0,7); c.fill();
      c.strokeStyle=p.color||'#E7B416'; c.lineWidth=Math.max(1.5,r*0.18); c.beginPath(); c.arc(0,0,r*0.75,0,7); c.stroke(); break; }
    case 'bumper':{
      const L=7*z*size, h=1.4*z*size; c.fillStyle=p.color||'#E7B416';
      roundRectShape(c,-L,-h,2*L,2*h,h*0.7); c.fill();
      c.strokeStyle='#8a6a00'; c.lineWidth=1; c.stroke(); break; }
    case 'dot':{
      const r=1.2*z*size; c.fillStyle=p.color||'#D11C2C'; c.beginPath(); c.arc(0,0,r,0,7); c.fill(); break; }
    case 'ring':{
      const r=2.2*z*size; c.strokeStyle=p.color||'#222831'; c.lineWidth=Math.max(2,r*0.28);
      c.beginPath(); c.arc(0,0,r,0,7); c.stroke(); break; }
    case 'zone':{
      // highlighted area circle — size maps to radius in feet (default ~10ft)
      const r=(thumb?12:10*cam.s)*size;
      const col=p.color||'#2FA866';
      c.fillStyle=col; c.globalAlpha=0.15; c.beginPath(); c.arc(0,0,r,0,7); c.fill();
      c.globalAlpha=1; c.strokeStyle=col; c.lineWidth=Math.max(2,0.5*(thumb?1:cam.s));
      c.setLineDash([Math.max(5,0.8*(thumb?1:cam.s)),Math.max(4,0.6*(thumb?1:cam.s))]);
      c.beginPath(); c.arc(0,0,r,0,7); c.stroke(); c.setLineDash([]); break; }
    case 'puckstack':{
      const r=0.72*z*size; c.fillStyle=p.color||'#111';
      [[-1,-1],[1,-1],[0,0],[-1,1],[1,1]].forEach(([ox,oy])=>{ c.beginPath(); c.ellipse(ox*r*1.15,oy*r*1.15,r,r*0.62,0,0,7); c.fill(); });
      break; }
    case 'text':{
      const fs=Math.max(9,(p.size||1)*5*z);
      c.font=`700 ${fs}px Inter,system-ui,sans-serif`; c.textAlign='center'; c.textBaseline='middle';
      const tx=p.text||''; const m=c.measureText(tx);
      p._wft=(m.width/z); p._hft=(fs/z);
      c.lineJoin='round'; c.lineWidth=Math.max(3,fs*0.2);
      c.strokeStyle = isDark(p.color)? 'rgba(255,255,255,.95)' : 'rgba(8,16,24,.9)';
      c.strokeText(tx,0,0);
      c.fillStyle=p.color||'#11181f'; c.fillText(tx,0,0);
      break; }
    case 'image':{
      if(p.img && p.img.complete){
        const w=8*z*size, hh=w*(p.img.height/p.img.width||0.6);
        c.drawImage(p.img,-w/2,-hh/2,w,hh);
      } else { c.fillStyle='#193449'; roundRectShape(c,-30,-20,60,40,6); c.fill(); }
      break; }
  }
  c.restore();
  function label(c,t,r,bg,oy=0){ if(!t)return;
    c.fillStyle = isDark(bg||'#1E7FA0') ? '#fff' : '#10202C';
    const fs = r*(String(t).length>2?0.6:String(t).length>1?0.78:0.95);
    c.font=`700 ${fs}px Inter,system-ui,sans-serif`; c.textAlign='center'; c.textBaseline='middle';
    c.fillText(t,0,oy); }
  function roundRectShape(c,x,y,w,h,r){ r=Math.min(r,w/2,h/2);
    c.beginPath(); c.moveTo(x+r,y); c.arcTo(x+w,y,x+w,y+h,r); c.arcTo(x+w,y+h,x,y+h,r);
    c.arcTo(x,y+h,x,y,r); c.arcTo(x,y,x+w,y,r); c.closePath(); }
}

// =========================================================
//  PATH / MOTION HELPERS
// =========================================================
function catmull(A, seg){
  if(!A||A.length<2) return (A||[]).map(p=>({x:p.x,y:p.y}));
  if(A.length===2) return [{x:A[0].x,y:A[0].y},{x:A[1].x,y:A[1].y}];
  seg=seg||16; const out=[]; const pts=[A[0],...A,A[A.length-1]];
  for(let i=1;i<pts.length-2;i++){ const p0=pts[i-1],p1=pts[i],p2=pts[i+1],p3=pts[i+2];
    for(let t=0;t<seg;t++){ const u=t/seg,u2=u*u,u3=u2*u;
      out.push({ x:0.5*((2*p1.x)+(-p0.x+p2.x)*u+(2*p0.x-5*p1.x+4*p2.x-p3.x)*u2+(-p0.x+3*p1.x-3*p2.x+p3.x)*u3),
                 y:0.5*((2*p1.y)+(-p0.y+p2.y)*u+(2*p0.y-5*p1.y+4*p2.y-p3.y)*u2+(-p0.y+3*p1.y-3*p2.y+p3.y)*u3) }); } }
  out.push({x:A[A.length-1].x,y:A[A.length-1].y}); return out;
}
function rdp(pts, eps){
  if(pts.length<3) return pts.slice();
  let dmax=0, idx=0; const a=pts[0], b=pts[pts.length-1];
  for(let i=1;i<pts.length-1;i++){ const d=distToSeg(pts[i].x,pts[i].y,a,b); if(d>dmax){dmax=d;idx=i;} }
  if(dmax>eps){ const l=rdp(pts.slice(0,idx+1),eps), r=rdp(pts.slice(idx),eps); return l.slice(0,-1).concat(r); }
  return [a,b];
}
function polyLen(a){ let L=0; for(let i=1;i<a.length;i++) L+=Math.hypot(a[i].x-a[i-1].x,a[i].y-a[i-1].y); return L; }
function makeMotion(owner, anchors, delay, dur, color){
  const A=anchors.map(p=>({x:(p.x!==undefined?p.x:p[0]), y:(p.y!==undefined?p.y:p[1])}));
  return {id:id(), motion:true, owner, color, anchors:A, pts:catmull(A,16), delay, dur, _lut:null};
}
function motionRebuild(p){ if(!p.anchors) p.anchors=rdp(p.pts||[],1.5); p.pts=catmull(p.anchors,16); p._lut=null; }
function movePiecePaths(pid,dx,dy){ paths.forEach(p=>{ if((p.motion||p.owner)&&p.owner===pid){
  if(p.anchors) p.anchors.forEach(a=>{a.x+=dx;a.y+=dy;});
  if(p.pts) p.pts.forEach(q=>{q.x+=dx;q.y+=dy;}); p._lut=null; } }); }
function anchorHandleAt(wx,wy){ if(!(sel&&sel.kind==='path'))return null; const p=getPath(sel.id); if(!p||!p.motion)return null;
  if(!p.anchors) motionRebuild(p);
  const tol=Math.max(2.2, 10/cam.s);
  for(let i=0;i<p.anchors.length;i++){ const aa=p.anchors[i]; if(Math.hypot(wx-aa.x,wy-aa.y)<=tol) return {path:p,idx:i}; }
  return null; }
function drawPieceGhost(pc,pos){ const [sx,sy]=W2S(pos.x,pos.y); ctx.save(); ctx.translate(sx,sy); drawPieceShape(ctx,pc,cam.s,false); ctx.restore(); }

// =========================================================
//  PATH RENDERING
// =========================================================
function drawPath(p, animActive){
  if(p.motion||p.owner){ return drawMotionPath(p); }
  return drawAnnotation(p);
}
function drawMotionPath(p){
  if(!p.anchors) motionRebuild(p);
  if(!p.pts||p.pts.length<2) return;
  const pc=getPiece(p.owner);
  const col=p.color || (pc&&pc.color) || '#2E8FA8';
  const seld = selContains('path',p.id);
  const scr=p.pts.map(q=>W2S(q.x,q.y));
  ctx.save(); ctx.lineJoin='round'; ctx.lineCap='round';
  // solid line
  ctx.strokeStyle=col; ctx.globalAlpha=1; ctx.lineWidth=Math.max(2,0.55*cam.s); strokePoly(scr);
  arrowHead(scr,col); ctx.restore();
  // ghost piece at destination
  if(pc){ ctx.save(); ctx.globalAlpha=0.42; drawPieceGhost(pc,p.pts[p.pts.length-1]); ctx.restore(); }
}
function drawScallops(ctx, pts, col, camScale){
  if(pts.length<2) return;
  // arc-length LUT
  const lens=[0];
  for(let i=1;i<pts.length;i++) lens.push(lens[i-1]+Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]));
  const total=lens[lens.length-1];
  function getAt(s){ s=Math.max(0,Math.min(s,total)); let i=0; while(i<lens.length-2&&lens[i+1]<=s)i++;
    const f=lens[i+1]>lens[i]?(s-lens[i])/(lens[i+1]-lens[i]):0;
    return [pts[i][0]+f*(pts[i+1][0]-pts[i][0]), pts[i][1]+f*(pts[i+1][1]-pts[i][1])]; }
  function normAt(s){ const a=getAt(Math.max(0,s-1)), b=getAt(Math.min(total,s+1));
    const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy)||1; return [-dy/len,dx/len]; }

  const amp=Math.max(1.2,0.6*camScale); // very small — tight S/C shapes
  const wl=amp*1.3;                     // width of each C (along path)

  ctx.save(); ctx.strokeStyle=col; ctx.globalAlpha=0.65; ctx.lineWidth=Math.max(1,0.32*camScale);
  ctx.lineJoin='round'; ctx.lineCap='round';
  ctx.beginPath();
  const [sx,sy]=getAt(0); ctx.moveTo(sx,sy);
  let s=0, side=1;
  while(s<total){
    const sEnd=Math.min(s+wl,total);
    const sMid=(s+sEnd)/2;
    const [ex,ey]=getAt(sEnd);
    const [mx,my]=getAt(sMid);
    const [nx,ny]=normAt(sMid);
    // control point at 2.8*amp for a sharper C (more pronounced than sine)
    ctx.quadraticCurveTo(mx+nx*amp*2.8*side, my+ny*amp*2.8*side, ex, ey);
    s=sEnd; side=-side;
    if(s>=total) break;
  }
  ctx.stroke(); ctx.restore();
}
function drawBackSkate(ctx, pts, col, camScale){
  if(pts.length<2) return;
  const lens=[0];
  for(let i=1;i<pts.length;i++) lens.push(lens[i-1]+Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]));
  const total=lens[lens.length-1];
  function getAt(s){ s=Math.max(0,Math.min(s,total)); let i=0; while(i<lens.length-2&&lens[i+1]<=s)i++;
    const f=lens[i+1]>lens[i]?(s-lens[i])/(lens[i+1]-lens[i]):0;
    return [pts[i][0]+f*(pts[i+1][0]-pts[i][0]), pts[i][1]+f*(pts[i+1][1]-pts[i][1])]; }
  function normAt(s){ const a=getAt(Math.max(0,s-1)), b=getAt(Math.min(total,s+1));
    const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy)||1; return [-dy/len,dx/len]; }

  const amp=Math.max(2.5,1.1*camScale);
  const cLen=amp*3.5;  // length of ONE C arc
  const gap=Math.max(1.5,0.6*camScale);

  ctx.save(); ctx.strokeStyle=col; ctx.globalAlpha=0.75;
  ctx.lineWidth=Math.max(1,0.34*camScale);
  ctx.lineJoin='round'; ctx.lineCap='round';

  // Each mark = ONE quadratic bezier (one C). Alternating sides gives the offset-S look.
  let s=gap, side=1;
  while(s<total){
    const sEnd=Math.min(s+cLen,total);
    if(sEnd-s < cLen*0.3) break;
    const [ax,ay]=getAt(s);
    const [bx,by]=getAt(sEnd);
    const mid=s+cLen*0.5;
    const [mx,my]=getAt(mid);
    const [nx,ny]=normAt(mid);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo(mx+nx*amp*side, my+ny*amp*side, bx, by);
    ctx.stroke();
    s=sEnd+gap; side=-side;
  }
  ctx.restore();
}

function drawAnnotation(p){
  if(p.pts.length<2) return;
  const scr=p.pts.map(pt=>W2S(pt.x,pt.y));
  const col=p.color||'#0C2233';
  ctx.lineWidth=Math.max(2,0.55*cam.s); ctx.strokeStyle=col; ctx.fillStyle=col;
  ctx.lineJoin='round'; ctx.lineCap='round';
  if(p.type==='skate'){
    const anc=p.anchors&&p.anchors.length>=2?p.anchors:p.pts;
    const smooth=anc.length>=2?catmull(anc,16).map(q=>W2S(q.x,q.y)):scr;
    strokePoly(smooth); arrowHead(smooth,col);
  }
  else if(p.type==='skateback'){
    const anc=p.anchors&&p.anchors.length>=2?p.anchors:p.pts;
    const smooth=anc.length>=2?catmull(anc,48).map(q=>W2S(q.x,q.y)):scr;
    drawScallops(ctx, smooth, col, cam.s);
    // place arrowhead beyond the last scallop
    ctx.globalAlpha=1;
    const _n=smooth.length, _a=smooth[_n-2]||smooth[0], _b=smooth[_n-1];
    const _ang=Math.atan2(_b[1]-_a[1],_b[0]-_a[0]), _L=Math.max(8,2.4*cam.s);
    const _tip=[_b[0]+_L*Math.cos(_ang), _b[1]+_L*Math.sin(_ang)];
    arrowHead([_a, _tip], col);
  }
  else if(p.type==='skaterev'){
    const anc=p.anchors&&p.anchors.length>=2?p.anchors:p.pts;
    const smooth=anc.length>=2?catmull(anc,48).map(q=>W2S(q.x,q.y)):scr;
    drawBackSkate(ctx, smooth, col, cam.s);
    ctx.globalAlpha=1;
    const _n=smooth.length, _a=smooth[_n-2]||smooth[0], _b=smooth[_n-1];
    const _ang=Math.atan2(_b[1]-_a[1],_b[0]-_a[0]), _L=Math.max(8,2.4*cam.s);
    const _tip=[_b[0]+_L*Math.cos(_ang), _b[1]+_L*Math.sin(_ang)];
    arrowHead([_a, _tip], col);
  }
  else if(p.type==='pass'){ ctx.setLineDash([7,6]); strokePoly(scr); ctx.setLineDash([]); arrowHead(scr,col,true); }
  else if(p.type==='shot'){ shotDouble(scr,col); }
  else if(p.type==='arrow'){ strokePoly(scr); arrowHead(scr,col); }
  else if(p.type==='pen'){ strokePoly(scr); }
  if(selContains('path',p.id)){
    ctx.save(); ctx.strokeStyle='#5BC2D6'; ctx.lineWidth=Math.max(2,0.55*cam.s)+4; ctx.globalAlpha=.35;
    strokePoly(scr); ctx.restore();
  }
}
function strokePoly(scr){ ctx.beginPath(); ctx.moveTo(scr[0][0],scr[0][1]);
  for(let i=1;i<scr.length;i++) ctx.lineTo(scr[i][0],scr[i][1]); ctx.stroke(); }
function strokeWavy(scr){
  // resample then add perpendicular sine
  const pts=resample(scr, Math.max(6,4*cam.s));
  const amp=Math.max(3,1.1*cam.s), wl=Math.max(10,3.2*cam.s);
  let dist=0; const out=[];
  for(let i=0;i<pts.length;i++){
    let nx=0,ny=0;
    if(i>0){const dx=pts[i][0]-pts[i-1][0],dy=pts[i][1]-pts[i-1][1];const L=Math.hypot(dx,dy)||1; nx=-dy/L; ny=dx/L; dist+=L;}
    const off = (i===0||i>pts.length-3)?0:Math.sin(dist/wl*Math.PI*2)*amp;
    out.push([pts[i][0]+nx*off, pts[i][1]+ny*off]);
  }
  ctx.beginPath(); ctx.moveTo(out[0][0],out[0][1]);
  for(let i=1;i<out.length;i++) ctx.lineTo(out[i][0],out[i][1]); ctx.stroke();
}
function arrowHead(scr,col,open){
  const n=scr.length; let a=scr[n-2],b=scr[n-1];
  const ang=Math.atan2(b[1]-a[1],b[0]-a[0]); const L=Math.max(8,2.4*cam.s);
  ctx.fillStyle=col; ctx.strokeStyle=col;
  if(open){ ctx.lineWidth=Math.max(2,0.55*cam.s);
    ctx.beginPath(); ctx.moveTo(b[0]-L*Math.cos(ang-0.4),b[1]-L*Math.sin(ang-0.4)); ctx.lineTo(b[0],b[1]);
    ctx.lineTo(b[0]-L*Math.cos(ang+0.4),b[1]-L*Math.sin(ang+0.4)); ctx.stroke(); return; }
  ctx.beginPath(); ctx.moveTo(b[0],b[1]);
  ctx.lineTo(b[0]-L*Math.cos(ang-0.42),b[1]-L*Math.sin(ang-0.42));
  ctx.lineTo(b[0]-L*Math.cos(ang+0.42),b[1]-L*Math.sin(ang+0.42)); ctx.closePath(); ctx.fill();
}
function shotDouble(scr,col){
  const n=scr.length;
  const a=scr[n-2]||scr[0], b=scr[n-1];
  const ang=Math.atan2(b[1]-a[1],b[0]-a[0]);
  const L=Math.max(9,2.8*cam.s);          // triangle size
  const spread=Math.max(3,0.85*cam.s);    // half-gap between the two lines
  const lw=Math.max(1.5,0.4*cam.s);
  const lineGap=Math.max(4,1.4*cam.s);    // gap between line end and triangle base

  // lines stop short — leave room for gap + triangle
  const stopDist=L+lineGap;
  const stopX=b[0]-stopDist*Math.cos(ang), stopY=b[1]-stopDist*Math.sin(ang);
  const trimmed=[...scr.slice(0,-1),[stopX,stopY]];

  // perpendicular direction
  const nx=-Math.sin(ang), ny=Math.cos(ang);

  ctx.strokeStyle=col; ctx.lineWidth=lw; ctx.lineCap='round';
  for(const side of [-1,1]){
    ctx.beginPath();
    for(let i=0;i<trimmed.length;i++){
      const pt=trimmed[i];
      if(i===0) ctx.moveTo(pt[0]+nx*spread*side, pt[1]+ny*spread*side);
      else       ctx.lineTo(pt[0]+nx*spread*side, pt[1]+ny*spread*side);
    }
    ctx.stroke();
  }

  // disconnected filled triangle tip
  const tipX=b[0], tipY=b[1];
  const baseX=tipX-L*Math.cos(ang), baseY=tipY-L*Math.sin(ang);
  ctx.fillStyle=col;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(baseX+nx*L*0.42, baseY+ny*L*0.42);
  ctx.lineTo(baseX-nx*L*0.42, baseY-ny*L*0.42);
  ctx.closePath(); ctx.fill();
}
function shotHashes(scr,col){
  const a=scr[0],b=scr[1]||scr[0]; const ang=Math.atan2(b[1]-a[1],b[0]-a[0]);
  const nx=-Math.sin(ang),ny=Math.cos(ang); const h=Math.max(5,1.6*cam.s);
  ctx.strokeStyle=col; ctx.lineWidth=Math.max(2,0.5*cam.s);
  [0.18,0.34].forEach(f=>{ const px=a[0]+(b[0]-a[0])*f, py=a[1]+(b[1]-a[1])*f;
    ctx.beginPath(); ctx.moveTo(px-nx*h,py-ny*h); ctx.lineTo(px+nx*h,py+ny*h); ctx.stroke(); });
}
function resample(scr,step){
  const out=[scr[0]]; let prev=scr[0];
  for(let i=1;i<scr.length;i++){ let cur=scr[i]; let d=Math.hypot(cur[0]-prev[0],cur[1]-prev[1]);
    while(d>=step){ const t=step/d; const nx=prev[0]+(cur[0]-prev[0])*t, ny=prev[1]+(cur[1]-prev[1])*t;
      out.push([nx,ny]); prev=[nx,ny]; d=Math.hypot(cur[0]-prev[0],cur[1]-prev[1]); }
    prev=cur; }
  out.push(scr[scr.length-1]); return out;
}

// =========================================================
//  ANIMATION
// =========================================================
let playing=false, tNow=0, T=5000, lastTs=0, loop=false;
function buildLUT(p){ // arc-length table in world coords
  const lut=[{t:0,d:0}]; let d=0;
  for(let i=1;i<p.pts.length;i++){ d+=Math.hypot(p.pts[i].x-p.pts[i-1].x,p.pts[i].y-p.pts[i-1].y); lut.push({t:i,d}); }
  p._lut={total:d,arr:lut};
}
function sampleAt(p, u){ // u 0..1 along arc length -> {x,y}
  if(!p._lut) buildLUT(p);
  const {total,arr}=p._lut; if(total===0) return {x:p.pts[0].x,y:p.pts[0].y};
  const target=u*total; let i=1; while(i<arr.length && arr[i].d<target) i++;
  if(i>=arr.length) i=arr.length-1;
  const a=arr[i-1], b=arr[i]; const seg=(b.d-a.d)||1; const f=(target-a.d)/seg;
  const pa=p.pts[a.t], pb=p.pts[b.t];
  return {x:pa.x+(pb.x-pa.x)*f, y:pa.y+(pb.y-pa.y)*f};
}
const easeInOut=t=> t<0.5? 2*t*t : 1-Math.pow(-2*t+2,2)/2;

function motionPathOf(pieceId){ return paths.find(p=>(p.motion||p.owner)&&p.owner===pieceId); }
function posAt(piece, t){   // piece position at absolute time t(ms)
  const mp=motionPathOf(piece.id);
  if(mp){ const local=clamp((t-(mp.delay||0))/Math.max(1,mp.dur||T),0,1); return sampleAt(mp, easeInOut(local)); }
  return {x:piece.x,y:piece.y};
}
function legEndpoints(pk,i){ const legs=pk.legs, L=legs[i], N=legs[i+1]; const s=L.s, e=N?N.s:T; const prev=legs[i-1];
  if(L.type==='carry'){ const pc=getPiece(L.piece); const st=pc?posAt(pc,s):{x:pk.x,y:pk.y}; const en=pc?posAt(pc,e):st; return {s,e,start:st,end:en,carrier:pc}; }
  let st; if(prev&&prev.type==='carry'){ const pcp=getPiece(prev.piece); st=pcp?posAt(pcp,s):{x:pk.x,y:pk.y}; } else st=L.fromXY||{x:pk.x,y:pk.y};
  const tp=L.to?getPiece(L.to):null; const en= tp?posAt(tp,e):(L.toXY||st);
  return {s,e,start:st,end:en};
}
function puckPosAt(pk,t){ const legs=pk.legs; let i=0; for(let k=0;k<legs.length;k++){ if(legs[k].s<=t) i=k; }
  const L=legs[i]; if(L.type==='carry'){ const pc=getPiece(L.piece); return pc?posAt(pc,t):{x:pk.x,y:pk.y}; }
  const ep=legEndpoints(pk,i); const u=easeInOut(clamp((t-ep.s)/Math.max(1,ep.e-ep.s),0,1));
  return {x:ep.start.x+(ep.end.x-ep.start.x)*u, y:ep.start.y+(ep.end.y-ep.start.y)*u};
}
function pieceTag(id){ const q=getPiece(id); if(!q)return '?'; return q.num? q.num : prettyType(q.type); }
function passIndex(legs,i){ let n=0; for(let k=0;k<=i;k++) if(legs[k].type==='pass')n++; return n; }
function legWeight(pk,legs,i){
  const L=legs[i];
  if(L.type==='carry'){
    const pc=getPiece(L.piece);
    const mp=pc&&motionPathOf(pc.id);
    let dist=(mp&&mp.anchors)?polyLen(mp.anchors):10;
    const carries=legs.filter(x=>x.type==='carry'&&x.piece===L.piece).length||1;
    dist=dist/carries;
    return Math.max(dist/30, 0.5);
  }
  const prev=legs[i-1];
  const fromPc=prev&&prev.type==='carry'?getPiece(prev.piece):null;
  const fx=fromPc?fromPc.x:pk.x, fy=fromPc?fromPc.y:pk.y;
  const toPc=L.to?getPiece(L.to):null;
  const tx=toPc?toPc.x:(L.toXY?L.toXY.x:fx), ty=toPc?toPc.y:(L.toXY?L.toXY.y:fy);
  const dist=Math.hypot(tx-fx,ty-fy);
  return Math.max(dist/70, 0.35);
}
function reflowLegTimes(pk){ const legs=pk.legs; if(!legs||!legs.length)return;
  const w=legs.map((l,i)=>legWeight(pk,legs,i)); const tot=w.reduce((a,b)=>a+b,0)||1; let acc=0;
  legs.forEach((l,i)=>{ l.s=Math.round(acc/tot*T); acc+=w[i]; }); if(legs[0]) legs[0].s=0; }
function placePuckAtStart(pk){ if(pk.legs&&pk.legs.length){ const q=puckPosAt(pk,0); pk.x=q.x; pk.y=q.y; } }
function resolvePick(wx,wy){ const pk=getPiece(pendingPick.puckId); const kind=pendingPick.kind; pendingPick=null; cv.style.cursor='';
  if(!pk){ updateHint(); render(); return; }
  const target=pieceAt(wx,wy); pushUndo();
  if(kind==='carrier'){ const c=(target&&target.id!==pk.id)?target:null; pk.legs= c?[{type:'carry',piece:c.id,s:0}]:[]; placePuckAtStart(pk); }
  else { if(!pk.legs||!pk.legs.length){ toast('Set a carrier first'); }
    else { const recv=(target&&target.id!==pk.id)?target:null;
      if(recv){ pk.legs.push({type:'pass',to:recv.id}); pk.legs.push({type:'carry',piece:recv.id}); }
      else { pk.legs.push({type:'pass',to:null,toXY:{x:wx,y:wy}}); }
      reflowLegTimes(pk); } }
  updateInspector(); updateHint(); render();
}
function drawPuckJourney(pk){ const legs=pk.legs; if(!legs||!legs.length) return;
  const seld = selContains('piece',pk.id);
  for(let i=0;i<legs.length;i++){ const L=legs[i], ep=legEndpoints(pk,i);
    if(L.type==='carry'){ const pc=ep.carrier; if(!pc) continue;
      const steps=20, scr=[]; for(let k=0;k<=steps;k++){ const tt=ep.s+(ep.e-ep.s)*k/steps; const q=posAt(pc,tt); scr.push(W2S(q.x,q.y)); }
      ctx.save(); ctx.strokeStyle='#111'; ctx.globalAlpha=seld?0.55:0.30; ctx.lineWidth=Math.max(1.5,0.4*cam.s); strokePoly(scr); ctx.restore();
    } else { const a=W2S(ep.start.x,ep.start.y), b=W2S(ep.end.x,ep.end.y);
      ctx.save(); ctx.strokeStyle='#111'; ctx.globalAlpha=seld?0.7:0.42; ctx.lineWidth=Math.max(1.5,0.45*cam.s);
      ctx.setLineDash([Math.max(6,2*cam.s),Math.max(5,1.6*cam.s)]);
      ctx.beginPath(); ctx.moveTo(a[0],a[1]); ctx.lineTo(b[0],b[1]); ctx.stroke(); ctx.setLineDash([]);
      arrowHead([a,b],'#111',true); ctx.restore(); } }
}
function animatedPositions(){
  const map={};
  paths.forEach(p=>{ if(!(p.motion||p.owner)) return; const pc=getPiece(p.owner); if(!pc) return; map[p.owner]=posAt(pc,tNow); });
  pieces.forEach(pk=>{ if(pk.type==='puck'||pk.type==='ball' && pk.legs && pk.legs.length){ map[pk.id]=puckPosAt(pk,tNow); } });
  return map;
}
const clamp=(v,a,b)=>v<a?a:v>b?b:v;

function tick(ts){
  if(playing){
    if(!lastTs)lastTs=ts; const dt=ts-lastTs; lastTs=ts;
    tNow+=dt;
    if(tNow>=T){ if(loop){tNow=0;} else {tNow=T; playing=false; setPlayUI();} }
    syncScrub();
  }
  render();
  requestAnimationFrame(tick);
}
function setPlayUI(){ document.getElementById('playBtn').textContent= playing?'⏸':'▶'; }
function togglePlay(){ if(building) finishBuilding(); if(tNow>=T) tNow=0; playing=!playing; lastTs=0; setPlayUI(); }
function syncScrub(){ document.getElementById('scrubber').value=Math.round(tNow/T*1000);
  document.getElementById('timeLbl').textContent=(tNow/1000).toFixed(1)+'s / '+(T/1000).toFixed(1)+'s'; }
function stagger(){
  const moving=paths.filter(p=>p.owner);
  if(!moving.length){ toast('Draw a path from a piece first'); return; }
  pushUndo();
  const n=moving.length; const step=(T*0.45)/n;
  moving.forEach((p,i)=>{ p.delay=Math.round(i*step); p.dur=Math.round(T-p.delay); });
  toast('Pieces staggered'); render();
}

// =========================================================
//  MAIN RENDER
// =========================================================
function render(){
  clear();
  panels().forEach(p=>p.kind==='field'?drawFieldBg(p):p.kind==='iceplex'?drawIceplexBg(p):drawRinkBg(p));
  // zones under everything
  pieces.filter(p=>p.type==='zone').forEach(p=>drawPiece(p,null));
  // paths under pieces
  paths.forEach(p=>drawPath(p));
  // pieces (animated positions if mid-play or scrubbed)
  const showAnim = playing || tNow>0;
  const map = showAnim? animatedPositions() : {};
  pieces.forEach(p=>{ if(p.type==='puck'||p.type==='ball'&&p.legs&&p.legs.length) drawPuckJourney(p); });
  pieces.filter(p=>p.type!=='zone').forEach(p=>drawPiece(p, map[p.id]));
  // rotation handle for selected net
  const rotPc = selSet.length===1 && selSet[0].kind==='piece' ? getPiece(selSet[0].id) : null;
  if(rotPc && (rotPc.type==='net'||rotPc.type==='bumper')){
    const [sx,sy]=W2S(rotPc.x,rotPc.y);
    const armLen=38, rad=(rotPc.rot||0)*Math.PI/180, hx=sx+Math.sin(rad)*armLen, hy=sy-Math.cos(rad)*armLen;
    ctx.save();
    ctx.strokeStyle='#5BC2D6'; ctx.lineWidth=1.5; ctx.setLineDash([4,3]);
    ctx.beginPath(); ctx.moveTo(sx,sy); ctx.lineTo(hx,hy); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle='#5BC2D6'; ctx.strokeStyle='#fff'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.arc(hx,hy,7,0,7); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  // size handle for selected zone
  if(rotPc && rotPc.type==='zone'){
    const [sx,sy]=W2S(rotPc.x,rotPc.y);
    const zr=10*cam.s*(rotPc.size||1);  // zone radius in screen px
    const hx=sx, hy=sy-zr;              // handle sits at top of circle
    ctx.save();
    ctx.strokeStyle='#5BC2D6'; ctx.lineWidth=1.5; ctx.setLineDash([4,3]);
    ctx.beginPath(); ctx.moveTo(sx,sy); ctx.lineTo(hx,hy); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle='#5BC2D6'; ctx.strokeStyle='#fff'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.arc(hx,hy,7,0,7); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  if(marquee){ const a=W2S(marquee.x0,marquee.y0), b=W2S(marquee.x1,marquee.y1);
    ctx.save(); ctx.strokeStyle='#5BC2D6'; ctx.fillStyle='rgba(91,194,214,.12)'; ctx.lineWidth=1.5; ctx.setLineDash([6,4]);
    const rx=Math.min(a[0],b[0]),ry=Math.min(a[1],b[1]),rw=Math.abs(b[0]-a[0]),rh=Math.abs(b[1]-a[1]);
    ctx.fillRect(rx,ry,rw,rh); ctx.strokeRect(rx,ry,rw,rh); ctx.restore(); }
  // live preview of skate being built
  if(skateBuilding && skateCursor){
    const anc=[...skateBuilding.path.anchors, skateCursor];
    const smooth=anc.length>=2?catmull(anc,16):anc;
    const scr2=smooth.map(q=>W2S(q.x,q.y));
    ctx.save(); ctx.strokeStyle=activeColor||'#0C2233'; ctx.globalAlpha=0.5;
    ctx.lineWidth=Math.max(2,0.55*cam.s); ctx.lineJoin='round'; ctx.lineCap='round';
    strokePoly(scr2); ctx.restore();
  }
  // live preview of skateback (puck carry) being built
  if(skateBackBuilding && skateBackCursor){
    const anc=[...skateBackBuilding.path.anchors, skateBackCursor];
    const smooth=anc.length>=2?catmull(anc,48).map(q=>W2S(q.x,q.y)):anc.map(q=>W2S(q.x,q.y));
    ctx.save(); ctx.globalAlpha=0.5;
    drawScallops(ctx, smooth, activeColor||'#0C2233', cam.s);
    ctx.restore();
  }
  // live preview of skaterev (backwards skating) being built
  if(skateRevBuilding && skateRevCursor){
    const anc=[...skateRevBuilding.path.anchors, skateRevCursor];
    const smooth=anc.length>=2?catmull(anc,48).map(q=>W2S(q.x,q.y)):anc.map(q=>W2S(q.x,q.y));
    ctx.save(); ctx.globalAlpha=0.5;
    drawBackSkate(ctx, smooth, activeColor||'#0C2233', cam.s);
    ctx.restore();
  }
  // live preview of pass being built
  if(passBuilding && passCursor){
    const pts=passBuilding.path.pts; const last=pts[pts.length-1];
    const a=W2S(last.x,last.y), b=W2S(passCursor.x,passCursor.y);
    ctx.save(); ctx.strokeStyle='#0C2233'; ctx.globalAlpha=0.45;
    ctx.lineWidth=Math.max(2,0.55*cam.s); ctx.setLineDash([7,6]);
    ctx.beginPath(); ctx.moveTo(a[0],a[1]); ctx.lineTo(b[0],b[1]); ctx.stroke();
    ctx.setLineDash([]); ctx.restore();
  }
  // live preview of shot being built
  if(shotBuilding && shotCursor){
    const pts=shotBuilding.path.pts; const last=pts[pts.length-1];
    const a=W2S(last.x,last.y), b=W2S(shotCursor.x,shotCursor.y);
    ctx.save(); ctx.strokeStyle='#0C2233'; ctx.globalAlpha=0.45;
    ctx.lineWidth=Math.max(2,0.55*cam.s);
    ctx.beginPath(); ctx.moveTo(a[0],a[1]); ctx.lineTo(b[0],b[1]); ctx.stroke();
    ctx.restore();
  }
  updateHint();
}

// =========================================================
//  HIT TESTING + POINTER
// =========================================================
function pieceAt(wx,wy){
  for(let i=pieces.length-1;i>=0;i--){ const p=pieces[i];
    if(p.type==='image'){ const w=8*(p.size||1), hh=w*((p.img&&p.img.height&&p.img.height/p.img.width)||0.62);
      if(Math.abs(wx-p.x)<=w/2 && Math.abs(wy-p.y)<=hh/2) return p; continue; }
    if(p.type==='text'){ const w=(p._wft||10), hh=(p._hft||4);
      if(Math.abs(wx-p.x)<=w/2+1 && Math.abs(wy-p.y)<=hh/2+2) return p; continue; }
    const r=pieceRadius(p)+0.6; if(Math.hypot(wx-p.x,wy-p.y)<=r) return p; }
  return null;
}
function nearestPiece(wx,wy,extra){ let best=null,bd=1e9;
  for(const p of pieces){ if(p.type==='image'||p.type==='text')continue; const d=Math.hypot(wx-p.x,wy-p.y); const r=pieceRadius(p)+(extra||0);
    if(d<=r && d<bd){bd=d;best=p;} } return best; }
function motionEndpointAt(wx,wy){ const tol=Math.max(2.5,10/cam.s);
  for(let i=paths.length-1;i>=0;i--){ const p=paths[i]; if(!(p.motion||p.owner)||!p.anchors)continue;
    const a=p.anchors[p.anchors.length-1]; if(Math.hypot(wx-a.x,wy-a.y)<=tol) return p; }
  return null; }
function setDurByLength(p){ if(p.anchors) p.dur=clamp(polyLen(p.anchors)/30*1000, 800, T); }
function finishBuilding(){ if(!building) return; const p=building.path;
  if(!p.anchors || p.anchors.length<2 || polyLen(p.anchors)<3){ paths=paths.filter(x=>x!==p); selOne(null); }
  else { const pc=getPiece(p.owner); if(pc){pc.x=p.anchors[0].x; pc.y=p.anchors[0].y;} setDurByLength(p);
    const pc2=getPiece(p.owner); toast((pc2?prettyType(pc2.type):'Piece')+' route set — press Play'); }
  building=null; seg=null; updateInspector(); render();
}
function pathAt(wx,wy){
  const tol=2.2/ (cam.s/4); // feet tolerance scaled
  for(let i=paths.length-1;i>=0;i--){ const p=paths[i];
    for(let j=1;j<p.pts.length;j++){
      if(distToSeg(wx,wy,p.pts[j-1],p.pts[j])<tol) return p; }
  } return null;
}
function distToSeg(px,py,a,b){ const dx=b.x-a.x,dy=b.y-a.y; const L=dx*dx+dy*dy||1;
  let t=((px-a.x)*dx+(py-a.y)*dy)/L; t=clamp(t,0,1);
  return Math.hypot(px-(a.x+dx*t),py-(a.y+dy*t)); }

let drag=null;       // {piece, ox,oy} or pan
let rotDrag=null;    // {piece} — dragging the on-canvas rotation handle
let zoneSizeDrag=null; // {piece} — dragging the zone size handle
let drawing=null;    // current annotation being drawn
let panStart=null;
let building=null;   // motion route being built (multi-segment)
let seg=null;        // current segment gesture within a build

cv.addEventListener('pointerdown',e=>{
  cv.setPointerCapture(e.pointerId);
  const [wx,wy]=S2W(e.offsetX,e.offsetY);
  if(playing){ playing=false; setPlayUI(); }
  // mid/right button = pan regardless of tool
  if(e.button===1||e.button===2||tool==='pan'){ pendingType=null; pendingOpts=null; pendingStamp=false; cv.style.cursor=''; panStart={x:e.offsetX,y:e.offsetY,tx:cam.tx,ty:cam.ty}; return; }

  // rotation handle hit-test
  const rotPcDown = selSet.length===1 && selSet[0].kind==='piece' ? getPiece(selSet[0].id) : null;
  if(rotPcDown && (rotPcDown.type==='net'||rotPcDown.type==='bumper')){
    const [sx,sy]=W2S(rotPcDown.x,rotPcDown.y);
    const armLen=38, rad2=(rotPcDown.rot||0)*Math.PI/180, hx=sx+Math.sin(rad2)*armLen, hy=sy-Math.cos(rad2)*armLen;
    if(Math.hypot(e.offsetX-hx,e.offsetY-hy)<12){ pushUndo(); rotDrag={piece:rotPcDown}; return; }
  }
  if(rotPcDown && rotPcDown.type==='zone'){
    const [sx,sy]=W2S(rotPcDown.x,rotPcDown.y);
    const zr=10*cam.s*(rotPcDown.size||1), hx=sx, hy=sy-zr;
    if(Math.hypot(e.offsetX-hx,e.offsetY-hy)<12){ pushUndo(); zoneSizeDrag={piece:rotPcDown}; return; }
  }
  if(pendingPick){ resolvePick(wx,wy); return; }
  if(pendingType){ addPiece(pendingType,{x:wx,y:wy},pendingOpts);
    if(!pendingStamp){ pendingType=null; pendingOpts=null; cv.style.cursor=''; } updateHint(); return; }

  if(tool==='select'){
    const addKey = e.shiftKey||e.metaKey||e.ctrlKey;
    const ah=anchorHandleAt(wx,wy);
    if(ah && !addKey){ pushUndo(); drag={anchor:ah}; return; }
    const pc=pieceAt(wx,wy);
    if(pc){
      if(addKey){ selToggle('piece',pc.id); updateInspector(); render(); return; }
      if(!selContains('piece',pc.id)) selOne('piece',pc.id);
      pushUndo();
      if(selSet.length>1){ drag={group:true,lastx:wx,lasty:wy}; }
      else { drag={piece:pc,ox:wx-pc.x,oy:wy-pc.y}; }
      updateInspector(); render(); return;
    }
    const pa=pathAt(wx,wy);
    if(pa){ if(addKey) selToggle('path',pa.id); else selOne('path',pa.id); updateInspector(); render(); return; }
    if(!addKey) selOne(null);
    marquee={x0:wx,y0:wy,x1:wx,y1:wy,add:addKey}; updateInspector(); render(); return;
  }
  if(tool==='motion'){
    if(!building){
      pushUndo();
      const ep=motionEndpointAt(wx,wy);
      if(ep){ building={path:ep}; selOne('path',ep.id); }
      else { const pc=pieceAt(wx,wy)||nearestPiece(wx,wy,4);
        if(!pc){ toast('Start the move on a piece'); return; }
        const existing=motionPathOf(pc.id);
        if(existing){ building={path:existing}; selOne('path',existing.id); toast('Extending '+prettyType(pc.type)+(pc.num?' '+pc.num:'')+"'s route"); }
        else { const np={id:id(),motion:true,owner:pc.id,color:(pc.color||activeColor||'#2E8FA8'),
          anchors:[{x:pc.x,y:pc.y}],pts:[{x:pc.x,y:pc.y}],delay:0,dur:T,_lut:null};
          paths.push(np); building={path:np}; selOne('path',np.id); } }
    }
    const la=building.path.anchors[building.path.anchors.length-1];
    seg={raw:[{x:la.x,y:la.y}]};
    updateInspector(); render(); return;
  }
  if(tool==='skate' && !building){
    if(!skateBuilding){
      pushUndo();
      const np={id:id(),type:'skate',color:(activeColor||'#0C2233'),pts:[{x:wx,y:wy}],anchors:[{x:wx,y:wy}],owner:null,delay:0,dur:T,_lut:null};
      paths.push(np); skateBuilding={path:np}; selOne('path',np.id);
      toast('Click waypoints for a smooth curve — right-click or Enter to finish');
    } else {
      skateBuilding.path.anchors.push({x:wx,y:wy});
      skateBuilding.path.pts=catmull(skateBuilding.path.anchors,16);
    }
    skateCursor={x:wx,y:wy}; updateInspector(); render(); return;
  }
  if(tool==='skateback' && !building){
    if(!skateBackBuilding){
      pushUndo();
      const np={id:id(),type:'skateback',color:(activeColor||'#0C2233'),pts:[{x:wx,y:wy}],anchors:[{x:wx,y:wy}],owner:null,delay:0,dur:T,_lut:null};
      paths.push(np); skateBackBuilding={path:np}; selOne('path',np.id);
      toast('Click waypoints for backwards skating — right-click to finish');
    } else {
      skateBackBuilding.path.anchors.push({x:wx,y:wy});
      skateBackBuilding.path.pts=catmull(skateBackBuilding.path.anchors,16);
    }
    skateBackCursor={x:wx,y:wy}; updateInspector(); render(); return;
  }
  if(tool==='skaterev' && !building){
    if(!skateRevBuilding){
      pushUndo();
      const np={id:id(),type:'skaterev',color:(activeColor||'#0C2233'),pts:[{x:wx,y:wy}],anchors:[{x:wx,y:wy}],owner:null,delay:0,dur:T,_lut:null};
      paths.push(np); skateRevBuilding={path:np}; selOne('path',np.id);
      toast('Click waypoints for backwards skating — right-click to finish');
    } else {
      skateRevBuilding.path.anchors.push({x:wx,y:wy});
      skateRevBuilding.path.pts=catmull(skateRevBuilding.path.anchors,16);
    }
    skateRevCursor={x:wx,y:wy}; updateInspector(); render(); return;
  }
  if(tool==='pass'){
    if(!passBuilding){
      pushUndo();
      const np={id:id(),type:'pass',color:(activeColor||'#0C2233'),pts:[{x:wx,y:wy}],owner:null,delay:0,dur:T,_lut:null};
      paths.push(np); passBuilding={path:np}; selOne('path',np.id);
      toast('Click to add bend points — double-click or Enter to finish');
    } else {
      passBuilding.path.pts.push({x:wx,y:wy});
    }
    passCursor={x:wx,y:wy}; updateInspector(); render(); return;
  }
  if(tool==='shot'){
    if(!shotBuilding){
      pushUndo();
      const np={id:id(),type:'shot',color:(activeColor||'#0C2233'),pts:[{x:wx,y:wy}],owner:null,delay:0,dur:T,_lut:null};
      paths.push(np); shotBuilding={path:np}; selOne('path',np.id);
      toast('Click to add deflection points — right-click or Enter to finish');
    } else {
      shotBuilding.path.pts.push({x:wx,y:wy});
    }
    shotCursor={x:wx,y:wy}; updateInspector(); render(); return;
  }
  if(tool==='erase'){
    const pc=pieceAt(wx,wy); if(pc){ pushUndo(); pieces=pieces.filter(p=>p!==pc); paths=paths.filter(p=>p.owner!==pc.id); selOne(null); updateInspector(); render(); return; }
    const pa=pathAt(wx,wy); if(pa){ pushUndo(); paths=paths.filter(p=>p!==pa); selOne(null); updateInspector(); render(); }
    return;
  }
  if(tool==='text'){
    const s=window.prompt('Label text:'); if(s && s.trim()){ pushUndo();
      const p={id:id(),type:'text',x:wx,y:wy,text:s.trim(),color:'#11181f',size:1,rot:0};
      pieces.push(p); selOne('piece',p.id); updateInspector(); render(); }
    return;
  }
  // a drawing tool
  pushUndo();
  drawing={ id:id(), type:tool, color:(activeColor||'#0C2233'), pts:[{x:wx,y:wy}], owner:null, delay:0, dur:T, _lut:null };
});
cv.addEventListener('pointermove',e=>{
  const [wx,wy]=S2W(e.offsetX,e.offsetY);
  if(zoneSizeDrag){ const p=zoneSizeDrag.piece; const [sx,sy]=W2S(p.x,p.y);
    const dist=Math.hypot(e.offsetX-sx,e.offsetY-sy);
    p.size=Math.max(0.2, dist/(10*cam.s)); updateInspector(); render(); return; }
  if(rotDrag){ const p=rotDrag.piece; const [sx,sy]=W2S(p.x,p.y);
    p.rot=Math.atan2(e.offsetX-sx,sy-e.offsetY)*180/Math.PI; render(); return; }
  if(skateBuilding){ skateCursor={x:wx,y:wy}; render(); return; }
  if(skateBackBuilding){ skateBackCursor={x:wx,y:wy}; render(); return; }
  if(skateRevBuilding){ skateRevCursor={x:wx,y:wy}; render(); return; }
  if(passBuilding){ passCursor={x:wx,y:wy}; render(); return; }
  if(shotBuilding){ shotCursor={x:wx,y:wy}; render(); return; }
  if(panStart){ cam.tx=panStart.tx+(e.offsetX-panStart.x); cam.ty=panStart.ty+(e.offsetY-panStart.y); render(); return; }
  if(marquee){ marquee.x1=wx; marquee.y1=wy; render(); return; }
  if(drag && drag.group){ const dx=wx-drag.lastx, dy=wy-drag.lasty; drag.lastx=wx; drag.lasty=wy;
    selPieces().forEach(q=>{ q.x+=dx; q.y+=dy; movePiecePaths(q.id,dx,dy); }); render(); return; }
  if(drag && drag.anchor){ const h=drag.anchor; h.path.anchors[h.idx]={x:wx,y:wy};
    if(h.idx===0 && h.path.owner){ const pc=getPiece(h.path.owner); if(pc){pc.x=wx;pc.y=wy;} }
    h.path.pts=catmull(h.path.anchors,16); h.path._lut=null; render(); return; }
  if(drag){ const nx=wx-drag.ox, ny=wy-drag.oy; const dx=nx-drag.piece.x, dy=ny-drag.piece.y;
    drag.piece.x=nx; drag.piece.y=ny; movePiecePaths(drag.piece.id,dx,dy); render(); return; }
  if(seg && building){ const last=seg.raw[seg.raw.length-1];
    if(Math.hypot(wx-last.x,wy-last.y) > 0.8) seg.raw.push({x:wx,y:wy});
    const pv=building.path.anchors.concat(rdp(seg.raw,1.3).slice(1));
    building.path.pts=catmull(pv,14); building.path._lut=null; render(); return; }
  if(drawing){ const last=drawing.pts[drawing.pts.length-1];
    if(Math.hypot(wx-last.x,wy-last.y) > (drawing.type==='pen'?0.6:1.4)) drawing.pts.push({x:wx,y:wy});
    render(); ctxPreview(drawing); }
});
function ctxPreview(p){ drawPath(p); }
cv.addEventListener('pointerup',e=>{
  if(panStart){ panStart=null; return; }
  if(zoneSizeDrag){ zoneSizeDrag=null; render(); return; }
  if(rotDrag){ rotDrag=null; render(); return; }
  if(marquee){ finalizeMarquee(); marquee=null; render(); return; }
  if(drag){ drag=null; return; }
  if(seg && building){ const p=building.path;
    const moved = seg.raw.length>1 && polyLen(seg.raw)>2;
    if(moved){ p.anchors=p.anchors.concat(rdp(seg.raw,1.3).slice(1)); }
    else { const la=p.anchors[p.anchors.length-1]; if(Math.hypot(wx-la.x,wy-la.y)>2) p.anchors.push({x:wx,y:wy}); }
    p.pts=catmull(p.anchors,16); p._lut=null;
    const pc=getPiece(p.owner); if(pc){pc.x=p.anchors[0].x;pc.y=p.anchors[0].y;}
    seg=null; updateInspector(); render(); return; }
  if(drawing){
    if(drawing.pts.length>=2){
      if(drawing.type!=='pen' && drawing.type!=='skate'){
        const s=drawing.pts[0], en=drawing.pts[drawing.pts.length-1];
        let maxd=0; drawing.pts.forEach(pt=>{maxd=Math.max(maxd,distToSeg(pt.x,pt.y,s,en));});
        if(maxd<3) drawing.pts=[s,en];
      }
      drawing.owner=null;            // annotation lines never animate
      paths.push(drawing); selOne('path',drawing.id); updateInspector();
    }
    drawing=null; render();
  }
});
cv.addEventListener('dblclick',e=>{
  if(building){ finishBuilding(); return; }
  if(skateBuilding){
    const anc=skateBuilding.path.anchors;
    if(anc.length>1) anc.pop();
    skateBuilding.path.pts=catmull(anc,16);
    skateBuilding=null; skateCursor=null; selOne(null); updateInspector(); render(); return;
  }
  if(passBuilding){
    const pts=passBuilding.path.pts;
    if(pts.length>1) pts.pop();
    passBuilding=null; passCursor=null; selOne(null); updateInspector(); render(); return;
  }
  if(shotBuilding){
    const pts=shotBuilding.path.pts;
    if(pts.length>1) pts.pop();
    shotBuilding=null; shotCursor=null; selOne(null); updateInspector(); render(); return;
  }
  const [wx,wy]=S2W(e.offsetX,e.offsetY); const pc=pieceAt(wx,wy);
  if(pc && pc.type==='text'){ const s=window.prompt('Edit text:', pc.text||''); if(s!==null){ pushUndo(); pc.text=s.trim(); render(); } }
});
cv.addEventListener('contextmenu',e=>{
  e.preventDefault();
  if(pendingType){ pendingType=null; pendingOpts=null; pendingStamp=false; cv.style.cursor=''; updateHint(); render(); return; }
  if(skateBackBuilding){ skateBackBuilding=null; skateBackCursor=null; selOne(null); updateInspector(); render(); return; }
  if(skateRevBuilding){ skateRevBuilding=null; skateRevCursor=null; selOne(null); updateInspector(); render(); return; }
  if(skateBuilding){ skateBuilding=null; skateCursor=null; selOne(null); updateInspector(); render(); return; }
  if(passBuilding){ passBuilding=null; passCursor=null; selOne(null); updateInspector(); render(); return; }
  if(shotBuilding){ shotBuilding=null; shotCursor=null; selOne(null); updateInspector(); render(); return; }
  if(building){ finishBuilding(); return; }
});
cv.addEventListener('wheel',e=>{ e.preventDefault();
  const f=e.deltaY<0?1.12:1/1.12; const mx=e.offsetX,my=e.offsetY;
  const [wx,wy]=S2W(mx,my); cam.s*=f; cam.tx=mx-wx*cam.s; cam.ty=my-wy*cam.s; render();
},{passive:false});

// ---- touch: pinch-to-zoom + long-press to finish drawing ----
let _touches={}, _pinchDist=null, _longPressTimer=null;

function _touchDist(a,b){ return Math.hypot(b.clientX-a.clientX, b.clientY-a.clientY); }
function _touchMid(a,b){ return {x:(a.clientX+b.clientX)/2, y:(a.clientY+b.clientY)/2}; }
function _cancelLong(){ if(_longPressTimer){clearTimeout(_longPressTimer);_longPressTimer=null;} }

cv.addEventListener('touchstart',e=>{
  e.preventDefault();
  _cancelLong();
  const ts=[...e.touches];
  ts.forEach(t=>{ _touches[t.identifier]=t; });
  if(ts.length===2){
    _pinchDist=_touchDist(ts[0],ts[1]);
  } else if(ts.length===1){
    // long press (600ms) = right-click / finish drawing
    _longPressTimer=setTimeout(()=>{
      _longPressTimer=null;
      cv.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:ts[0].clientX,clientY:ts[0].clientY}));
    },600);
  }
},{passive:false});

cv.addEventListener('touchmove',e=>{
  e.preventDefault();
  _cancelLong();
  const ts=[...e.touches];
  if(ts.length===2 && _pinchDist!==null){
    const newDist=_touchDist(ts[0],ts[1]);
    const f=newDist/_pinchDist; _pinchDist=newDist;
    const mid=_touchMid(ts[0],ts[1]);
    const rect=cv.getBoundingClientRect();
    const mx=mid.x-rect.left, my=mid.y-rect.top;
    const [wx,wy]=S2W(mx,my); cam.s*=f; cam.tx=mx-wx*cam.s; cam.ty=my-wy*cam.s; render();
  }
},{passive:false});

cv.addEventListener('touchend',e=>{
  e.preventDefault();
  _cancelLong();
  [...e.changedTouches].forEach(t=>delete _touches[t.identifier]);
  if([...e.touches].length<2) _pinchDist=null;
},{passive:false});

// =========================================================
//  INSPECTOR
// =========================================================
const inspect=document.getElementById('inspect');
const inspBody=document.getElementById('inspBody');
const inspTitle=document.getElementById('inspTitle');
document.getElementById('inspClose').onclick=()=>{ selOne(null); updateInspector(); render(); };
function updateInspector(){
  if(selSet.length>1){
    inspect.classList.add('show'); inspTitle.textContent=selSet.length+' selected';
    const np=selPieces().length, nl=selPaths().length;
    let h='<div class="mini">'+np+' piece'+(np===1?'':'s')+(nl?', '+nl+' line'+(nl===1?'':'s'):'')+' selected. Drag any to move them together.</div>';
    h+=field('Colour all', colorBtns(null));
    h+='<button class="tbtn" id="m_dup" style="width:100%;margin-top:4px">Duplicate ('+selSet.length+')</button>';
    h+='<div class="row2" style="margin-top:6px"><button class="tbtn" id="m_front">To front</button><button class="tbtn" id="m_back">To back</button></div>';
    h+='<button class="del" id="m_del" style="margin-top:6px">Delete ('+selSet.length+')</button>';
    inspBody.innerHTML=h;
    inspBody.querySelectorAll('[data-col]').forEach(b=>b.onclick=()=>{ pushUndo(); selPieces().forEach(p=>p.color=b.dataset.col); selPaths().forEach(pa=>pa.color=b.dataset.col); render(); });
    byId('m_dup')&&(byId('m_dup').onclick=()=>duplicateSelection());
    byId('m_del')&&(byId('m_del').onclick=()=>deleteSelection());
    byId('m_front')&&(byId('m_front').onclick=()=>{ pushUndo(); selPieces().forEach(p=>{ pieces=pieces.filter(x=>x!==p); pieces.push(p); }); render(); });
    byId('m_back')&&(byId('m_back').onclick=()=>{ pushUndo(); selPieces().slice().reverse().forEach(p=>{ pieces=pieces.filter(x=>x!==p); pieces.unshift(p); }); render(); });
    return;
  }
  if(!sel){ inspect.classList.remove('show'); return; }
  inspect.classList.add('show');
  if(sel.kind==='piece'){ const p=getPiece(sel.id); if(!p){selOne(null);return updateInspector();}
    inspTitle.textContent=prettyType(p.type);
    let h='';
    if(p.type==='puck'||p.type==='ball'){ h+=possessionHTML(p); }
    const teamColored=(p.type==='player'||p.type==='goalie');
    if(teamColored){
      h+=swatchHTML(p.color);
      h+=field('Label','<input type="text" id="f_num" maxlength="3" value="'+escapeHtml(p.num||'')+'">');
    } else if(p.type==='text'){
      h+=field('Text','<input type="text" id="f_text" value="'+escapeHtml(p.text||'')+'">');
      h+=field('Colour', colorBtns(p.color||'#11181f'));
    } else if(p.type!=='image'){
      h+=field('Colour', colorBtns(p.color||defColor(p.type)));
    }
    const szMax=p.type==='image'?30:p.type==='text'?6:p.type==='zone'?5:2.4, szMin=p.type==='image'?1:p.type==='text'?0.4:p.type==='zone'?0.2:0.5;
    h+=field('Size','<input type="range" id="f_size" min="'+szMin+'" max="'+szMax+'" step="0.05" value="'+(p.size||1)+'">');
    if(p.type==='image'){
      h+=field('Opacity','<input type="range" id="f_op" min="0.15" max="1" step="0.05" value="'+(p.opacity!=null?p.opacity:1)+'">');
      h+='<button class="tbtn" id="f_back" style="width:100%;margin-top:2px">Send behind pieces</button>';
    }
    h+=field('Rotate','<input type="range" id="f_rot" min="0" max="360" value="'+(p.rot||0)+'">');
    h+='<button class="tbtn" id="f_dup" style="width:100%;margin-top:2px">Duplicate &nbsp;(⌘/Ctrl D)</button>';
    h+='<button class="del" id="f_del">Delete piece</button>';
    inspBody.innerHTML=h;
    inspBody.querySelectorAll('.sw').forEach(sw=>sw.onclick=()=>{ pushUndo(); p.color=COLORS[sw.dataset.k];
      inspBody.querySelectorAll('.sw').forEach(x=>x.classList.toggle('on',x===sw)); render(); });
    inspBody.querySelectorAll('[data-col]').forEach(b=>b.onclick=()=>{ pushUndo(); p.color=b.dataset.col;
      inspBody.querySelectorAll('[data-col]').forEach(x=>x.style.outline=''); b.style.outline='2px solid #5BC2D6'; render(); });
    bind('f_num','input',v=>{p.num=v;render();});
    bind('f_text','input',v=>{p.text=v;render();});
    bind('f_size','input',v=>{p.size=parseFloat(v);render();});
    bind('f_rot','input',v=>{p.rot=parseFloat(v);render();});
    bind('f_op','input',v=>{p.opacity=parseFloat(v);render();});
    byId('f_back')&&(byId('f_back').onclick=()=>{ pushUndo(); pieces=pieces.filter(x=>x!==p); pieces.unshift(p); render(); });
    byId('f_dup')&&(byId('f_dup').onclick=()=>duplicateSelection());
    byId('f_del')&&(byId('f_del').onclick=()=>{ pushUndo(); pieces=pieces.filter(x=>x!==p); paths=paths.filter(x=>x.owner!==p.id); selOne(null); updateInspector(); render(); });
    byId('pk_carrier')&&(byId('pk_carrier').onclick=()=>{ pendingPick={puckId:p.id,kind:'carrier'}; cv.style.cursor='crosshair'; updateHint(); toast('Click the player who starts with the puck'); });
    byId('pk_pass')&&(byId('pk_pass').onclick=()=>{ if(!p.legs||!p.legs.length){toast('Set a carrier first');return;} pendingPick={puckId:p.id,kind:'pass'}; cv.style.cursor='crosshair'; updateHint(); toast('Click the receiver — or a spot'); });
    byId('pk_clear')&&(byId('pk_clear').onclick=()=>{ pushUndo(); p.legs=[]; updateInspector(); render(); });
    inspBody.querySelectorAll('.pk_t').forEach(sl=>sl.addEventListener('input',()=>{ const i=+sl.dataset.i; p.legs[i].s=parseInt(sl.value);
      for(let k=1;k<p.legs.length;k++){ if(p.legs[k].s<=p.legs[k-1].s) p.legs[k].s=p.legs[k-1].s+100; }
      const l=byId('lbl_pass'+i); if(l)l.textContent='Pass '+passIndex(p.legs,i)+' at '+(p.legs[i].s/1000).toFixed(1)+'s'; render(); }));
  } else {
    const p=getPath(sel.id); if(!p){selOne(null);return updateInspector();}
    const isMotion=!!(p.motion||p.owner);
    inspTitle.textContent= isMotion? 'Motion' : 'Drawing';
    let h='';
    h+='<div class="mini">'+(isMotion? (prettyType(getPiece(p.owner)?.type||'piece')+' travels this lane on Play. Drag the dots to reshape.') : 'Diagram only — does not move.')+'</div>';
    h+=field('Colour', colorBtns(p.color));
    if(isMotion){
      h+='<div class="field"><label id="lbl_delay">Start delay — '+(p.delay/1000).toFixed(1)+'s</label><input type="range" id="p_delay" min="0" max="'+(T-200)+'" step="100" value="'+p.delay+'"></div>';
      h+='<div class="field"><label id="lbl_dur">Travel time — '+(p.dur/1000).toFixed(1)+'s</label><input type="range" id="p_dur" min="300" max="'+T+'" step="100" value="'+p.dur+'"></div>';
      h+='<button class="tbtn" id="p_unlink" style="width:100%;margin-top:4px">Unlink from piece</button>';
    }
    h+='<button class="del" id="p_del">Delete path</button>';
    inspBody.innerHTML=h;
    inspBody.querySelectorAll('[data-col]').forEach(b=>b.onclick=()=>{ pushUndo(); p.color=b.dataset.col;
      inspBody.querySelectorAll('[data-col]').forEach(x=>x.style.outline=''); b.style.outline='2px solid #fff'; render(); });
    bind('p_delay','input',v=>{p.delay=parseInt(v); const l=byId('lbl_delay'); if(l)l.textContent='Start delay — '+(p.delay/1000).toFixed(1)+'s'; render();});
    bind('p_dur','input',v=>{p.dur=parseInt(v); const l=byId('lbl_dur'); if(l)l.textContent='Travel time — '+(p.dur/1000).toFixed(1)+'s'; render();});
    byId('p_unlink')&&(byId('p_unlink').onclick=()=>{ pushUndo(); p.owner=null; updateInspector(); render(); });
    byId('p_del')&&(byId('p_del').onclick=()=>{ pushUndo(); paths=paths.filter(x=>x!==p); selOne(null); updateInspector(); render(); });
  }
}
let _refocus=null;
function restoreFocus(idd){ _refocus=idd; }
function field(lbl,inner){ return '<div class="field"><label>'+lbl+'</label>'+inner+'</div>'; }
function swatchHTML(cur){ let h='<div class="field"><label>Colour</label><div class="swatchrow">';
  Object.entries(COLORS).forEach(([k,v])=>{ h+='<div class="sw'+(v===cur?' on':'')+'" data-k="'+k+'" style="background:'+v+'"></div>'; });
  return h+'</div></div>'; }
function possessionHTML(p){ const legs=p.legs||[];
  const chain = legs.length? legs.map(l=> l.type==='carry'? ('<b>'+pieceTag(l.piece)+'</b>') : '<span style="color:var(--accent)"> &rarr; pass &rarr; </span>'+(l.to?'':'<i>spot</i>')).join('') : '<span class="mini">No carrier yet</span>';
  let h='<div class="field"><label>Puck possession</label><div class="mini" style="line-height:1.6">'+chain+'</div></div>';
  h+='<div class="row2"><button class="tbtn" id="pk_carrier">Set carrier</button><button class="tbtn" id="pk_pass">Add pass</button></div>';
  legs.forEach((l,i)=>{ if(l.type==='pass'){ h+='<div class="field"><label id="lbl_pass'+i+'">Pass '+passIndex(legs,i)+' at '+(l.s/1000).toFixed(1)+'s</label><input type="range" class="pk_t" data-i="'+i+'" min="200" max="'+(T-200)+'" step="100" value="'+l.s+'"></div>'; } });
  if(legs.length) h+='<button class="tbtn" id="pk_clear" style="width:100%;margin-top:2px">Clear possession</button>';
  return h+'<hr style="border:0;border-top:1px solid var(--line);margin:10px 0">';
}
function colorBtns(cur){ const cols=['#11181f','#E8313A','#2FA866','#2F6FE0','#F2811D','#E7B416','#8A2BE2','#5BC2D6','#FFFFFF'];
  return '<div style="display:flex;gap:6px;flex-wrap:wrap">'+cols.map(c=>'<div data-col="'+c+'" style="width:24px;height:24px;border-radius:6px;background:'+c+';cursor:pointer;'+(c==='#FFFFFF'?'border:1px solid #244A66;':'')+(c===cur?'outline:2px solid #5BC2D6;outline-offset:1px;':'')+'"></div>').join('')+'</div>'; }
function bind(idd,ev,fn){ const el=byId(idd); if(el) el.addEventListener(ev,e=>fn(e.target.value)); }
function byId(i){ return document.getElementById(i); }

// =========================================================
//  TOP BAR ACTIONS
// =========================================================
function buildLayoutSeg(){
  const sel=document.getElementById('rinkSel'); if(!sel)return;
  sel.value=rinkConfig;
  sel.onchange=()=>{ pushUndo(); rinkConfig=sel.value; scenes[currentScene].rinkType=rinkConfig; currentView=defaultView(); buildViewSeg();
    fitRect(viewPresets()[0].r); render(); };
  const tc=document.getElementById('trapChk'); if(tc){ tc.checked=showTrap; tc.onchange=()=>{ showTrap=tc.checked; render(); }; }
}
document.getElementById('clearBtn').onclick=()=>{ if(pieces.length||paths.length){ pushUndo(); pieces=[]; paths=[]; scenes[currentScene].pieces=pieces; scenes[currentScene].paths=paths; selOne(null); updateInspector(); render(); toast('Cleared'); } };
document.getElementById('zin').onclick=()=>{ zoomBy(1.18); };
document.getElementById('zout').onclick=()=>{ zoomBy(1/1.18); };
document.getElementById('zfit').onclick=()=>{ const v=viewPresets().find(p=>p.k===currentView)||viewPresets()[0]; fitRect(v.r); render(); };
function zoomBy(f){ const mx=cv.clientWidth/2,my=cv.clientHeight/2; const [wx,wy]=S2W(mx,my);
  cam.s*=f; cam.tx=mx-wx*cam.s; cam.ty=my-wy*cam.s; render(); }

// image insert
document.getElementById('imgBtn').onclick=()=>document.getElementById('imgFile').click();
document.getElementById('imgFile').onchange=e=>{ const f=e.target.files[0]; if(!f)return;
  const r=new FileReader(); r.onload=()=>{ const img=new Image();
    img.onload=()=>{ pushUndo(); const c=viewCenterWorld();
      const p={id:id(),type:'image',x:c.x,y:c.y,size:1.4,rot:0,color:null,num:'',label:'',img,_src:r.result};
      pieces.push(p); selOne('piece',p.id); updateInspector(); render(); toast('Image added — drag to place'); };
    img.src=r.result; };
  r.readAsDataURL(f); e.target.value=''; };

// ---- center-ice logo picker ----
const logoSel=document.getElementById('logoSel');
const logoFile=document.getElementById('logoFile');
function ensureLogoOption(val,label){ if([...logoSel.options].some(o=>o.value===val))return;
  const op=document.createElement('option'); op.value=val; op.textContent=label;
  logoSel.insertBefore(op, logoSel.querySelector('option[value="upload"]')); }
function syncLogoSel(){ logoSel.value = centerLogo||'none'; }
logoSel.onchange=()=>{ const v=logoSel.value;
  if(v==='upload'){ logoFile.click(); syncLogoSel(); return; }
  pushUndo(); centerLogo = v==='none'? null : v; render(); };
logoFile.onchange=e=>{ const f=e.target.files[0]; if(!f)return;
  const r=new FileReader(); r.onload=()=>{ const im=new Image();
    im.onload=()=>{ pushUndo(); LOGO_SRC.custom=r.result; LOGO_IMG.custom=im;
      ensureLogoOption('custom','Custom'); centerLogo='custom'; syncLogoSel(); render(); toast('Custom centre logo set'); };
    im.src=r.result; };
  r.readAsDataURL(f); e.target.value=''; };

// ---- reference diagram picker (drop a drill on the ice to trace/animate over) ----
const refSel=document.getElementById('refSel');
const refFile=document.getElementById('refFile');
function addRefImage(src){ const im=new Image();
  im.onload=()=>{ pushUndo(); const c=viewCenterWorld();
    const p={id:id(),type:'image',x:c.x,y:c.y,size:10,rot:0,opacity:0.55,backdrop:true,img:im,_src:src};
    pieces.unshift(p); selOne('piece',p.id); updateInspector(); render();
    toast('Reference added — trace and animate over it'); };
  im.src=src; }
refSel.onchange=()=>{ const v=refSel.value; refSel.value='';
  if(!v)return; if(v==='uploadref'){ refFile.click(); return; }
  addRefImage(REF_SRC[v]); };
refFile.onchange=e=>{ const f=e.target.files[0]; if(!f)return;
  const r=new FileReader(); r.onload=()=>addRefImage(r.result); r.readAsDataURL(f); e.target.value=''; };

// canvas recording
let mediaRec=null, recChunks=[];
function startRec(){
  if(mediaRec) return;
  const stream=cv.captureStream(30);
  const mime=MediaRecorder.isTypeSupported('video/webm;codecs=vp9')?'video/webm;codecs=vp9':'video/webm';
  mediaRec=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:8000000});
  recChunks=[];
  mediaRec.ondataavailable=e=>{ if(e.data.size>0) recChunks.push(e.data); };
  mediaRec.onstop=()=>{
    const blob=new Blob(recChunks,{type:'video/webm'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
    a.download='drill-'+new Date().toISOString().slice(0,10)+'.webm'; a.click();
    toast('Video saved to your downloads');
    recChunks=[]; mediaRec=null; updateRecBtn();
  };
  mediaRec.start(100);
  updateRecBtn(); toast('Recording started — press REC again to stop');
}
function stopRec(){ if(mediaRec){ mediaRec.stop(); } }
function updateRecBtn(){ const b=document.getElementById('recBtn');
  if(!b) return;
  if(mediaRec){ b.textContent='⏹ Stop'; b.style.color='#E8313A'; b.style.borderColor='#E8313A'; }
  else { b.textContent='⏺ REC'; b.style.color=''; b.style.borderColor=''; }
}
document.getElementById('recBtn').onclick=()=>{ mediaRec? stopRec() : startRec(); };

// image export
function exportImage(fmt){
  // render at 2x resolution for sharpness
  const scale=2;
  const W=cv.width, H=cv.height;
  const off=document.createElement('canvas'); off.width=W*scale; off.height=H*scale;
  const octx=off.getContext('2d');
  octx.scale(scale,scale);
  // white background
  octx.fillStyle='#FFFFFF'; octx.fillRect(0,0,W,H);
  // copy current canvas
  octx.drawImage(cv,0,0,W,H);
  const mime=fmt==='jpg'?'image/jpeg':'image/png';
  const ext=fmt==='jpg'?'jpg':'png';
  const a=document.createElement('a');
  a.href=off.toDataURL(mime,0.95);
  a.download='drill-'+new Date().toISOString().slice(0,10)+'.'+ext;
  a.click();
  toast('Image saved to your downloads');
}
document.getElementById('imgExportBtn').onclick=()=>exportImage('jpg');

// save / open
function doSaveDrill(name){
  syncScene();
  const data={v:2,showTrap,centerLogo,
    customLogo: LOGO_SRC.custom||null,
    currentScene,
    scenes: scenes.map(s=>({
      name:s.name, rinkType:s.rinkType||'full',
      pieces:s.pieces.map(p=>({...p,img:undefined,_src:p._src||null})),
      paths:s.paths.map(p=>({...p,_lut:undefined}))
    }))};
  const safe=name.trim().replace(/[^a-zA-Z0-9 _\-]/g,'').trim()||('drill-'+new Date().toISOString().slice(0,10));
  const blob=new Blob([JSON.stringify(data)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download=safe+'.json'; a.click();
  toast('"'+safe+'" saved — move it to your Drills folder');
}
document.getElementById('exportBtn').onclick=()=>{
  const inp=document.getElementById('drillNameInput');
  inp.value=scenes[currentScene]&&scenes[currentScene].name||'';
  document.getElementById('saveModal').classList.add('show');
  setTimeout(()=>inp.select(),80);
};
document.getElementById('saveModalCancel').onclick=()=>document.getElementById('saveModal').classList.remove('show');
document.getElementById('saveModalConfirm').onclick=()=>{
  const name=document.getElementById('drillNameInput').value;
  document.getElementById('saveModal').classList.remove('show');
  doSaveDrill(name);
};
document.getElementById('drillNameInput').addEventListener('keydown',e=>{
  if(e.key==='Enter'){ document.getElementById('saveModalConfirm').click(); }
  if(e.key==='Escape'){ document.getElementById('saveModal').classList.remove('show'); }
});
document.getElementById('importBtn').onclick=()=>document.getElementById('jsonFile').click();
document.getElementById('jsonFile').onchange=e=>{ const f=e.target.files[0]; if(!f)return;
  const r=new FileReader(); r.onload=()=>{ try{ const o=JSON.parse(r.result); loadData(o); toast('Drill loaded'); }
    catch(err){ toast('Could not read that file'); } }; r.readAsDataURL?r.readAsText(f):r.readAsText(f); e.target.value=''; };
function loadData(o){
  if(o.showTrap!==undefined) showTrap=o.showTrap;
  if(o.customLogo){ LOGO_SRC.custom=o.customLogo; const im=new Image(); im.src=o.customLogo; im.onload=()=>{try{render();}catch(e){}}; LOGO_IMG.custom=im; ensureLogoOption('custom','Custom'); }
  centerLogo=(o.centerLogo!==undefined)?o.centerLogo:centerLogo; syncLogoSel();
  // multi-scene format (v2)
  if(o.scenes && o.scenes.length){
    scenes=o.scenes.map(s=>{
      const sc=makeScene(s.name||'Drill');
      sc.rinkType=s.rinkType||'full';
      sc.pieces=(s.pieces||[]).map(p=>{ const q={...p}; if(p._src){const img=new Image();img.src=p._src;q.img=img;} return q; });
      sc.paths=(s.paths||[]).map(p=>({...p,_lut:null}));
      return sc;
    });
    currentScene=Math.min(o.currentScene||0,scenes.length-1);
  } else {
    // legacy single-drill format
    const sc=makeScene('Drill 1');
    sc.rinkType=o.rinkConfig||(o.layout==='double'?'twofull':'full');
    sc.pieces=(o.pieces||[]).map(p=>{ const q={...p}; if(p._src){const img=new Image();img.src=p._src;q.img=img;} return q; });
    sc.paths=(o.paths||[]).map(p=>({...p,_lut:null}));
    scenes=[sc]; currentScene=0;
  }
  const s=scenes[currentScene];
  pieces=s.pieces; paths=s.paths; undoStack=s.undoStack; redoStack=s.redoStack;
  rinkConfig=s.rinkType||'full'; document.getElementById('rinkSel').value=rinkConfig;
  uid=Math.max(1,...scenes.flatMap(sc=>[...sc.pieces.map(p=>p.id||0),...sc.paths.map(p=>p.id||0)]))+1;
  selOne(null); currentView=defaultView(); buildLayoutSeg(); buildViewSeg();
  fitRect(viewPresets()[0].r); updateInspector(); updateSceneTabs(); render();
  toast('Practice loaded — '+scenes.length+' drill'+(scenes.length>1?'s':'')); }

// help
document.getElementById('helpBtn').onclick=()=>document.getElementById('modal').classList.add('show');
document.getElementById('helpClose').onclick=()=>document.getElementById('modal').classList.remove('show');
document.getElementById('modal').onclick=e=>{ if(e.target.id==='modal') e.currentTarget.classList.remove('show'); };

// transport
document.getElementById('playBtn').onclick=togglePlay;
document.getElementById('staggerBtn').onclick=stagger;
document.getElementById('loopChk').onchange=e=>loop=e.target.checked;
document.getElementById('speed').oninput=e=>{ const sec=14-parseFloat(e.target.value); T=Math.max(1500,sec*1000)+1000;
  // simpler: speed slider 2..12 -> total time
  T=(14-parseFloat(e.target.value))*1000; if(T<1500)T=1500;
  paths.forEach(p=>{ if(p.dur>T)p.dur=T; if(p.delay>T-200)p.delay=Math.max(0,T-200); });
  syncScrub(); };
document.getElementById('scrubber').oninput=e=>{ playing=false; setPlayUI(); tNow=parseInt(e.target.value)/1000*T; syncScrub(); render(); };

// keyboard
window.addEventListener('keydown',e=>{
  if(e.target.tagName==='INPUT')return;
  if(building && (e.key==='Enter'||e.key==='Escape')){ e.preventDefault(); finishBuilding(); return; }
  if(skateBackBuilding && (e.key==='Enter'||e.key==='Escape')){ e.preventDefault(); skateBackBuilding=null; skateBackCursor=null; selOne(null); updateInspector(); render(); return; }
  if(skateRevBuilding && (e.key==='Enter'||e.key==='Escape')){ e.preventDefault(); skateRevBuilding=null; skateRevCursor=null; selOne(null); updateInspector(); render(); return; }
  if(skateBuilding && (e.key==='Enter'||e.key==='Escape')){ e.preventDefault(); skateBuilding=null; skateCursor=null; selOne(null); updateInspector(); render(); return; }
  if(passBuilding && (e.key==='Enter'||e.key==='Escape')){ e.preventDefault(); passBuilding=null; passCursor=null; selOne(null); updateInspector(); render(); return; }
  if(shotBuilding && (e.key==='Enter'||e.key==='Escape')){ e.preventDefault(); shotBuilding=null; shotCursor=null; selOne(null); updateInspector(); render(); return; }
  if(e.code==='Space'){ e.preventDefault(); togglePlay(); }
  else if(e.key==='Escape'){ pendingType=null; pendingOpts=null; pendingStamp=false; pendingPick=null; cv.style.cursor=''; selOne(null); updateInspector(); render(); updateHint(); document.getElementById('modal').classList.remove('show'); }
  else if((e.key==='Delete'||e.key==='Backspace') && selSet.length){ e.preventDefault(); deleteSelection(); }
  else if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){ e.preventDefault(); e.shiftKey?redo():undo(); }
  else if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='c'){ e.preventDefault(); copySelection(); }
  else if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='v'){ e.preventDefault(); pasteFromClip(); }
  else if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='d'){ e.preventDefault(); duplicateSelection(); }
  else if(!e.ctrlKey&&!e.metaKey){
    if(e.key==='v')setTool('select'); else if(e.key==='s')setTool('skate');
    else if(e.key==='p')setTool('pass'); else if(e.key==='a')setTool('arrow');
  }
});

// hint text
function updateHint(){
  const h=document.getElementById('hint'); if(!h) return;  // hint bar was removed from the HTML
  if(pendingPick){ h.textContent = pendingPick.kind==='carrier'?'Click the player who starts with the puck':'Click the receiver, or a spot, for the pass'; h.style.display='block'; return; }
  if(pendingType){ h.textContent=(pendingStamp?'Click to stamp ':'Click to place ')+prettyType(pendingType)+(pendingStamp?'  (Esc to stop)':'  (Esc to cancel)'); h.style.display='block'; return; }
  if(pieces.length===0){ h.textContent='Click a skater on the left to drop it on the ice — then draw a path from it and press Play.'; h.style.display='block'; return; }
  const tips={ select:'Drag pieces • drag a selected lane\'s dots to reshape • Delete to remove',
    motion:'From a piece: drag to curve, or click to add turns (S/U/zig-zag). Click the end of a route to extend it. Double-click or Enter to finish.',
    skate:'Draw a skating route (diagram only, does not move)',
    pass:'Click to start a pass — click again to add a redirect/bump — double-click or Enter to finish. Draw as many passes as needed.', shot:'Draw a shot from the puck',
    arrow:'Draw a straight arrow (diagram only)', pen:'Freehand draw (diagram only)',
    text:'Click anywhere, on or off the ice, to drop a label; double-click a label to edit',
    pan:'Drag to move the view', erase:'Click a piece or path to delete it' };
  h.textContent=tips[tool]||''; h.style.display = tips[tool]? 'block':'none';
}

// toast
let toastT;
function toast(m){ const t=document.getElementById('toast'); t.textContent=m; t.classList.add('show');
  clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove('show'),1700); }

// =========================================================
//  DEMO: 1 D breaks out 2 F's, swing, return 2v1
// =========================================================
function loadDemo(){
  pushUndo(); rinkConfig='full'; pieces=[]; paths=[]; uid=1;
  buildLayoutSeg(); currentView=defaultView(); buildViewSeg();
  const D ={id:id(),type:'player',color:COLORS.blue,x:24,y:42.5,num:'4',size:1,rot:0};
  const F1={id:id(),type:'player',color:COLORS.red,x:30,y:22,num:'9',size:1,rot:0};
  const F2={id:id(),type:'player',color:COLORS.red,x:30,y:63,num:'11',size:1,rot:0};
  const G ={id:id(),type:'goalie',color:COLORS.white,x:13,y:42.5,num:'',size:1,rot:0};
  const PK={id:id(),type:'puck',x:24,y:42.5,size:1,rot:0};
  pieces=[G,D,F1,F2,PK];

  // F1 breakout up the wall, swing high, regroup, attack net 2v1
  const f1=[{x:30,y:22},{x:55,y:16},{x:88,y:14},{x:118,y:24},{x:122,y:42},{x:96,y:46},{x:64,y:40},{x:42,y:36}];
  const f2=[{x:30,y:63},{x:55,y:69},{x:88,y:71},{x:118,y:61},{x:122,y:46},{x:96,y:50},{x:64,y:54},{x:42,y:52}];
  // D retreats to defend the rush
  const dd=[{x:24,y:42.5},{x:34,y:42.5},{x:40,y:43},{x:38,y:42}];
  paths=[
    makeMotion(F1.id,f1, 600, 4400, '#E8313A'),
    makeMotion(F2.id,f2, 900, 4100, '#E8313A'),
    makeMotion(D.id, dd, 1600,3000, '#2F6FE0'),
  ];
  // puck: D carries, breakout pass to F1, then F1 carries it up ice
  PK.legs=[{type:'carry',piece:D.id,s:0},{type:'pass',to:F1.id,s:600},{type:'carry',piece:F1.id,s:1400}];
  placePuckAtStart(PK);
  T=5000; document.getElementById('speed').value=9;
  fitRect({x:0,y:0,w:RW,h:RH}); selOne(null); updateInspector(); tNow=0; syncScrub(); render();
  toast('2v1 breakout loaded — press Play');
}
document.getElementById('demoBtn').onclick=loadDemo;
// combined site theme + dark ice toggle
const _themeBtn=document.getElementById('darkIceBtn');
function applyTheme(light){
  document.body.classList.toggle('light-theme',light);
  document.body.classList.remove('dark-ice');
  _themeBtn.textContent=light?'🌙 Dark':'☀️ Light';
  render();
}
_themeBtn.onclick=()=>applyTheme(!document.body.classList.contains('light-theme'));

// print: snapshot canvas → stable print window
document.getElementById('printBtn').onclick=()=>{
  syncScene();
  render();
  const url=cv.toDataURL('image/png');
  const sc=scenes[currentScene]||{};
  const drill=sc.name||'Drill';
  const notes=sc.notes||'';
  const equip=sc.equip||'';
  const w=window.open('','_blank','width=1000,height=820');
  const equipHtml=equip?'<div class="equip"><span class="elbl">Equipment:</span> '+equip+'<\/div>':'';
  const notesHtml=notes?'<div class="notes">'+notes+'<\/div>':'';
  w.document.write('<!doctype html><html><head><title>'+drill+'</title><style>'+
    '*{margin:0;padding:0;box-sizing:border-box}'+
    'body{background:#fff;display:flex;flex-direction:column;align-items:center;padding:16px;font:14px system-ui;color:#111}'+
    'h2{font-size:17px;font-weight:800;margin-bottom:6px}'+
    'img{max-width:100%;height:auto;border:1px solid #ddd;margin-bottom:8px}'+
    '.notes{font-size:13px;color:#444;margin-bottom:6px;max-width:900px;width:100%}'+
    '.equip{font-size:13px;color:#1a5276;max-width:900px;width:100%;padding:6px 10px;background:#eaf4fb;border-radius:6px;border:1px solid #aed6f1}'+
    '.elbl{font-weight:700;margin-right:6px}'+
    '@media print{@page{margin:10mm}body{padding:0}img{max-width:100%;max-height:85vh;border:none}}'+
    '<\/style><\/head><body><h2>'+drill+'<\/h2><img src="'+url+'">'+notesHtml+equipHtml+
    '<script>window.onload=function(){window.print();}<\/script><\/body><\/html>');
  w.document.close();
};
document.getElementById('drillNotes').addEventListener('input',()=>{ scenes[currentScene].notes=document.getElementById('drillNotes').value; });
document.getElementById('equipNotes').addEventListener('input',()=>{ scenes[currentScene].equip=document.getElementById('equipNotes').value; });

// =========================================================
//  BOOT
// =========================================================
function resize(){ if(cv.clientWidth<1||cv.clientHeight<1) return; DPR=Math.min(window.devicePixelRatio||1,2);
  cv.width=cv.clientWidth*DPR; cv.height=cv.clientHeight*DPR; render(); }
window.addEventListener('resize',resize);

buildTools(); buildSwatches(); buildObjColors(); buildPieceTray(); buildLayoutSeg(); buildViewSeg(); updateSceneTabs();
setTool('select');
// Initial fit must wait until the canvas actually has a size — on iPad/Safari the
// layout can finalize after first paint, and fitting a 0-size canvas gives a negative
// scale (cropped in the top-left until you tap Fit). Re-run until it lands once.
let didBoot=false;
function bootFit(){ if(didBoot||cv.clientWidth<1||cv.clientHeight<1) return; fitRect({x:0,y:0,w:RW,h:RH}); resize(); didBoot=true; }
bootFit();
requestAnimationFrame(bootFit);
window.addEventListener('load', bootFit);
setTimeout(bootFit,200); setTimeout(bootFit,600); setTimeout(bootFit,1500);
if(window.ResizeObserver){ new ResizeObserver(()=>{ if(!didBoot) bootFit(); else resize(); }).observe(cv); }
syncScrub();
requestAnimationFrame(tick);

// collapsible tray sections
document.querySelectorAll('.tray-toggle').forEach(h=>{
  const sec=document.getElementById(h.dataset.target);
  sec.style.maxHeight='600px'; // large enough for any section
  h.addEventListener('click',()=>{
    const collapsed=h.classList.toggle('collapsed');
    sec.style.maxHeight=collapsed?'0':'600px';
  });
});
