"use strict";
/* ===========================================================
   RINK LAB — single-file hockey drill animator
   Model: pieces (positions in feet) + paths (polylines).
   A path that starts on a piece becomes that piece's motion track.
   =========================================================== */

// Kraken first, and the default. The board is a Kraken board now; Anchorage
// drops to third rather than off the list - it is still the logo on last
// season's saved drills, and opening one must still find it.
const LOGO_SRC={"krakenS": "images/logo-krakenS.png", "youthS": "images/logo-youthS.png", "anchorage": "images/logo-anchorage.png", "anchorLight": "images/logo-anchorLight.png", "anchorNavy": "images/logo-anchorNavy.png"};
const LOGO_NAMES={krakenS:'Seattle Kraken',youthS:'Kraken (mono)',anchorage:'Anchorage Academy',anchorLight:'Anchor (ice)',anchorNavy:'Anchor (navy)'};
const LOGO_IMG={};
for(const k in LOGO_SRC){const im=new Image(); im.src=LOGO_SRC[k]; im.onload=()=>{try{render();}catch(e){}}; LOGO_IMG[k]=im;}
let centerLogo='krakenS';
const REF_SRC={"stations": "images/ref-stations.png", "swing": "images/ref-swing.png", "flow": "images/ref-flow.png", "cones": "images/ref-cones.png"};
const REF_NAMES={stations:'10U Stealth (stations)',swing:'Figure-8 swing',flow:'Flow / regroup',cones:'Cone weave'};
const REF_IMG={};
for(const k in REF_SRC){const im=new Image(); im.src=REF_SRC[k]; im.onload=()=>{try{render();}catch(e){}}; REF_IMG[k]=im;}
const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
let DPR = Math.min(window.devicePixelRatio||1, 2);

// ---- world / rink geometry (feet) ----
// Sheet size. LET, not const - the surface changes size, the MARKINGS do not.
// A goal line is 11ft off the boards and a centre circle is 15ft on every sheet
// in the world; what changes is how much ice sits around them. So every feature
// below is written as a real distance from a real edge, and only RW/RH move.
let RW=200, RH=85;
const GAP=24;                            // gap between sheets when two are drawn
const RINK_SIZES={
  nhl:      {w:200, h:85,  t:'NHL 200 x 85'},
  olympic:  {w:200, h:100, t:'Olympic 200 x 100'},
  hybrid:   {w:200, h:90,  t:'Hybrid 200 x 90'},
  small:    {w:185, h:85,  t:'Small sheet 185 x 85'}
};
let rinkSize='nhl';
function setRinkSize(k){
  const d=RINK_SIZES[k]; if(!d) return;
  rinkSize=k; RW=d.w; RH=d.h;
  currentView=defaultView(); buildViewSeg(); applyView(viewPresets()[0]);
  render();
}
const FW=210, FH=120;                  // grass field (dryland) dimensions in feet
// KCI Iceplex floor plan (feet, scaled to match piece scale)
const IW=520, IH=290;                  // total facility footprint
let rinkConfig='full';
let showTrap=true;
const CONFIGS={
  full:    {label:'Full sheet',      panels:[{ox:0,oy:0,kind:'full'}]},
  half:    {label:'Half sheet',      panels:[{ox:0,oy:0,kind:'halfL'}]},
  halves:  {label:'Two half sheets HORIZONTAL', panels:[{ox:0,oy:0,kind:'halfL'},{ox:100+GAP,oy:0,kind:'halfL'}]},
  // Josh's faceoff plays are drawn as a zone with the net at the BOTTOM, two
  // to a page. Stack the two halves in world space and turn the stage a
  // quarter: each net swings to the bottom and the pair lands side by side, so
  // the picture is landscape and drops into a practice-sheet slot as it is.
  // Nothing new is drawn - it is the same half sheet, seen from the end.
  halvesV: {label:'Two half sheets VERTICAL', panels:[{ox:0,oy:0,kind:'halfL'},{ox:0,oy:RH+GAP,kind:'halfL'}]},
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
// The stage can be turned a quarter turn so the net sits at the bottom. The
// turn is applied to the canvas transform in clear(), which means every drawing
// routine — rink lines, arcs, pieces, marks — carries on untouched. The only
// thing that has to know about it is the mouse, which still arrives in screen
// space: drawnXY puts a pointer back into the space everything is drawn in.
let camRot=0;                       // 0 or 90
function W2S(x,y){ return [x*cam.s+cam.tx, y*cam.s+cam.ty]; }
function S2W(px,py){ return [(px-cam.tx)/cam.s, (py-cam.ty)/cam.s]; }
function drawnXY(px,py){
  if(!camRot) return [px,py];
  const w=cv.clientWidth, h=cv.clientHeight;
  const a=px-w/2, b=py-h/2;
  return [w/2-b, h/2+a];            // inverse of ctx.rotate(-90°) about centre
}
// The stage changes height for reasons that have nothing to do with the board:
// a toolbar row wraps, a notes box grows, the window is dragged shorter. The
// camera used to keep the zoom it was given at the old size, so the rink stayed
// at a scale the stage could no longer hold and you were left looking at one
// corner of it. Remember what was last fitted, and refit on a size change -
// unless you have moved the view yourself, in which case your framing is the
// one that matters and nothing should touch it.
let lastFit=null, camMoved=false;
function fitRect(r,pad=24){
  lastFit=r; camMoved=false;
  const cw=cv.clientWidth, ch=cv.clientHeight;
  // A short stage can leave less room than the padding asks for, and the
  // subtraction then goes negative — which flips the whole board through the
  // origin and puts every mark off screen. Give up the padding first.
  const p=Math.max(0, Math.min(pad, (Math.min(cw,ch)-24)/2));
  // Turned a quarter turn, the rink lands across the canvas the other way, so
  // it has to be fitted against the swapped side. Rotation happens about the
  // canvas centre, so anything centred before the turn is still centred after.
  const availW = camRot ? (ch-p*2) : (cw-p*2);
  const availH = camRot ? (cw-p*2) : (ch-p*2);
  const s=Math.max(0.05, Math.min(availW/r.w, availH/r.h));
  cam.s=s; cam.tx=(cw - r.w*s)/2 - r.x*s; cam.ty=(ch - r.h*s)/2 - r.y*s;
}

// view presets depend on the rink configuration
function defaultView(){ return rinkConfig==='full'?'full': rinkConfig==='half'?'zone': rinkConfig==='field'?'full': rinkConfig==='halvesV'?'bothv':'both'; }
// The quarter turn a surface is MEANT to be seen at. A vertical pair is only
// itself turned; everything else is drawn flat, as it always was. The printed
// sheet asks this too, so the paper shows the drill the way it was drawn.
function configRot(cfg){ return (cfg||rinkConfig)==='halvesV' ? 90 : 0; }
// Both ends, because a coach setting up a goalie drill is at whichever end has
// the ice, not always the left one. Vertical as well: net-front work reads better
// with the net at the bottom and the play coming up the screen, which is how the
// D-Zone ↓ views already work.
function creaseViews(){
  return [
    {k:'crease',  t:'Crease',   r:{x:-4,  y:14, w:48, h:57}},
    {k:'creasev', t:'Crease ↓', r:{x:-4,  y:14, w:48, h:57}, rot:90},
    {k:'crease2', t:'Crease R', r:{x:156, y:14, w:48, h:57}},
  ];
}
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
    {k:'dzv', t:'D-Zone ↓', r:{x:0,y:0,w:92,h:RH}, rot:90},
    {k:'ozv', t:'O-Zone ↓', r:{x:108,y:0,w:92,h:RH}, rot:90},
    // Goal-line close-up, for goalie work and net-front battles. A VIEW, not a
    // new surface: it frames the real rink, so the crease, the net, the goal
    // line and the trapezoid keep the dimensions they already have. Drawing a
    // separate close-up would be a second set of numbers to get wrong.
    // Goal line is at x=11, crease is a 6ft arc off it, net 6ft x 3.4ft, and the
    // end boards curve away behind - so from -4 to 44 holds all of it with the
    // low slot and both end-zone dots.
    ...creaseViews(),
  ];
  if(rinkConfig==='half') return [
    {k:'zone', t:'Zone', r:{x:0,y:0,w:100,h:RH}},
    {k:'tight',t:'Slot', r:{x:0,y:0,w:62,h:RH}},
    {k:'vert', t:'Net ↓', r:{x:0,y:0,w:100,h:RH}, rot:90},
    {k:'vtight',t:'Slot ↓',r:{x:0,y:0,w:62,h:RH}, rot:90},
    // A half sheet only has the one net, so only the left pair applies.
    ...creaseViews().slice(0,2),
  ];
  if(rinkConfig==='halves') return [
    {k:'both', t:'Both', r:b},
    {k:'left', t:'Left', r:{x:0,y:0,w:100,h:RH}},
    {k:'right',t:'Right',r:{x:100+GAP,y:0,w:100,h:RH}},
  ];
  // Every view here carries the turn - this surface has no flat reading. The
  // turn sends a bigger world Y to the right of the screen, so the panel at
  // oy:0 is the one on the left.
  if(rinkConfig==='halvesV') return [
    {k:'bothv', t:'Both ↓', r:b, rot:90},
    {k:'leftv', t:'Left ↓', r:{x:0,y:0,w:100,h:RH}, rot:90},
    {k:'rightv',t:'Right ↓',r:{x:0,y:RH+GAP,w:100,h:RH}, rot:90},
  ];
  return [
    {k:'both',t:'Both',  r:b},
    {k:'top', t:'Top',   r:{x:0,y:0,w:RW,h:RH}},
    {k:'bot', t:'Bottom',r:{x:0,y:RH+GAP,w:RW,h:RH}},
  ];
}
let currentView='full';
// A view carries its own quarter-turn, so switching views is the only thing
// that ever changes the stage's orientation.
function applyView(p){
  if(!p) return;
  camRot = p.rot ? 90 : 0;
  currentView = p.k;
  fitRect(p.r);
}
function buildViewSeg(){
  const seg=document.getElementById('viewSeg'); seg.innerHTML='';
  viewPresets().forEach((p,i)=>{
    const b=document.createElement('button'); b.textContent=p.t; b.dataset.k=p.k;
    if(p.k===currentView) b.classList.add('on');
    b.onclick=()=>{ applyView(p); [...seg.children].forEach(c=>c.classList.toggle('on',c.dataset.k===p.k)); render(); };
    seg.appendChild(b);
  });
}

// =========================================================
//  SCENES (multi-drill practice)
// =========================================================
function makeScene(name){ return {name, pieces:[], paths:[], rinkType:'full', undoStack:[], redoStack:[], notes:'', equip:'', mins:'', rest:'', dirty:false}; }
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
  const mn=document.getElementById('drillMins'); if(mn) scenes[currentScene].mins=mn.value;
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
  const mn=document.getElementById('drillMins'); if(mn) mn.value=s.mins||'';
  const nb=document.getElementById('drillRest'); if(nb) nb.value=(s.rest===0||s.rest)?s.rest:'';
  if(typeof growAllNotes==='function') growAllNotes();   // the next drill's notes are a different length
  if(typeof updateMinsTotal==='function') updateMinsTotal();
  selOne(null); building=null; passBuilding=null; webBuilding=null; webCursor=null; shotBuilding=null; skateBuilding=null; skateBackBuilding=null; skateBackCursor=null; skateRevBuilding=null; skateRevCursor=null;
  tNow=0; playing=false;
  try{setPlayUI();}catch(e){}
  currentView=defaultView(); buildLayoutSeg(); buildViewSeg();
  applyView(viewPresets()[0]);
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
  keepBeforeWipe();                     // the practice as it stands, before the tab goes
  scenes.splice(idx,1);
  const next=Math.min(idx,scenes.length-1);
  currentScene=next;
  const s=scenes[next];
  pieces=s.pieces; paths=s.paths;
  undoStack=s.undoStack; redoStack=s.redoStack;
  rinkConfig=s.rinkType||'full';
  document.getElementById('rinkSel').value=rinkConfig;
  selOne(null); currentView=defaultView(); buildLayoutSeg(); buildViewSeg();
  applyView(viewPresets()[0]);
  updateInspector(); updateSceneTabs(); render();
}
function renameScene(idx){
  const s=prompt('Drill name:',scenes[idx].name); if(s&&s.trim()){ scenes[idx].name=s.trim(); scenes[idx].dirty=true; } updateSceneTabs();
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
/* Drag a tab to reorder the drills.

   POINTER events, not HTML5 drag-and-drop: dragstart/drop do not fire on iOS
   Safari at all, and the iPad is half of where this gets used. Pointer events
   cover mouse, pen and touch with one path.

   A drag has to not eat the click. Nothing happens until the pointer has moved
   DRAG_SLOP pixels, so a tap still selects the drill and a double-tap still
   renames it. */
const DRAG_SLOP = 6;
let _dragTab = null;   // { el, from, startX, live }

function tabDragStart(e, el, from){
  // Ignore the ⧉ and × spans - they have their own jobs, and starting a drag
  // from "delete" would be a nasty way to lose a drill.
  if (e.target !== el) return;
  if (e.button != null && e.button !== 0) return;
  _dragTab = { el, from, startX: e.clientX, live: false };
  el.setPointerCapture && el.setPointerCapture(e.pointerId);
}

function tabDragMove(e){
  if (!_dragTab) return;
  if (!_dragTab.live) {
    if (Math.abs(e.clientX - _dragTab.startX) < DRAG_SLOP) return;
    _dragTab.live = true;
    _dragTab.el.style.opacity = '.55';
    _dragTab.el.style.cursor  = 'grabbing';
  }
  // Reorder the DOM live so the gap follows the finger. The array is not touched
  // until the drop - an abandoned drag must leave the drills exactly as they were.
  const bar = _dragTab.el.parentNode; if (!bar) return;
  const tabs = Array.prototype.filter.call(bar.children,
                 n => n.classList.contains('scenetab') && !n.classList.contains('scenetab-add'));
  for (const other of tabs) {
    if (other === _dragTab.el) continue;
    const r = other.getBoundingClientRect();
    const mid = r.left + r.width / 2;
    if (e.clientX < mid && other.compareDocumentPosition(_dragTab.el) & Node.DOCUMENT_POSITION_FOLLOWING) {
      bar.insertBefore(_dragTab.el, other); break;
    }
    if (e.clientX > mid && other.compareDocumentPosition(_dragTab.el) & Node.DOCUMENT_POSITION_PRECEDING) {
      bar.insertBefore(_dragTab.el, other.nextSibling); break;
    }
  }
}

function tabDragEnd(){
  if (!_dragTab) return;
  const d = _dragTab; _dragTab = null;
  d.el.style.opacity = ''; d.el.style.cursor = '';
  if (!d.live) return;                       // never passed the slop: it was a click

  const bar = d.el.parentNode; if (!bar) { updateSceneTabs(); return; }
  const tabs = Array.prototype.filter.call(bar.children,
                 n => n.classList.contains('scenetab') && !n.classList.contains('scenetab-add'));
  const to = tabs.indexOf(d.el);
  if (to < 0 || to === d.from) { updateSceneTabs(); return; }

  // Write the live board back before touching the array, then follow the CURRENT
  // drill by identity rather than by index - moving a tab past the one you are on
  // changes its index, and tracking the number would silently switch which drill
  // is open.
  syncScene();
  const open = scenes[currentScene];
  scenes.splice(to, 0, scenes.splice(d.from, 1)[0]);
  currentScene = scenes.indexOf(open);
  updateSceneTabs();
  toast('Moved "' + d.el.firstChild.textContent + '" to ' + (to + 1) + ' of ' + scenes.length);
}

function updateSceneTabs(){
  const bar=document.getElementById('scenebar'); if(!bar)return; bar.innerHTML='';
  scenes.forEach((s,i)=>{
    const t=document.createElement('button'); t.className='scenetab'+(i===currentScene?' on':'')+(s.dirty?' unsaved':'');
    t.textContent=s.name;
    t.title=(s.dirty?'NOT SAVED to a file since you last changed it. ':'Saved - matches a file on disk. ')+
      'Click to open. Drag to reorder. Double-click to rename.';
    t.style.touchAction='none';       // or the browser pans the tab strip instead
    t.onclick=()=>loadScene(i);
    t.ondblclick=(e)=>{ e.stopPropagation(); renameScene(i); };
    t.onpointerdown=(e)=>tabDragStart(e,t,i);
    t.onpointermove=tabDragMove;
    t.onpointerup=tabDragEnd;
    t.onpointercancel=tabDragEnd;
    const dup=document.createElement('span'); dup.textContent='⧉'; dup.className='scenetab-x';
    dup.title='Duplicate drill'; dup.onclick=(e)=>{ e.stopPropagation(); duplicateScene(i); };
    const x=document.createElement('span'); x.textContent='×'; x.className='scenetab-x';
    x.title='Delete drill'; x.onclick=(e)=>{ e.stopPropagation(); deleteScene(i); };
    t.appendChild(dup); t.appendChild(x); bar.appendChild(t);
  });
  const add=document.createElement('button'); add.className='scenetab scenetab-add'; add.textContent='+ Drill';
  add.title='Add an empty drill as a new tab';
  add.onclick=addScene; bar.appendChild(add);
}

// Telestration stroke weight. Diagram lines on a rink want hairlines; marks
// burned over game footage need to be fat to read. Each annotation carries its
// own `w` multiplier, applied while that annotation draws.
let _wmul=1;
let _headW=1;   // arrowhead size, kept off _wmul so the outline pass can fatten
                // the stroke without ballooning the head into a black triangle
let _opa=1;       // opacity of the annotation currently drawing
let markW=1;      // weight applied to the next mark drawn
let markOp=1;     // opacity applied to the next mark drawn

// Per-mark timing. A mark drawn while parked at 4s should appear at 4s and run
// to the end, so an explanation builds up as the clip plays instead of every
// drawing sitting on screen at once.
function markStart(){
  const t=Math.max(0, Math.round(tNow));
  // Parked at the end (you just watched it through)? Start at 0 instead —
  // otherwise the mark gets a sliver of life and looks like it vanished.
  return t > T-800 ? 0 : t;
}
let markHold=null;    // ms a new mark stays up; null = to the end of the clip
let markFreeze=false; // does a new mark stop the clip while it's up?
// Set by the UI layer while a freeze-hold is running, so markVisible knows
// which mark is currently holding the clip.
let _holdIds=null;   // ids of every mark the current freeze hold is showing
function markSpan(){
  // A pause is REAL time and costs the clip nothing, so it is not capped by
  // how much footage is left. A mark eight seconds into a ten-second clip was
  // getting a 2s pause instead of the 3s asked for.
  if(markFreeze) return Math.max(300, markHold==null ? 2000 : markHold);
  const rest = T - markStart();
  return Math.max(300, markHold==null ? rest : Math.min(markHold, rest));
}
// Motion paths keep their old meaning — their bar is travel time, not
// visibility — so only plain annotations are windowed.
function markVisible(p){
  if(p.hidden) return false;
  // A cover link has no timing of its own — it is on screen exactly when both
  // of the rings it joins are. Giving it its own delay/dur would let the
  // connector outlive a ring and hang off nothing.
  if(p.type==='link'){
    const a=getPath(p.a), b=getPath(p.b);
    return !!(a && b && markVisible(a) && markVisible(b));
  }
  if(p.motion||p.owner) return true;
  const d=p.delay||0, u=(p.dur==null?T:p.dur);
  if(p.freeze){
    // A freeze mark occupies NO clip time — it lives at one instant and holds
    // the world there for `dur` of real time. While playing it shows only
    // during its own hold. While paused, show it only near its instant (or
    // whenever it's selected, so you can still edit it); treating `dur` as a
    // span of clip time made it linger long after its moment had passed.
    if(_holdIds) return _holdIds.indexOf(p.id)>=0;
    if(playing) return false;
    // Only near its own instant — no exception for "selected". Keeping a
    // selected freeze on screen so it stayed editable just made it linger
    // across the whole clip; selecting one now jumps the playhead to it.
    return Math.abs(tNow-d) <= 250;
  }
  return tNow>=d-1 && tNow<=d+u+1;
}

let tool='select';
let pendingType=null, pendingOpts=null;   // piece (and template) armed to drop at next click
let pendingPick=null;   // {puckId, kind} — waiting for a carrier/receiver click
let activeColor=null;   // null = each object's own default; otherwise applies to new objects + lines
let clip=null;          // copied piece/path
let pendingStamp=false; // keep placing copies until Esc
let playerColor='blue';
// Circle or triangle, applied to every position you stamp. DrillChange shows
// both shapes in three colours as a grid of 24 buttons; one shape switch over a
// grid of positions says the same thing without the wall of buttons, and the
// thumbnails redraw so you can see what you are about to place.
let playerShape='circle';
let passBuilding=null;  // {path} click-based pass being built
let webBuilding=null;   // {path} click-based coverage web being built
let webCursor=null;
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
function pushUndo(){ undoStack.push(snapshot()); if(undoStack.length>60)undoStack.shift(); redoStack.length=0;
  // Every mutation goes through here, so this is the one hook autosave needs -
  // and the one place that can honestly say a drill no longer matches its file.
  if(scenes[currentScene] && !scenes[currentScene].dirty){ scenes[currentScene].dirty=true;
    if(typeof updateSceneTabs==="function") updateSceneTabs(); }
  if(typeof autosave==="function") autosave(); }
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
  {k:'skate',    n:'Skate', svg:'<path d="M2 12h14" fill="none" stroke="var(--accent)" stroke-width="2"/><path d="M15 8l6 4-6 4z" fill="var(--accent)"/>'},
  {k:'skateback',n:'Puck', svg:'<path d="M2 14q3-6 6 0t6 0 6 0" fill="none" stroke="var(--accent)" stroke-width="1.8"/><path d="M19 8l4 3-4 3z" fill="var(--accent)"/>'},
  {k:'skaterev', n:'Back',  svg:'<path d="M3 16q1-4 2.5 0t2 2 2.5-2 2 2 2.5-2" fill="none" stroke="var(--accent)" stroke-width="2"/><path d="M19 13l3 3-3 3" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'},
  {k:'pass',   n:'Pass', svg:'<path d="M2 12h13" fill="none" stroke="var(--accent)" stroke-width="2.6" stroke-linecap="round" stroke-dasharray="0 5"/><path d="M15 8l6 4-6 4z" fill="var(--accent)"/>'},
  {k:'shot',   n:'Shot', svg:'<path d="M2 10h11M2 14h11" fill="none" stroke="var(--accent)" stroke-width="1.6"/><path d="M14 8l7 4-7 4z" fill="none" stroke="var(--accent)" stroke-width="1.7" stroke-linejoin="round"/>'},
  {k:'arrow',  n:'Arrow', svg:'<path d="M2 12h14" fill="none" stroke="var(--accent)" stroke-width="2"/><path d="M15 8l6 4-6 4z" fill="var(--accent)"/>'},
  {k:'ring',   n:'Ring',   svg:'<ellipse cx="12" cy="13" rx="9" ry="5" fill="none" stroke="var(--accent)" stroke-width="2.6"/>'},
  {k:'cover',  n:'Cover',  svg:'<ellipse cx="6" cy="16.5" rx="4.6" ry="3.4" fill="none" stroke="var(--accent)" stroke-width="2"/><ellipse cx="18" cy="7.5" rx="4.6" ry="3.4" fill="none" stroke="var(--accent)" stroke-width="2"/><path d="M9.4 14.2l4 -3" fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-dasharray="2.4 2"/><path d="M12 13.4l2.6-2 .4 2.6" fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'},
  {k:'web',    n:'Web',    svg:'<path d="M12 3L4 10l3 10h10l3-10zM12 3l-5 17M12 3l5 17M4 10h16M4 10l13 10M20 10L7 20" fill="none" stroke="var(--accent)" stroke-width="1.1"/>'},
  {k:'bar',    n:'Bar',    svg:'<path d="M4 12h16" fill="none" stroke="var(--accent)" stroke-width="4" stroke-linecap="round"/>'},
  {k:'pen',    n:'Pen',    svg:'<path d="M4 20l3-1L19 7l-2-2L5 17z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>'},
  {k:'text',   n:'Text',   svg:'<path d="M5 5h14M12 5v14M9 19h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'},
  {k:'pan',    n:'Pan',    svg:'<path d="M12 3v8M8 7l4-4 4 4M5 12h14M9 16l3 4 3-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'},
  {k:'erase',  n:'Erase',  svg:'<path d="M6 18l-3-3 9-9 6 6-6 6z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9 21h11" stroke="currentColor" stroke-width="2"/>'},
];
function buildTools(){
  const g=document.getElementById('tools'); g.innerHTML='';
  TOOLS.forEach(t=>{
    const b=document.createElement('button'); b.className='tool'+(tool===t.k?' on':'');
    // Icon and name. Stripping the names left a rail of unlabelled glyphs, and
    // that is the layout Jay asked to go back from.
    b.dataset.k=t.k; b.title=t.n;
    b.innerHTML=`<svg viewBox="0 0 24 24">${t.svg}</svg>${t.n}`;
    b.onclick=()=>setTool(t.k);
    g.appendChild(b);
  });
}
function setTool(k){ if(building) finishBuilding(); if(k!=='cover') cancelCover(); tool=k; pendingType=null; pendingOpts=null; pendingStamp=false;
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
    // Positions redraw too, not just Skaters. The whole point of the palette is
    // that a thumbnail shows what you are about to place, and a red team with
    // blue position buttons is a palette telling you the wrong thing.
    d.onclick=()=>{ playerColor=k; [...s.children].forEach(c=>c.classList.toggle('on',c.dataset.k===k));
      fillTray('skaters',SKATERS); fillTray('positions',POSITIONS); };
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
  if((type==='player') && playerShape==='triangle') base.shape='triangle';
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
  // The shape switch applies to skaters, before opts - so a palette entry that
  // names its own shape still wins.
  if(type==='player' && playerShape==='triangle') piece.shape='triangle';
  Object.assign(piece, opts||{});
  pieces.push(piece);
  selOne('piece',piece.id); updateInspector(); render(); toast(prettyType(piece.type)+' added');
}
function nextNum(){ const used=pieces.filter(p=>p.type==='player'&&p.color===COLORS[playerColor]).length; return used+1; }
function prettyType(t){ return ({player:'Skater',goalie:'Goalie',coach:'Coach',puck:'Puck',puckstack:'Pucks',ball:'Ball',net:'Net',cone:'Cone',tire:'Tire',bumper:'Bumper',ring:'Ring',link:'Cover link',dot:'Dot',zone:'Zone',image:'Image',text:'Text'})[t]||t; }
function defColor(t){ return ({cone:'#F2811D',net:'#D11C2C',bumper:'#E7B416',dot:'#D11C2C',tire:'#E7B416',puck:'#111418',puckstack:'#111418',ball:'#ffffff',ring:'#222831',coach:'#E7B416',zone:'#2FA866'})[t]||'#11181f'; }
// Whether a mark is pale enough to vanish on white ice and needs a dark rim.
// This is NOT the same question as isDark, which decides what colour of ink to
// put ON a filled shape - sharing that threshold is what put a black outline
// round orange. Orange reads 151 and is perfectly visible on white; gold 172,
// lime 187 and yellow 199 are not. The line sits between them.
function needsRim(hex){
  if(!hex) return false;
  const c=(hex+'').replace('#','');
  const r=parseInt(c.substr(0,2),16),g=parseInt(c.substr(2,2),16),b=parseInt(c.substr(4,2),16);
  return (0.299*r+0.587*g+0.114*b) >= 165;
}
function isDark(hex){ if(!hex)return true; const c=(hex+'').replace('#',''); const r=parseInt(c.substr(0,2),16),g=parseInt(c.substr(2,2),16),b=parseInt(c.substr(4,2),16); return (0.299*r+0.587*g+0.114*b)<140; }
function escapeHtml(s){ return (s||'').replace(/[&<>"\']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function getPiece(i){ return pieces.find(p=>p.id===i); }
function getPath(i){ return paths.find(p=>p.id===i); }

// =========================================================
//  RINK + PIECE RENDERING
// =========================================================
// Clear the whole backing store, not the CSS box. The two match everywhere
// except during an export, where the canvas is resized to the clip's own
// resolution and the CSS box stays put — clearing by the box would have left
// most of every recorded frame stale.
function clear(){
  ctx.setTransform(DPR,0,0,DPR,0,0);
  const w=cv.width/DPR, h=cv.height/DPR;
  ctx.clearRect(0,0,w,h);
  if(camRot){ ctx.translate(w/2,h/2); ctx.rotate(-Math.PI/2); ctx.translate(-w/2,-h/2); }
}

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
    ctx.beginPath(); ctx.arc(X(gx),Y(RH/2),6*s, dir>0?-Math.PI/2:Math.PI/2, dir>0?Math.PI/2:3*Math.PI/2, false); ctx.closePath(); ctx.fill(); ctx.stroke(); };
  const netbox=(gx,dir)=>{
    // dir=1: left net (goal line at X(gx), net extends LEFT toward end boards)
    // dir=-1: right net (goal line at X(gx), net extends RIGHT toward end boards)
    const d=3.4*s, w=6*s, r=0.8*s;
    const gl=X(gx), bk=gl-dir*d;  // goal line x, back-of-net x
    const L=Math.min(gl,bk), R=Math.max(gl,bk);
    const T=Y(RH/2)-w/2, B=Y(RH/2)+w/2;
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
    ctx.beginPath(); ctx.moveTo(X(gx),Y(RH/2-11)); ctx.lineTo(X(boardx),Y(RH/2-14)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(X(gx),Y(RH/2+11)); ctx.lineTo(X(boardx),Y(RH/2+14)); ctx.stroke(); };

  if(full){
    V(11,red,thin); V(RW-11,red,thin);
    V(RW/2-25,blue,thick); V(RW/2+25,blue,thick); V(RW/2,red,thick);
    [[31,RH/2-22],[31,RH/2+22],[RW-31,RH/2-22],[RW-31,RH/2+22]].forEach(([a,b])=>faceoff(a,b));
    [[RW/2-20,RH/2-22],[RW/2-20,RH/2+22],[RW/2+20,RH/2-22],[RW/2+20,RH/2+22]].forEach(([a,b])=>nzdot(a,b));
    ctx.strokeStyle=blue; ctx.lineWidth=thin; ctx.beginPath(); ctx.arc(X(RW/2),Y(RH/2),15*s,0,7); ctx.stroke();
    ctx.fillStyle=red; ctx.beginPath(); ctx.arc(X(RW/2),Y(RH/2),0.95*s,0,7); ctx.fill();
    trapezoid(11,0); trapezoid(RW-11,RW);
    netbox(11,1); netbox(RW-11,-1); crease(11,1); crease(RW-11,-1);
  } else {
    V(11,red,thin); V(RW/2-25,blue,thick); V(RW/2,red,thick);
    [[31,RH/2-22],[31,RH/2+22]].forEach(([a,b])=>faceoff(a,b));
    [[RW/2-20,RH/2-22],[RW/2-20,RH/2+22]].forEach(([a,b])=>nzdot(a,b));
    ctx.strokeStyle=blue; ctx.lineWidth=thin; ctx.beginPath(); ctx.arc(X(RW/2),Y(RH/2),15*s,0,7); ctx.stroke();
    ctx.fillStyle=red; ctx.beginPath(); ctx.arc(X(RW/2),Y(RH/2),0.95*s,0,7); ctx.fill();
    trapezoid(11,0); netbox(11,1); crease(11,1);
  }
  ctx.restore();
  // redraw board outline on top so line bleeds are covered
  ctx.lineWidth=board; ctx.strokeStyle=ink; ctx.lineJoin='round'; boardPath(); ctx.stroke();

  // Centre ice is the right-hand edge of a half sheet, so half the logo belongs
  // there — cut off at the boards, the way it looks on the real sheet. It used
  // to be drawn on a full sheet only, so choosing a logo on a half sheet did
  // nothing at all.
  if(centerLogo && LOGO_IMG[centerLogo] && LOGO_IMG[centerLogo].complete && LOGO_IMG[centerLogo].naturalWidth){
    const img=LOGO_IMG[centerLogo]; const ratio=img.naturalWidth/img.naturalHeight;
    let hh=22*s, ww=hh*ratio; const maxW=28*s; if(ww>maxW){ww=maxW; hh=ww/ratio;}
    const cx=X(RW/2), cy=Y(RH/2);
    ctx.save();
    ctx.beginPath(); boardPath(); ctx.clip();      // never bleed past the boards
    ctx.globalAlpha=0.95;
    // A crest painted on the ice does not turn when you walk to the other end.
    // clear() turns the whole canvas a quarter for the net-down views, so the
    // crest is turned back about its own centre and stays upright - the same
    // thing the player markers already do.
    if(camRot){ ctx.translate(cx,cy); ctx.rotate(Math.PI/2); ctx.translate(-cx,-cy); }
    ctx.drawImage(img, cx-ww/2, cy-hh/2, ww, hh);
    ctx.restore();
  }
}
function drawIceplexBg(p){
  const s=cam.s;
  const X=x=>(x+p.ox)*s+cam.tx, Y=y=>(y+p.oy)*s+cam.ty;
  const dark=document.body.classList.contains('dark-ice');

  const floor   = dark?'#1c1c24':'#d0ccc4';
  const iceCol  = dark?'#182838':'#ddeef8';
  const wallCol = dark?'#2c2c3a':'#7a7268';
  const lobbyCol= dark?'#20202c':'#c0b8ac';
  const tealCol = dark?'#0e3030':'#7ecece';
  const tealDark= dark?'#0a2424':'#52aaaa';
  const greenCol= dark?'#142a18':'#7ab87a';
  const entrCol = dark?'#1a2a3a':'#98b8cc';
  const floorAlt= dark?'#1a1a22':'#c0bab0';
  const ink     = dark?'rgba(220,235,255,0.92)':'rgba(12,12,32,0.92)';
  const inkFade = dark?'rgba(180,200,230,0.6)':'rgba(30,30,60,0.5)';
  const wall    = Math.max(2,1.4*s);
  const lw      = Math.max(1,0.45*s);
  const red='#cc2233', blue='#2244bb';

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
  function pillar(cx,cy){
    const r=Math.max(2,0.9*s);
    ctx.fillStyle=dark?'#555':'#888';
    ctx.fillRect(X(cx)-r,Y(cy)-r,r*2,r*2);
    ctx.strokeStyle=dark?'#777':'#555'; ctx.lineWidth=Math.max(0.5,0.25*s);
    ctx.strokeRect(X(cx)-r,Y(cy)-r,r*2,r*2);
  }
  function tileFloor(x,y,w,h,gap=10){
    ctx.strokeStyle=dark?'#2a2a35':'#b0a898'; ctx.lineWidth=Math.max(0.4,0.2*s);
    for(let ty=y;ty<y+h;ty+=gap){ ctx.beginPath(); ctx.moveTo(X(x),Y(ty)); ctx.lineTo(X(x+w),Y(ty)); ctx.stroke(); }
    for(let tx=x;tx<x+w;tx+=gap){ ctx.beginPath(); ctx.moveTo(X(tx),Y(y)); ctx.lineTo(X(tx),Y(y+h)); ctx.stroke(); }
  }

  // ── LAYOUT ─────────────────────────────────────────────────
  const xHops=0,  wHops=20;
  const xCorL=20, wCorL=22;
  const xSB=42,   wRink=92;
  const xGap=134, wGap=34;
  const xSS=168;
  const xLock=260,wLock=50;
  const xVM=310,  wVM=wRink;
  const xRwall=402,wRwall=12;
  const xPark=414, wPark=44;

  const yEntrance=-18, hEntrance=18;
  const yLobby=0,  hLobby=36;
  const yRink=36,  hRink=200;
  const yBot=236,  hBot=22;

  const yMPR=yEntrance, hMPR=hEntrance+hLobby+14;
  const yLockers=yMPR+hMPR, hLockers=yBot+hBot-yLockers;

  // ── Building floor ──────────────────────────────────────────
  fillBox(0,yLobby,xPark,IH-yLobby, floor);

  // ── Public park (grass lines) ───────────────────────────────
  fillBox(xPark,yLobby,wPark,IH-yLobby, greenCol);
  ctx.strokeStyle=dark?'#2a5a2a':'#5a9a5a'; ctx.lineWidth=Math.max(0.4,0.2*s);
  for(let gy=yLobby+6;gy<IH;gy+=6){ ctx.beginPath(); ctx.moveTo(X(xPark+1),Y(gy)); ctx.lineTo(X(xPark+wPark-1),Y(gy)); ctx.stroke(); }
  ctx.strokeStyle='#4a7a4a'; ctx.lineWidth=lw;
  ctx.strokeRect(X(xPark),Y(yLobby),wPark*s,(IH-yLobby)*s);
  rotTxt(xPark+wPark/2, yLobby+(IH-yLobby)/2,'PUBLIC PARK',2.4,true,dark?'#2a5a2a':'#1a4a1a');

  // ── Hockey Operations (sub-rooms) ───────────────────────────
  box(xHops,yLobby,wHops,IH-yLobby, wallCol,'#555',wall);
  const hopLabels=['STAFF OFFICE','EQUIPMENT RM','LOCKER RM','VIDEO RM','STORAGE'];
  const hopH=(IH-yLobby)/hopLabels.length;
  hopLabels.forEach((lbl,i)=>{
    const ry=yLobby+i*hopH;
    ctx.strokeStyle=dark?'#3a3a4a':'#666'; ctx.lineWidth=Math.max(0.5,0.3*s);
    ctx.strokeRect(X(xHops+1),Y(ry+1),(wHops-2)*s,(hopH-2)*s);
    rotTxt(xHops+wHops/2, ry+hopH/2, lbl, 1.3, false, inkFade);
  });

  // ── Left corridor (tile floor) ──────────────────────────────
  fillBox(xCorL,yRink,wCorL,hRink+hBot, floorAlt);
  tileFloor(xCorL,yRink,wCorL,hRink+hBot);
  ctx.strokeStyle='#666'; ctx.lineWidth=lw;
  ctx.strokeRect(X(xCorL),Y(yRink),wCorL*s,(hRink+hBot)*s);
  rotTxt(xCorL+wCorL/2, yRink+hRink*0.5,'CORRIDOR',1.7,false,inkFade);

  // ── SB↔SS floor gap (tile floor, dryland/seating) ──────────
  fillBox(xGap,yRink,wGap,hRink+hBot, floorAlt);
  tileFloor(xGap,yRink,wGap,hRink+hBot);
  ctx.strokeStyle='#666'; ctx.lineWidth=lw;
  ctx.strokeRect(X(xGap),Y(yRink),wGap*s,(hRink+hBot)*s);
  rotTxt(xGap+wGap/2, yRink+hRink*0.4,'FLOOR', 1.7, false, inkFade);
  rotTxt(xGap+wGap/2, yRink+hRink*0.6,'SPACE', 1.7, false, inkFade);

  // ── Bottom zamboni/skate corridor ───────────────────────────
  box(xCorL,yBot,xRwall-xCorL,hBot, lobbyCol,'#777');
  txt(xCorL+(xRwall-xCorL)/2, yBot+hBot/2, 'ZAMBONI CORRIDOR  /  SKATE EXIT', 1.5, false, inkFade);

  // ── East Public Entrance ────────────────────────────────────
  ctx.fillStyle=entrCol;
  ctx.strokeStyle='#5588aa'; ctx.lineWidth=Math.max(1.5,0.7*s);
  ctx.fillRect(X(xLock+wLock*0.3),Y(yEntrance),(xRwall-xLock-wLock*0.3)*s,hEntrance*s);
  ctx.strokeRect(X(xLock+wLock*0.3),Y(yEntrance),(xRwall-xLock-wLock*0.3)*s,hEntrance*s);
  // angled notch at top-right
  ctx.fillStyle=entrCol;
  ctx.beginPath();
  ctx.moveTo(X(xVM+wVM*0.55),Y(yEntrance));
  ctx.lineTo(X(xRwall),Y(yEntrance));
  ctx.lineTo(X(xRwall),Y(yEntrance-10));
  ctx.lineTo(X(xVM+wVM*0.72),Y(yEntrance-10));
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle='#5588aa'; ctx.lineWidth=Math.max(1.5,0.7*s); ctx.stroke();
  txt(xLock+wLock*0.3+(xRwall-xLock-wLock*0.3)/2, yEntrance+hEntrance*0.38,'EAST PUBLIC ENTRANCE',2.0,true,dark?'#aaccee':'#1a3a5a');
  // stairs box
  const stX=xVM+wVM*0.63;
  ctx.fillStyle=dark?'#243040':'#7a9ab8';
  ctx.fillRect(X(stX),Y(yEntrance+hEntrance*0.55),Math.max(12,6.5*s),Math.max(10,5.5*s));
  txt(stX+3.25, yEntrance+hEntrance*0.78,'▤ STAIRS',1.5,false,'#fff');
  marker(xVM+wVM*0.68, yLobby-4,'C','#1a5a9a');

  // ── MPR room + furniture ─────────────────────────────────────
  box(xLock,yMPR,wLock,hMPR, tealCol,'#2a8888',Math.max(1.5,0.7*s));
  txt(xLock+wLock/2, yMPR+hMPR*0.18,'MPR',2.6,true,dark?'#003838':'#002828');
  txt(xLock+wLock/2, yMPR+hMPR*0.30,'MULTI-PURPOSE ROOM',1.3,false,dark?'#003838':'#002828');
  // conference table + chairs
  const mCx=xLock+wLock/2, mCy=yMPR+hMPR*0.65;
  ctx.strokeStyle=tealDark; ctx.lineWidth=Math.max(0.5,0.3*s);
  ctx.strokeRect(X(mCx-9),Y(mCy-5),18*s,10*s);
  ctx.fillStyle=tealDark;
  [-6,-3,0,3,6].forEach(ox=>{
    ctx.fillRect(X(mCx+ox-1.3),Y(mCy-7.5),2.6*s,Math.max(1.5,1.5*s));
    ctx.fillRect(X(mCx+ox-1.3),Y(mCy+5.5),2.6*s,Math.max(1.5,1.5*s));
  });

  // ── Locker rooms 1-14 (2×7 grid) ────────────────────────────
  box(xLock,yLockers,wLock,hLockers, tealCol,'#2a8888',Math.max(1.5,0.7*s));
  const lcols=2, lrows=7;
  const cellW=wLock/lcols, cellH=hLockers/lrows;
  for(let r=0;r<lrows;r++) for(let c=0;c<lcols;c++){
    const n=r*lcols+c+1;
    const cx=xLock+c*cellW, cy=yLockers+r*cellH;
    ctx.strokeStyle=tealDark; ctx.lineWidth=Math.max(0.5,0.3*s);
    ctx.strokeRect(X(cx),Y(cy),cellW*s,cellH*s);
    // bench shelf along back wall
    ctx.strokeStyle=dark?'#0a6060':'#3a9a9a'; ctx.lineWidth=Math.max(0.4,0.22*s);
    ctx.beginPath(); ctx.moveTo(X(cx+2),Y(cy+cellH*0.55)); ctx.lineTo(X(cx+cellW-2),Y(cy+cellH*0.55)); ctx.stroke();
    txt(cx+cellW/2, cy+cellH*0.30, String(n), 2.0, true, dark?'#003838':'#002828');
  }
  rotTxt(xLock+wLock*0.78, yLockers+hLockers/2,'LOCKER ROOMS',1.9,true,dark?'#003838':'#002828');

  // ── Restrooms (in lobby, above SB rink) ──────────────────────
  const batX=xSB+wRink*0.06, batY=yLobby+2, batW=18, batH=hLobby-5;
  box(batX,batY,batW,batH, dark?'#1c2030':'#b0c8e0','#4488aa',Math.max(0.8,0.4*s));
  // toilet symbols
  [[batX+4,batY+batH*0.35],[batX+batW-4,batY+batH*0.35]].forEach(([tx,ty])=>{
    ctx.fillStyle=dark?'#3a5070':'#d0e8f8';
    ctx.beginPath(); ctx.ellipse(X(tx),Y(ty),Math.max(2.5,1.6*s),Math.max(3,1.8*s),0,0,7); ctx.fill();
    ctx.strokeStyle='#4488aa'; ctx.lineWidth=Math.max(0.5,0.3*s); ctx.stroke();
  });
  txt(batX+batW/2, batY+batH*0.7,'RESTROOMS',1.1,true,inkFade);
  // ADA symbol
  const adaX=batX+batW+2;
  box(adaX,batY,9,batH, dark?'#1c2030':'#b0c8e0','#4488aa',Math.max(0.8,0.4*s));
  txt(adaX+4.5,batY+batH/2,'♿',2.0,false,dark?'#5588cc':'#2255aa');

  // ── Top lobby / concessions ───────────────────────────────────
  box(xCorL,yLobby,xLock-xCorL,hLobby, lobbyCol,'#777');
  // concessions counter (above SS)
  const ccX=xSS+wRink*0.06, ccW=wRink*0.88;
  ctx.fillStyle=dark?'#282838':'#a09088';
  ctx.fillRect(X(ccX),Y(yLobby+hLobby-9),ccW*s,Math.max(5,3*s));
  for(let i=0;i<7;i++){
    const sx=ccX+ccW*(i+0.5)/7;
    ctx.beginPath(); ctx.arc(X(sx),Y(yLobby+hLobby-12),Math.max(1.8,0.8*s),0,7); ctx.fill();
  }

  marker(xGap+wGap/2, yLobby+6,'B','#1a5a9a');
  // Guest services dark banner
  const gsX=xSS-8, gsW=wRink+16;
  ctx.fillStyle='rgba(10,20,35,0.72)';
  ctx.fillRect(X(gsX),Y(yLobby+3),(gsW)*s,Math.max(10,6.5*s));
  ctx.fillStyle='#fff'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.font=`bold ${Math.max(5,1.8*s)}px Inter,sans-serif`;
  ctx.fillText('GUEST SERVICES · SKATE RENTALS · CONCESSIONS',X(gsX+gsW/2),Y(yLobby+3)+Math.max(10,6.5*s)/2);

  // VM lobby
  box(xVM,yLobby,wVM+wRwall,hLobby, lobbyCol,'#777');

  // ── Entrance markers ─────────────────────────────────────────
  marker(xCorL+wCorL/2, yLobby+6,'A','#1a5a9a');
  marker(xCorL+4, yBot+hBot/2,'D','#1a5a9a');

  // ── Structural pillars ───────────────────────────────────────
  [xSB,xSB+wRink,xSS,xSS+wRink,xVM,xVM+wVM].forEach(px=>{
    [yRink,yRink+hRink*0.25,yRink+hRink*0.5,yRink+hRink*0.75,yRink+hRink].forEach(py=>pillar(px,py));
  });
  // lobby/bottom pillars
  [xSB,xSB+wRink,xSS,xSS+wRink,xVM,xVM+wVM].forEach(px=>{
    pillar(px,yLobby); pillar(px,yBot+hBot);
  });

  // ── Outer building wall ──────────────────────────────────────
  ctx.strokeStyle='#222'; ctx.lineWidth=wall;
  ctx.strokeRect(X(0),Y(yLobby),xPark*s,(IH-yLobby)*s);

  // ── Ice rinks ─────────────────────────────────────────────────
  function drawRink(rx,ry,rw,rh,name1,name2,cap){
    const cr=Math.min(rw*0.52,rh*0.12)*s;
    const cy=ry+rh/2;
    const gLine1=ry+rh*0.107, gLine2=ry+rh*0.893;

    // bleachers on long sides (left and right boards)
    const blRows=4, blRowH=1.4, blW=5;
    for(let br=0;br<blRows;br++){
      const blAlpha=0.35+br*0.12;
      ctx.fillStyle=dark?`rgba(60,60,90,${blAlpha})`:`rgba(140,132,122,${blAlpha+0.15})`;
      const step=br*1.0;
      // top seating bank (behind top goal, upper 30%)
      ctx.fillRect(X(rx-blW+step),Y(ry+rh*0.06+br*blRowH),(blW-step)*s,Math.max(2,blRowH*0.8*s));
      ctx.fillRect(X(rx+rw-step),  Y(ry+rh*0.06+br*blRowH),(blW-step)*s,Math.max(2,blRowH*0.8*s));
      // bottom seating bank (behind bottom goal, lower 30%)
      ctx.fillRect(X(rx-blW+step),Y(ry+rh*0.70+br*blRowH),(blW-step)*s,Math.max(2,blRowH*0.8*s));
      ctx.fillRect(X(rx+rw-step),  Y(ry+rh*0.70+br*blRowH),(blW-step)*s,Math.max(2,blRowH*0.8*s));
    }

    // ice surface
    ctx.fillStyle=iceCol;
    ctx.beginPath();
    ctx.moveTo(X(rx)+cr,Y(ry));
    ctx.arcTo(X(rx+rw),Y(ry),X(rx+rw),Y(ry+rh),cr);
    ctx.arcTo(X(rx+rw),Y(ry+rh),X(rx),Y(ry+rh),cr);
    ctx.arcTo(X(rx),Y(ry+rh),X(rx),Y(ry),cr);
    ctx.arcTo(X(rx),Y(ry),X(rx+rw),Y(ry),cr);
    ctx.closePath(); ctx.fill();

    // boards
    ctx.strokeStyle=red; ctx.lineWidth=Math.max(2,0.8*s); ctx.stroke();

    // goal lines
    hline(rx+rw*0.08,rx+rw*0.92,gLine1,red,Math.max(1,0.4*s));
    hline(rx+rw*0.08,rx+rw*0.92,gLine2,red,Math.max(1,0.4*s));

    // trapezoid lines behind net
    const trapW=rw*0.22, trapOut=rw*0.30, trapD=rh*0.038;
    ctx.strokeStyle=red; ctx.lineWidth=Math.max(0.7,0.3*s);
    [0,1].forEach(end=>{
      const gl=end===0?gLine1:gLine2, dir=end===0?-1:1;
      ctx.beginPath();
      ctx.moveTo(X(rx+rw/2-trapW/2),Y(gl)); ctx.lineTo(X(rx+rw/2-trapOut/2),Y(gl+dir*trapD));
      ctx.moveTo(X(rx+rw/2+trapW/2),Y(gl)); ctx.lineTo(X(rx+rw/2+trapOut/2),Y(gl+dir*trapD));
      ctx.stroke();
    });

    // goal creases — same pattern as working landscape rink, rotated 90°:
    // top goal: CW 0→PI curves DOWN into rink; bottom: CW PI→0 curves UP into rink
    [gLine1,gLine2].forEach((gy,i)=>{
      ctx.fillStyle='rgba(120,180,235,0.18)';
      ctx.strokeStyle=red; ctx.lineWidth=Math.max(1,0.4*s);
      ctx.beginPath();
      if(i===0) ctx.arc(X(rx+rw/2),Y(gy),rw*0.1*s, 0,Math.PI, false);
      else       ctx.arc(X(rx+rw/2),Y(gy),rw*0.1*s, Math.PI,0, false);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    });

    // blue lines
    [ry+rh*0.295,ry+rh*0.705].forEach(by=>hline(rx+rw*0.06,rx+rw*0.94,by,blue,Math.max(1.2,0.5*s)));

    // center red line
    hline(rx+rw*0.06,rx+rw*0.94,cy,red,Math.max(1.5,0.6*s));

    // center circle + dot
    ctx.strokeStyle=blue; ctx.lineWidth=Math.max(1,0.45*s);
    ctx.beginPath(); ctx.arc(X(rx+rw/2),Y(cy),rw*0.19*s,0,7); ctx.stroke();
    ctx.fillStyle=red; ctx.beginPath(); ctx.arc(X(rx+rw/2),Y(cy),Math.max(2.5,1.0*s),0,7); ctx.fill();

    // end-zone faceoff circles + dots (smaller so they don't look like eyes)
    [ry+rh*0.175,ry+rh*0.825].forEach(fy=>{
      [rx+rw*0.27,rx+rw*0.73].forEach(fx=>{
        ctx.strokeStyle=red; ctx.lineWidth=Math.max(0.8,0.35*s);
        ctx.beginPath(); ctx.arc(X(fx),Y(fy),rw*0.095*s,0,7); ctx.stroke();
        ctx.fillStyle=red; ctx.beginPath(); ctx.arc(X(fx),Y(fy),Math.max(2,0.9*s),0,7); ctx.fill();
        // hash marks at 9 and 3 o'clock (outside the circle)
        const hr=rw*0.095, hLen=rw*0.04, hOff=rw*0.018;
        ctx.strokeStyle=red; ctx.lineWidth=Math.max(0.7,0.3*s);
        [-1,1].forEach(side=>{
          const bx=fx+side*(hr+hOff);
          ctx.beginPath();
          ctx.moveTo(X(bx),Y(fy-hLen)); ctx.lineTo(X(bx),Y(fy+hLen));
          ctx.moveTo(X(bx),Y(fy-hLen)); ctx.lineTo(X(bx-side*hOff),Y(fy-hLen));
          ctx.moveTo(X(bx),Y(fy+hLen)); ctx.lineTo(X(bx-side*hOff),Y(fy+hLen));
          ctx.stroke();
        });
      });
    });

    // neutral zone faceoff dots
    [ry+rh*0.295,ry+rh*0.705].forEach(fy=>{
      [rx+rw*0.27,rx+rw*0.73].forEach(fx=>{
        ctx.fillStyle=red; ctx.beginPath(); ctx.arc(X(fx),Y(fy),Math.max(2,0.9*s),0,7); ctx.fill();
      });
    });

    // player benches + penalty boxes (left = home blue, right = visitor red)
    const bThick=Math.max(3.5,2.0*s);
    const bStart=Y(cy-rh*0.16), bEnd=Y(cy+rh*0.16), bLen=bEnd-bStart;
    const penH=Math.max(3,1.6*s), penGap=Math.max(1,0.4*s);
    [[X(rx)-bThick,'#3a6ab8'],[X(rx+rw),'#a83030']].forEach(([bx,col])=>{
      // two penalty boxes above bench
      ctx.fillStyle='#5a4a8a';
      ctx.fillRect(bx,bStart-penH*2-penGap*2,bThick,penH);
      ctx.fillRect(bx,bStart-penH-penGap,bThick,penH);
      // player bench
      ctx.fillStyle=col; ctx.fillRect(bx,bStart,bThick,bLen);
      // dividers
      ctx.strokeStyle='rgba(255,255,255,0.5)'; ctx.lineWidth=Math.max(0.4,0.2*s);
      [-2,-1,0,1,2].forEach(d=>{ ctx.beginPath(); ctx.moveTo(bx,bStart+bLen*(d+2.5)/5); ctx.lineTo(bx+bThick,bStart+bLen*(d+2.5)/5); ctx.stroke(); });
    });

    // zamboni door (gap in bottom board)
    const zdW=rw*0.11;
    ctx.fillStyle=iceCol; ctx.fillRect(X(rx+rw/2-zdW/2),Y(ry+rh)-Math.max(1.5,0.7*s),zdW*s,Math.max(3,1.4*s));
    ctx.strokeStyle='#888'; ctx.lineWidth=Math.max(0.5,0.3*s); ctx.strokeRect(X(rx+rw/2-zdW/2),Y(ry+rh)-Math.max(1.5,0.7*s),zdW*s,Math.max(3,1.4*s));

    // rink name banner
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
  // With the stage turned, a jersey number would come out lying on its side.
  // Turn the piece back upright — except the ones whose shape means a
  // direction (a net, a bumper), which have to stay square to the ice.
  if(camRot && p.type!=='net' && p.type!=='bumper') ctx.rotate(Math.PI/2);
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
// Players are drawn deliberately larger than life. A real skater is about
// 2.5ft across, which next to a 30ft face-off circle leaves a dot too small to
// carry a jersey number. A board is read, not measured.
//
// Rescaled 2026-09-03. The old numbers were not one scale but several: players
// at 7.2ft across were near 3x life, nets at 6.8ft were life size, and cones at
// 3.6ft were more than 3x. Everything was oversized by a different amount, so
// nothing sat right next to anything else - a cone read as big as a puck stack
// and players crowded the face-off circles.
//
// One rule now: PEOPLE are magnified so a jersey number stays legible, and
// EQUIPMENT is close to life size, because the whole point of a cone or a net on
// a board is where it is and how much ice it takes up. Players came down 17%,
// which is enough to give the circles back without losing the number.
// ONE table. Every size in feet lives here and nowhere else.
//
// It used to be two: this lookup fed hit-testing and the selection ring, while
// drawPieceShape carried its own literals - a cone drawn at 1.7 but grabbed at
// 1.8, a puck drawn at 1.1 and grabbed at 1.2. They were never quite the same
// object, and changing a size in one place moved the picture without moving the
// target, or the target without moving the picture.
const PIECE_R = {
  // Measured off the DrillChange board Jay pointed at and said he liked: their
  // player sits about 2.2ft radius against a 30ft face-off circle. That is close
  // to life size and it is why their sheets read as a rink rather than as a
  // crowd of counters. A touch over it here, so a two-digit number still fits.
  player:2.3, goalie:2.5, coach:2.3,
  puck:0.8, puckstack:1.6, ball:1.2,   // a puck is 3in - these stay symbols
  net:3.0,                             // 6ft wide, life size
  cone:1.1, tire:1.5,                  // a cone is ~1ft, a tire ~2.5ft
  bumper:7, ring:2.0, dot:1.1, image:8, zone:10
};
const PLAYER_R=PIECE_R.player, GOALIE_R=PIECE_R.goalie;
function pieceBaseR(t){ return PIECE_R[t]||2; }
function pieceRadius(p){ return pieceBaseR(p.type)*(p.size||1); }   // in feet
function drawPieceShape(c, p, scale, thumb){
  const z=scale, size=p.size||1;
  const col=p.color||'#1E7FA0';
  c.save();
  if(p.rot) c.rotate(p.rot*Math.PI/180);
  switch(p.type){
    case 'player':{
      const r=PLAYER_R*z*size;
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
      const r=(GOALIE_R-0.2)*z*size;
      c.fillStyle=col; c.beginPath();
      c.moveTo(-r*1.15,r*0.2); c.lineTo(-r*1.15,r); c.lineTo(r*1.15,r); c.lineTo(r*1.15,r*0.2); c.closePath(); c.fill(); // pads
      c.beginPath(); c.arc(0,-r*0.1,r,0,7); c.fill();
      c.lineWidth=Math.max(1.5,r*0.12); c.strokeStyle='rgba(0,0,0,.35)'; c.stroke();
      label(c,'G',r,col,-r*0.1);
      break; }
    case 'coach':{
      const r=PLAYER_R*z*size; const cc=p.color||'#E7B416';
      c.fillStyle=cc; c.beginPath(); c.arc(0,0,r,0,7); c.fill();
      c.lineWidth=Math.max(1.5,r*0.12); c.strokeStyle='rgba(0,0,0,.4)'; c.stroke();
      label(c,'C',r,cc);
      break; }
    case 'puck':{
      const r=pieceBaseR("puck")*z*size; c.fillStyle=p.color||"#111"; c.beginPath(); c.ellipse(0,0,r,r*0.6,0,0,7); c.fill();
      c.strokeStyle='#444'; c.lineWidth=1; c.stroke(); break; }
    case "ball":{
      const r=pieceBaseR("ball")*z*size;
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
      const NR=pieceBaseR("net")*z*size, W=2*NR, D=NR*1.333, r=NR*0.4;
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
      const r=pieceBaseR("cone")*z*size; c.fillStyle=p.color||"#F2811D"; c.beginPath();
      c.moveTo(0,-r*1.3); c.lineTo(r,r); c.lineTo(-r,r); c.closePath(); c.fill();
      c.strokeStyle='#9c4f0a'; c.lineWidth=1; c.stroke(); break; }
    case 'tire':{
      const r=pieceBaseR("tire")*z*size; c.fillStyle="#222"; c.beginPath(); c.arc(0,0,r,0,7); c.fill();
      c.fillStyle=thumb?'#EAF6FB':'#E2F1F8'; c.beginPath(); c.arc(0,0,r*0.5,0,7); c.fill();
      c.strokeStyle=p.color||'#E7B416'; c.lineWidth=Math.max(1.5,r*0.18); c.beginPath(); c.arc(0,0,r*0.75,0,7); c.stroke(); break; }
    case 'bumper':{
      const L=pieceBaseR("bumper")*z*size, h=L*0.2; c.fillStyle=p.color||'#E7B416';
      roundRectShape(c,-L,-h,2*L,2*h,h*0.7); c.fill();
      c.strokeStyle='#8a6a00'; c.lineWidth=1; c.stroke(); break; }
    case 'dot':{
      const r=pieceBaseR("dot")*z*size; c.fillStyle=p.color||"#D11C2C"; c.beginPath(); c.arc(0,0,r,0,7); c.fill(); break; }
    case 'ring':{
      const r=pieceBaseR("ring")*z*size; c.strokeStyle=p.color||"#222831"; c.lineWidth=Math.max(2,r*0.28);
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
      // A label can run as a paragraph: typed line breaks are kept, and with a
      // wrap width (p.wrap, world units) long lines break onto the next line.
      // No wrap width = one line per typed line, as before.
      const maxW=(p.wrap>0)? p.wrap*z : Infinity;
      const lines=[];
      String(p.text||'').split('\n').forEach(par=>{
        let cur='';
        par.split(' ').forEach(wd=>{
          const t=cur? cur+' '+wd : wd;
          if(cur && c.measureText(t).width>maxW){ lines.push(cur); cur=wd; } else cur=t;
        });
        lines.push(cur);
      });
      const lh=fs*1.2, top=-(lines.length-1)*lh/2;
      let widest=0; lines.forEach(l=>{ widest=Math.max(widest,c.measureText(l).width); });
      p._wft=(widest/z); p._hft=(lines.length*lh/z);
      c.lineJoin='round'; c.lineWidth=Math.max(3,fs*0.2);
      // Same rule as the marks, and for the same reason. Asking isDark here put
      // a BLACK halo round orange text, which reads as black lettering with an
      // orange fill. Only a genuinely pale colour - gold, teal, white - needs a
      // dark halo; everything else takes a white one, which is invisible on the
      // ice and does its work on the dark boards.
      c.strokeStyle = needsRim(p.color) ? 'rgba(8,16,24,.9)' : 'rgba(255,255,255,.95)';
      c.fillStyle=p.color||'#11181f';
      lines.forEach((l,i)=>{ c.strokeText(l,0,top+i*lh); c.fillText(l,0,top+i*lh); });
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
  _wmul = p.w||1; _headW = _wmul;
  const scr=p.pts.map(q=>W2S(q.x,q.y));
  ctx.save(); ctx.lineJoin='round'; ctx.lineCap='round';
  // solid line
  ctx.strokeStyle=col; ctx.globalAlpha=_opa; ctx.lineWidth=Math.max(2,0.55*cam.s*_wmul); strokePoly(scr);
  arrowHead(scr,col); ctx.restore();
  // ghost piece at destination
  if(pc){ ctx.save(); ctx.globalAlpha=0.42; drawPieceGhost(pc,p.pts[p.pts.length-1]); ctx.restore(); }
  _wmul=1; _headW=1;
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

  const amp=Math.max(1.2,0.6*camScale*(1+(_wmul-1)*0.55)); // very small — tight S/C shapes
  const wl=amp*1.3;                     // width of each C (along path)

  ctx.save(); ctx.strokeStyle=col; ctx.globalAlpha=0.65*_opa; ctx.lineWidth=Math.max(1,0.32*camScale*_wmul);
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

  // Backwards skating: a chain of discrete C arcs that alternate sides and nest
  // into one another without ever touching. Each C is its own stroke — a
  // continuous wave (what this used to draw) reads as a squiggle, not as C's.
  // Centres sit ON the path and are closer together than a full diameter, so
  // consecutive C's interlock; because they bulge to opposite sides they can
  // overlap along the path without their strokes meeting.
  // A continuous tight coil: alternating arcs, each swinging past a half turn so
  // consecutive lobes overlap and the necks pinch into small loops. Drawn as one
  // unbroken stroke — discrete C's were tried first and read as separate marks
  // rather than as a single travelling line.
  // A coil, drawn the way a spring is: a helix seen edge-on. Each turn advances
  // `pitch` along the path while the pen also swings a circle of radius R. When
  // pitch < 2R the turns overlap and the necks pinch into the little loops that
  // make this read as backwards skating rather than as a plain wave.
  const T_=(typeof window!=='undefined'&&window.__bsTune)||null;
  // 6px floor keeps the loops legible when zoomed out; the stroke is capped at
  // R/3.5 so a heavy weight thickens the line without filling the loops in.
  // Retuned 2026-09-03 against a DrillChange board Jay called the best backwards
  // skating he had seen. Ours was right in kind and wrong in degree: at 1.3x the
  // scale with a pitch of 1.45R the turns overlapped so hard the mark filled in
  // and read as a black rope laid on the ice, not a skater. Smaller loops, and a
  // pitch of 2R so consecutive turns touch instead of piling up - each curl stays
  // a curl, which is the whole thing that says "backwards".
  // Retuned twice. The first attempt shrank the loops and kept the pitch tight,
  // which was the wrong lever: SIZE was never the problem, OVERLAP was. Turns
  // spaced under 2R pile on top of each other and the mark fills in solid, so it
  // reads as a black rope laid on the ice however small you make it.
  //
  // Pitch slightly OVER 2R leaves a hair of white between consecutive turns, and
  // that gap is the whole thing - it is what makes the eye see a coil rather than
  // a thick line. The stroke is capped at R/5 for the same reason: a fat pen
  // closes the gap back up.
  const R=T_?T_.R:Math.max(4.5, 1.2*camScale*(1+(_wmul-1)*0.18));
  const pitch=R*(T_?T_.pitchK:2.1);
  const lw=T_?T_.lw:Math.min(Math.max(0.9,0.22*camScale*_wmul), R/5);
  const PER=16;                                  // samples per turn

  ctx.save(); ctx.strokeStyle=col; ctx.globalAlpha=_opa;
  ctx.lineWidth=lw; ctx.lineJoin='round'; ctx.lineCap='round';
  ctx.beginPath();

  const turns=Math.max(1, Math.floor((total-2*R)/pitch));
  const N=turns*PER;
  for(let i=0;i<=N;i++){
    const phi=i/PER*Math.PI*2;
    const along=R + pitch*phi/(Math.PI*2) + R*Math.cos(phi);
    const s=Math.max(0, Math.min(total, along));
    const [px,py]=getAt(s);
    const [nx,ny]=normAt(s);
    const x=px+nx*R*Math.sin(phi), y=py+ny*R*Math.sin(phi);
    if(i) ctx.lineTo(x,y); else ctx.moveTo(x,y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawAnnotation(p){
  if(p.pts.length<2) return;
  _wmul = p.w||1;
  _opa  = (p.op==null?1:p.op);
  const scr=p.pts.map(pt=>W2S(pt.x,pt.y));
  const col=p.color||'#0C2233';
  // A light mark disappears on the ice — white on white is nothing, and gold
  // and lime are not much better. Lay the mark down first with a tight dark
  // shadow, which leaves an outline around every part of it: strokes, dashes,
  // arrowheads, the web fill. The white player circles have carried an outline
  // all along; the marks never did, so white was effectively unusable and a
  // white line's arrows had to be drawn black instead.
  if(needsRim(col)){
    const keepW=_wmul;
    // Every width in paintMark derives from _wmul, so fattening it and painting
    // dark underneath gives a real outline rather than a blurred glow. A soft
    // shadow alone spread the dark over ~7px and left nothing solid enough to
    // see. The blur here only softens the edge of that fatter pass.
    // Halved 2026-09-03. At the old weight (2.5-6px) the outline read as a black
    // line with a yellow core rather than a yellow line with an edge - Josh
    // spotted it on an exported DZ faceoff sheet. A rim is enough to hold the
    // colour against white ice; anything more competes with it.
    const grow=Math.min(3, Math.max(1.25, 0.275*cam.s));
    _wmul = keepW + grow/Math.max(0.4*cam.s, 0.5);
    // The head is a filled triangle, so scaling it with the stroke would put a
    // small white one inside a much bigger black one and the arrow would read
    // as black. It only needs a rim.
    //
    // Halved with the stroke on 2026-09-03. Thinning the line alone made the
    // heads look HEAVIER than before by comparison - the tip was the darkest
    // thing on the sheet and the eye went to it instead of to where the play
    // goes. The two have to move together.
    _headW = keepW + 1.1/Math.max(2.4*cam.s, 1);
    ctx.save();
    ctx.shadowColor='rgba(8,12,16,.55)'; ctx.shadowBlur=1.5;
    paintMark(p,scr,'#0B0F14');
    ctx.restore();
    _wmul = keepW;
  }
  _headW = _wmul;
  paintMark(p,scr,col);
  if(selContains('path',p.id)){
    ctx.save(); ctx.strokeStyle='#5BC2D6'; ctx.lineWidth=Math.max(2,0.55*cam.s*_wmul)+4; ctx.globalAlpha=.35;
    strokePoly(scr); ctx.restore();
  }
  _wmul=1; _headW=1; _opa=1; ctx.globalAlpha=1;
}
function paintMark(p,scr,col){
  ctx.globalAlpha=_opa;
  // Marks start fine and get heavier from the slider, rather than starting
  // heavy — a thick ring hides the player it is meant to point at.
  ctx.lineWidth=Math.max(1.2,0.4*cam.s*_wmul); ctx.strokeStyle=col; ctx.fillStyle=col;
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
    ctx.globalAlpha=_opa;
    const _n=smooth.length, _a=smooth[_n-2]||smooth[0], _b=smooth[_n-1];
    const _ang=Math.atan2(_b[1]-_a[1],_b[0]-_a[0]), _L=Math.max(8,2.4*cam.s*_wmul);
    const _tip=[_b[0]+_L*Math.cos(_ang), _b[1]+_L*Math.sin(_ang)];
    arrowHead([_a, _tip], col);
  }
  else if(p.type==='skaterev'){
    const anc=p.anchors&&p.anchors.length>=2?p.anchors:p.pts;
    const smooth=anc.length>=2?catmull(anc,48).map(q=>W2S(q.x,q.y)):scr;
    drawBackSkate(ctx, smooth, col, cam.s);
    ctx.globalAlpha=_opa;
    const _n=smooth.length, _a=smooth[_n-2]||smooth[0], _b=smooth[_n-1];
    const _ang=Math.atan2(_b[1]-_a[1],_b[0]-_a[0]), _L=Math.max(8,2.4*cam.s*_wmul);
    const _tip=[_b[0]+_L*Math.cos(_ang), _b[1]+_L*Math.sin(_ang)];
    arrowHead([_a, _tip], col);
  }
  else if(p.type==='pass'){
    // round dots, not dashes: a zero-length dash with a round cap paints a dot.
    // Spacing tracks the stroke weight so fat lines don't close up into a solid.
    const dw=Math.max(2,0.55*cam.s*_wmul);
    ctx.lineCap='round'; ctx.setLineDash([0, dw*2.2]);
    strokePoly(scr);
    ctx.setLineDash([]);
    arrowHead(scr,col);            // solid head
  }
  else if(p.type==='shot'){ shotDouble(scr,col); }
  else if(p.type==='arrow'){ strokePoly(scr); arrowHead(scr,col); }
  else if(p.type==='web'){ drawWeb(scr,col,p.area); }
  else if(p.type==='bar'){ strokePoly(scr); }               // plain segment, no head
  else if(p.type==='ring'){
    // Always draw the ellipse that BOUNDS the points, never the points
    // themselves. Mid-drag those points are the raw mouse trail, so this shows
    // the real ring live as you size it instead of a squiggle; once finished
    // the points already are the ellipse, so it renders identically.
    let ax=Infinity,ay=Infinity,bx=-Infinity,by=-Infinity;
    for(let i=0;i<scr.length;i++){ ax=Math.min(ax,scr[i][0]); ay=Math.min(ay,scr[i][1]);
      bx=Math.max(bx,scr[i][0]); by=Math.max(by,scr[i][1]); }
    ctx.beginPath();
    ctx.ellipse((ax+bx)/2,(ay+by)/2,Math.max(1,(bx-ax)/2),Math.max(1,(by-ay)/2),0,0,Math.PI*2);
    ctx.stroke();
  }
  else if(p.type==='link'){
    // A plain hairline, rim to rim. No arrowhead and no dashes: the pairing is
    // the whole message, and any decoration on it starts to read as a pass.
    ctx.save();
    ctx.lineWidth=Math.max(1,0.22*cam.s*_wmul);
    strokePoly(scr);
    ctx.restore();
  }
  else if(p.type==='pen'){ strokePoly(scr); }
}
// ---- ring geometry -------------------------------------------------------
// A ring stores its outline as points so that hit-testing, selection and
// recolouring work like any other annotation. An axis-aligned ellipse is fully
// described by its bounding box, so the centre and radii round-trip losslessly.
function ringGeom(p){
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  p.pts.forEach(q=>{ x0=Math.min(x0,q.x); y0=Math.min(y0,q.y); x1=Math.max(x1,q.x); y1=Math.max(y1,q.y); });
  return {cx:(x0+x1)/2, cy:(y0+y1)/2, rx:Math.max(0.4,(x1-x0)/2), ry:Math.max(0.3,(y1-y0)/2)};
}
function setRing(p,cx,cy,rx,ry){
  rx=Math.max(0.8,rx); ry=Math.max(0.5,ry);
  const out=[]; for(let i=0;i<=48;i++){ const a=i/48*Math.PI*2;
    out.push({x:cx+rx*Math.cos(a), y:cy+ry*Math.sin(a)}); }
  p.pts=out; p._lut=null;
}
// One resize handle, at the top-right corner of the ring's box. Everything
// else about the ring — rim included — moves it. Resizing off the rim itself
// meant a click meant to reposition the ring resized it instead.
function ringHandle(p){
  const g=ringGeom(p);
  const [sx,sy]=W2S(g.cx+g.rx, g.cy-g.ry);
  return {sx,sy,g};
}
function ringGrabAt(p,wx,wy,sx,sy){
  const h=ringHandle(p);
  if(Math.hypot(sx-h.sx, sy-h.sy)<15) return 'xy';   // the handle
  const g=h.g;
  const nx=(wx-g.cx)/g.rx, ny=(wy-g.cy)/g.ry, d=Math.hypot(nx,ny);
  // inside, plus a band just outside so grabbing the stroke itself counts
  const px=Math.max(6, Math.min(g.rx,g.ry)*cam.s);
  const band=Math.max(0.12, Math.min(0.8, 10/px));
  if(d<=1+band) return 'move';
  return null;
}
function selectedRing(){
  if(selSet.length!==1 || selSet[0].kind!=='path') return null;
  const p=getPath(selSet[0].id);
  return (p && p.type==='ring') ? p : null;
}

// ---- cover links ---------------------------------------------------------
// "Who has who": two rings joined by a dashed arrow. The link stores the two
// ring ids rather than a pair of points, so moving or resizing either ring
// carries the connector with it instead of leaving it behind.
var coverFrom=null;    // id of the first ring of a pair being built
function ringById(pid){ const p=getPath(pid); return (p && p.type==='ring') ? p : null; }
function linkEnds(p){
  const a=ringById(p.a), b=ringById(p.b);
  if(!a||!b) return null;
  const ga=ringGeom(a), gb=ringGeom(b);
  const dx=gb.cx-ga.cx, dy=gb.cy-ga.cy, d=Math.hypot(dx,dy);
  if(d<0.01) return null;
  const ux=dx/d, uy=dy/d;
  // where the centre line crosses each rim: on an axis-aligned ellipse the
  // ray c + t·u leaves the outline at t = 1 / hypot(ux/rx, uy/ry)
  const ta=1/Math.hypot(ux/ga.rx, uy/ga.ry);
  const tb=1/Math.hypot(ux/gb.rx, uy/gb.ry);
  if(ta+tb >= d-0.4) return null;   // rings touch or overlap: nothing to draw
  return [{x:ga.cx+ux*ta, y:ga.cy+uy*ta}, {x:gb.cx-ux*tb, y:gb.cy-uy*tb}];
}
// Keep every link's endpoints current and drop any whose ring has gone. Run
// once per frame, before anything is drawn, so hit-testing and drawing both
// see the same geometry.
function syncLinks(){
  let orphan=false;
  paths.forEach(p=>{
    if(p.type!=='link') return;
    const e=linkEnds(p);
    if(e) p.pts=e;
    else if(!ringById(p.a)||!ringById(p.b)) orphan=true;
  });
  if(orphan) paths=paths.filter(p=>p.type!=='link' || (ringById(p.a)&&ringById(p.b)));
}
function cancelCover(){
  if(coverFrom==null) return;
  coverFrom=null;
  updateHint(); render();
}
// Called with each ring the Cover tool finishes or picks up. The first one
// is held; the second closes the pair and the link appears between them.
function coverPick(ring){
  if(coverFrom==null){
    coverFrom=ring.id;
    selOne('path',ring.id); updateInspector(); updateHint(); render();
    toast('Now circle who they cover');
    return;
  }
  const from=coverFrom; coverFrom=null;
  const a=ringById(from);
  if(!a || from===ring.id){ updateHint(); render(); return; }
  const dupe=paths.some(p=>p.type==='link' &&
    ((p.a===from&&p.b===ring.id)||(p.a===ring.id&&p.b===from)));
  if(!dupe){
    paths.push({ id:id(), type:'link', a:from, b:ring.id,
      color:(activeColor||'#0C2233'), pts:[], owner:null,
      // the connector rides on its rings' timing; these only keep the
      // timeline bar honest
      delay:a.delay||0, dur:a.dur, w:markW, op:markOp, freeze:false, _lut:null });
  }
  selOne('path',ring.id); updateInspector(); updateHint(); render();
  toast('Linked — circle another pair, or switch tools');
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
  const ang=Math.atan2(b[1]-a[1],b[0]-a[0]); const L=Math.max(8,2.4*cam.s*_headW);
  ctx.fillStyle=col; ctx.strokeStyle=col;
  if(open){ ctx.lineWidth=Math.max(2,0.55*cam.s*_wmul);
    ctx.beginPath(); ctx.moveTo(b[0]-L*Math.cos(ang-0.4),b[1]-L*Math.sin(ang-0.4)); ctx.lineTo(b[0],b[1]);
    ctx.lineTo(b[0]-L*Math.cos(ang+0.4),b[1]-L*Math.sin(ang+0.4)); ctx.stroke(); return; }
  ctx.beginPath(); ctx.moveTo(b[0],b[1]);
  ctx.lineTo(b[0]-L*Math.cos(ang-0.42),b[1]-L*Math.sin(ang-0.42));
  ctx.lineTo(b[0]-L*Math.cos(ang+0.42),b[1]-L*Math.sin(ang+0.42)); ctx.closePath(); ctx.fill();
}
// ---- coverage web ---------------------------------------------------------
// Every node joined to every other with hairlines, over a faint fill of the
// area they enclose. The mesh density IS the reading: a tight cluster goes
// dark and busy (players bunched), a spread one goes sparse (space available).
function convexHull(pts){
  if(pts.length<3) return pts.slice();
  const p=pts.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
  const lo=[]; for(const q of p){ while(lo.length>=2&&cross(lo[lo.length-2],lo[lo.length-1],q)<=0) lo.pop(); lo.push(q); }
  const hi=[]; for(let i=p.length-1;i>=0;i--){ const q=p[i];
    while(hi.length>=2&&cross(hi[hi.length-2],hi[hi.length-1],q)<=0) hi.pop(); hi.push(q); }
  lo.pop(); hi.pop(); return lo.concat(hi);
}
// `area` draws the SHAPE only: the outline round the outside and the fill,
// with none of the mesh inside it. On footage that is what a coach means by
// circling a zone — the interior hairlines are a drill-board reading, and over
// players they are just scribble.
function drawWeb(scr,col,area){
  const n=scr.length; if(n<2) return;
  // deliberately much thinner than the other marks — this is a blanket, not a line
  const lw=Math.max(0.6, 0.16*cam.s*_wmul);
  ctx.save();
  ctx.lineJoin='round'; ctx.lineCap='round';

  // faint fill of the enclosed area
  if(n>=3){
    const h=convexHull(scr);
    if(h.length>=3){
      ctx.beginPath(); ctx.moveTo(h[0][0],h[0][1]);
      for(let i=1;i<h.length;i++) ctx.lineTo(h[i][0],h[i][1]);
      ctx.closePath();
      ctx.globalAlpha=0.10*_opa; ctx.fillStyle=col; ctx.fill();
    }
  }

  if(area){
    // just the boundary, drawn fatter than the mesh hairline so it reads as a
    // ring round the area rather than a web
    const path=(n>=3)?convexHull(scr):scr;
    const ow=Math.max(1.4, 0.5*cam.s*_wmul);
    ctx.beginPath(); ctx.moveTo(path[0][0],path[0][1]);
    for(let i=1;i<path.length;i++) ctx.lineTo(path[i][0],path[i][1]);
    if(path.length>=3) ctx.closePath();
    ctx.globalAlpha=0.35*_opa; ctx.strokeStyle='rgba(0,0,0,1)'; ctx.lineWidth=ow+1.4; ctx.stroke();
    ctx.globalAlpha=_opa; ctx.strokeStyle=col; ctx.lineWidth=ow; ctx.stroke();
    ctx.restore();
    return;
  }

  // every pair joined. A dark halo under the hairline keeps it readable on
  // white ice and on the dark boards alike.
  ctx.globalAlpha=0.30*_opa; ctx.strokeStyle='rgba(0,0,0,1)'; ctx.lineWidth=lw+1.1;
  for(let i=0;i<n;i++) for(let j=i+1;j<n;j++){
    ctx.beginPath(); ctx.moveTo(scr[i][0],scr[i][1]); ctx.lineTo(scr[j][0],scr[j][1]); ctx.stroke();
  }
  ctx.globalAlpha=0.9*_opa; ctx.strokeStyle=col; ctx.lineWidth=lw;
  for(let i=0;i<n;i++) for(let j=i+1;j<n;j++){
    ctx.beginPath(); ctx.moveTo(scr[i][0],scr[i][1]); ctx.lineTo(scr[j][0],scr[j][1]); ctx.stroke();
  }

  // nodes
  const nr=Math.max(1.6, lw*1.9);
  ctx.globalAlpha=_opa; ctx.fillStyle=col;
  for(let i=0;i<n;i++){ ctx.beginPath(); ctx.arc(scr[i][0],scr[i][1],nr,0,7); ctx.fill(); }
  ctx.restore();
}

function shotDouble(scr,col){
  const n=scr.length;
  const a=scr[n-2]||scr[0], b=scr[n-1];
  const ang=Math.atan2(b[1]-a[1],b[0]-a[0]);
  const k=(0.5+0.5*(_wmul||1));             // mark weight: the shot followed none of it
  const L=Math.max(6,2.8*cam.s*k);          // triangle size
  const spread=Math.max(2,0.85*cam.s*k);    // half-gap between the two lines
  const lw=Math.max(0.6,0.4*cam.s*(_wmul||1));
  const lineGap=Math.max(3,1.4*cam.s*k);    // gap between line end and triangle base

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

  // disconnected triangle tip — outlined, not filled
  const tipX=b[0], tipY=b[1];
  const baseX=tipX-L*Math.cos(ang), baseY=tipY-L*Math.sin(ang);
  ctx.strokeStyle=col; ctx.lineWidth=lw;
  ctx.lineJoin='round'; ctx.lineCap='round';
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(baseX+nx*L*0.42, baseY+ny*L*0.42);
  ctx.lineTo(baseX-nx*L*0.42, baseY-ny*L*0.42);
  ctx.closePath(); ctx.stroke();
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
  syncLinks();
  panels().forEach(p=>p.kind==='field'?drawFieldBg(p):p.kind==='iceplex'?drawIceplexBg(p):drawRinkBg(p));
  // zones under everything
  pieces.filter(p=>p.type==='zone').forEach(p=>drawPiece(p,null));
  // paths under pieces — each mark only shows inside its own time window
  paths.forEach(p=>{ if(markVisible(p)) drawPath(p); });
  // The mark being dragged out right now. It has to be drawn from inside
  // render(), not from the pointermove handler: render() runs on every
  // animation frame whether or not anything is playing, so a preview painted
  // after render() was wiped by the very next frame. The mark only appeared
  // when the mouse came up and it joined paths[].
  if(drawing && drawing.pts && drawing.pts.length>=2) drawPath(drawing);
  // pieces (animated positions if mid-play or scrubbed)
  const showAnim = playing || tNow>0;
  const map = showAnim? animatedPositions() : {};
  pieces.forEach(p=>{ if(p.type==='puck'||p.type==='ball'&&p.legs&&p.legs.length) drawPuckJourney(p); });
  // A piece carrying a delay is a timed mark — a label written on footage —
  // and obeys the same window as the shapes. Everything else on a board has no
  // timing and is always there.
  pieces.filter(p=>p.type!=='zone').forEach(p=>{
    if(p.delay!=null && !markVisible(p)) return;
    drawPiece(p, map[p.id]);
  });
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
  // A selected ring: dashed box showing its extent, one grab handle at the
  // top-right corner for size. Drag the ring itself to move it.
  // Only while the ring itself is on screen. The box and handle were drawn
  // straight off the selection, so a hidden freeze mark still left its chrome
  // sitting on the ice for the rest of the clip — which read as the ring
  // lingering long after it had actually stopped being drawn.
  // The first ring of a cover pair, waiting for its partner.
  if(coverFrom!=null){
    const cf=ringById(coverFrom);
    if(cf && markVisible(cf)){
      const g=ringGeom(cf), c=W2S(g.cx,g.cy);
      ctx.save();
      ctx.strokeStyle='#B9E60C'; ctx.globalAlpha=.85; ctx.lineWidth=2.5; ctx.setLineDash([7,5]);
      ctx.beginPath(); ctx.ellipse(c[0],c[1],g.rx*cam.s+6,g.ry*cam.s+6,0,0,Math.PI*2); ctx.stroke();
      ctx.restore();
    }
  }
  const ringSel=selectedRing();
  if(ringSel && markVisible(ringSel)){
    const g=ringGeom(ringSel), c=W2S(g.cx,g.cy);
    const rxp=g.rx*cam.s, ryp=g.ry*cam.s;
    ctx.save();
    ctx.strokeStyle='#5BC2D6'; ctx.globalAlpha=.5; ctx.lineWidth=1.2; ctx.setLineDash([5,4]);
    ctx.strokeRect(c[0]-rxp, c[1]-ryp, rxp*2, ryp*2);
    ctx.setLineDash([]);
    const h=W2S(g.cx+g.rx, g.cy-g.ry);
    ctx.globalAlpha=1; ctx.fillStyle='#5BC2D6'; ctx.strokeStyle='#fff'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.arc(h[0],h[1],7,0,7); ctx.fill(); ctx.stroke();
    // little diagonal inside the dot so it reads as "drag to size"
    ctx.strokeStyle='#04141c'; ctx.lineWidth=1.4;
    ctx.beginPath(); ctx.moveTo(h[0]-3,h[1]+3); ctx.lineTo(h[0]+3,h[1]-3); ctx.stroke();
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
  // live preview of the web: show what joining this next node would add
  if(webBuilding && webCursor){
    const pts=webBuilding.path.pts;
    const c=W2S(webCursor.x,webCursor.y);
    ctx.save(); ctx.strokeStyle=webBuilding.path.color||'#E8313A'; ctx.globalAlpha=0.4;
    ctx.lineWidth=Math.max(0.6,0.16*cam.s*(webBuilding.path.w||1));
    pts.forEach(q=>{ const a=W2S(q.x,q.y);
      ctx.beginPath(); ctx.moveTo(a[0],a[1]); ctx.lineTo(c[0],c[1]); ctx.stroke(); });
    ctx.restore();
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
let ringDrag=null;     // {path, mode:'e'|'w'|'n'|'s'|'move'} — reshaping a ring
var drawing=null;    // current annotation being drawn
let panStart=null;
let building=null;   // motion route being built (multi-segment)
let seg=null;        // current segment gesture within a build

cv.addEventListener('pointerdown',e=>{
  try{ cv.setPointerCapture(e.pointerId); }catch(err){}  // capture is a nicety; never abort the handler over it
  const mxy=drawnXY(e.offsetX,e.offsetY);
  const [wx,wy]=S2W(mxy[0],mxy[1]);
  if(playing){ playing=false; setPlayUI(); }
  // mid/right button = pan regardless of tool
  if(e.button===1||e.button===2||tool==='pan'){ pendingType=null; pendingOpts=null; pendingStamp=false; cv.style.cursor=''; panStart={x:mxy[0],y:mxy[1],tx:cam.tx,ty:cam.ty}; return; }

  // rotation handle hit-test
  const rotPcDown = selSet.length===1 && selSet[0].kind==='piece' ? getPiece(selSet[0].id) : null;
  if(rotPcDown && (rotPcDown.type==='net'||rotPcDown.type==='bumper')){
    const [sx,sy]=W2S(rotPcDown.x,rotPcDown.y);
    const armLen=38, rad2=(rotPcDown.rot||0)*Math.PI/180, hx=sx+Math.sin(rad2)*armLen, hy=sy-Math.cos(rad2)*armLen;
    if(Math.hypot(mxy[0]-hx,mxy[1]-hy)<12){ pushUndo(); rotDrag={piece:rotPcDown}; return; }
  }
  if(rotPcDown && rotPcDown.type==='zone'){
    const [sx,sy]=W2S(rotPcDown.x,rotPcDown.y);
    const zr=10*cam.s*(rotPcDown.size||1), hx=sx, hy=sy-zr;
    if(Math.hypot(mxy[0]-hx,mxy[1]-hy)<12){ pushUndo(); zoneSizeDrag={piece:rotPcDown}; return; }
  }
  // Ring: grab an edge handle to resize, or the body to move it.
  // Select tool only — otherwise the ring you just drew swallows the next
  // drag and you can't draw a second one near it without switching tools.
  const ringDown = (tool==='select') ? selectedRing() : null;
  if(ringDown){
    const g=ringGeom(ringDown);
    const m=ringGrabAt(ringDown,wx,wy,mxy[0],mxy[1]);
    if(m){ pushUndo();
      ringDrag = m==='move' ? {path:ringDown, mode:'move', ox:wx-g.cx, oy:wy-g.cy}
                            : {path:ringDown, mode:m};
      return; }
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
    if(pa){
      if(addKey) selToggle('path',pa.id);
      else {
        selOne('path',pa.id);
        // grab-and-go: clicking a ring picks it up in the same gesture rather
        // than making you click once to select and again to drag
        if(pa.type==='ring'){ const rg=ringGeom(pa); pushUndo();
          ringDrag={path:pa, mode:'move', ox:wx-rg.cx, oy:wy-rg.cy}; }
      }
      updateInspector(); render(); return; }
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
      const np={id:id(),type:'skate',color:(activeColor||'#0C2233'),pts:[{x:wx,y:wy}],anchors:[{x:wx,y:wy}],owner:null,delay:markStart(),dur:markSpan(),w:markW,op:markOp,freeze:markFreeze,_lut:null};
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
      const np={id:id(),type:'skateback',color:(activeColor||'#0C2233'),pts:[{x:wx,y:wy}],anchors:[{x:wx,y:wy}],owner:null,delay:markStart(),dur:markSpan(),w:markW,op:markOp,freeze:markFreeze,_lut:null};
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
      const np={id:id(),type:'skaterev',color:(activeColor||'#0C2233'),pts:[{x:wx,y:wy}],anchors:[{x:wx,y:wy}],owner:null,delay:markStart(),dur:markSpan(),w:markW,op:markOp,freeze:markFreeze,_lut:null};
      paths.push(np); skateRevBuilding={path:np}; selOne('path',np.id);
      toast('Click waypoints for backwards skating — right-click to finish');
    } else {
      skateRevBuilding.path.anchors.push({x:wx,y:wy});
      skateRevBuilding.path.pts=catmull(skateRevBuilding.path.anchors,16);
    }
    skateRevCursor={x:wx,y:wy}; updateInspector(); render(); return;
  }
  if(tool==='web'){
    if(!webBuilding){
      pushUndo();
      // On footage a web means "this area", so it is drawn as a ring with no
      // mesh inside. On a drill board the mesh is the reading, so it stays.
      const np={id:id(),type:'web',color:(activeColor||'#E8313A'),pts:[{x:wx,y:wy}],owner:null,delay:markStart(),dur:markSpan(),w:markW,op:markOp,freeze:markFreeze,area:(rinkConfig==='video'),_lut:null};
      paths.push(np); webBuilding={path:np}; selOne('path',np.id);
      toast('Click each player or corner — double-click or Enter to close the web');
    } else {
      webBuilding.path.pts.push({x:wx,y:wy});
    }
    webCursor={x:wx,y:wy}; updateInspector(); render(); return;
  }
  if(tool==='pass'){
    if(!passBuilding){
      pushUndo();
      const np={id:id(),type:'pass',color:(activeColor||'#0C2233'),pts:[{x:wx,y:wy}],owner:null,delay:markStart(),dur:markSpan(),w:markW,op:markOp,freeze:markFreeze,_lut:null};
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
      const np={id:id(),type:'shot',color:(activeColor||'#0C2233'),pts:[{x:wx,y:wy}],owner:null,delay:markStart(),dur:markSpan(),w:markW,op:markOp,freeze:markFreeze,_lut:null};
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
      // On footage a label is a teaching point like any other mark, so it is
      // stamped with the same timing and comes and goes with the shapes it was
      // written for. On a drill board a label is furniture and stays put.
      if(rinkConfig==='video'){ p.delay=markStart(); p.dur=markSpan(); p.freeze=markFreeze; }
      pieces.push(p); selOne('piece',p.id); updateInspector(); render(); }
    return;
  }
  // a drawing tool
  pushUndo();
  // Cover draws ordinary rings and pairs them up as each one is finished.
  // Pressing on a ring that is already there picks that one up as an endpoint
  // instead of drawing a new one, so marks made earlier can still be joined.
  if(tool==='cover'){
    const hit=paths.find(p=>p.type==='ring' && markVisible(p) && ringGrabAt(p,wx,wy,mxy[0],mxy[1])==='move');
    if(hit){ coverPick(hit); return; }
  }
  drawing={ id:id(), type:(tool==='cover'?'ring':tool), color:(activeColor||'#0C2233'), pts:[{x:wx,y:wy}], owner:null, delay:markStart(), dur:markSpan(), w:markW, op:markOp, freeze:markFreeze, _lut:null };
  if(tool==='cover') drawing._cover=true;
});
cv.addEventListener('pointermove',e=>{
  const mxy=drawnXY(e.offsetX,e.offsetY);
  const [wx,wy]=S2W(mxy[0],mxy[1]);
  if(zoneSizeDrag){ const p=zoneSizeDrag.piece; const [sx,sy]=W2S(p.x,p.y);
    const dist=Math.hypot(mxy[0]-sx,mxy[1]-sy);
    p.size=Math.max(0.2, dist/(10*cam.s)); updateInspector(); render(); return; }
  // cursor hint over a selected ring's handles
  if(!ringDrag && !drag && !drawing && !pendingType && tool==='select'){
    const rs=selectedRing();
    if(rs){
      const m=ringGrabAt(rs,wx,wy,mxy[0],mxy[1]);
      cv.style.cursor = m==='xy'?'nesw-resize' : m==='move'?'move' : '';
    }
  }
  if(ringDrag){ const p=ringDrag.path, g=ringGeom(p);
    if(ringDrag.mode==='move')    setRing(p, wx-ringDrag.ox, wy-ringDrag.oy, g.rx, g.ry);
    else if(ringDrag.mode==='x')  setRing(p, g.cx, g.cy, Math.abs(wx-g.cx), g.ry);
    else if(ringDrag.mode==='y')  setRing(p, g.cx, g.cy, g.rx, Math.abs(wy-g.cy));
    else                          setRing(p, g.cx, g.cy, Math.abs(wx-g.cx), Math.abs(wy-g.cy));
    render(); return; }
  if(rotDrag){ const p=rotDrag.piece; const [sx,sy]=W2S(p.x,p.y);
    p.rot=Math.atan2(mxy[0]-sx,sy-mxy[1])*180/Math.PI; render(); return; }
  if(skateBuilding){ skateCursor={x:wx,y:wy}; render(); return; }
  if(skateBackBuilding){ skateBackCursor={x:wx,y:wy}; render(); return; }
  if(skateRevBuilding){ skateRevCursor={x:wx,y:wy}; render(); return; }
  if(passBuilding){ passCursor={x:wx,y:wy}; render(); return; }
  if(webBuilding){ webCursor={x:wx,y:wy}; render(); return; }
  if(shotBuilding){ shotCursor={x:wx,y:wy}; render(); return; }
  if(panStart){ cam.tx=panStart.tx+(mxy[0]-panStart.x); cam.ty=panStart.ty+(mxy[1]-panStart.y); camMoved=true; render(); return; }
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
  if(drawing){
    // A ring is sized by its box, so it only ever needs the press point and
    // the cursor. Keeping the whole mouse trail meant the box could grow but
    // never shrink — pull back in and the ring stayed as wide as the widest
    // point of the drag.
    if(drawing.type==='ring'){ drawing.pts=[drawing.pts[0],{x:wx,y:wy}]; render(); return; }
    const last=drawing.pts[drawing.pts.length-1];
    if(Math.hypot(wx-last.x,wy-last.y) > (drawing.type==='pen'?0.6:1.4)) drawing.pts.push({x:wx,y:wy});
    render(); }
});
cv.addEventListener('pointerup',e=>{
  if(panStart){ panStart=null; return; }
  if(zoneSizeDrag){ zoneSizeDrag=null; render(); return; }
  if(ringDrag){ ringDrag=null; updateInspector(); render(); return; }
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
    if(drawing.type==='ring' && drawing.pts.length>=2){
      // the drag defines a bounding box; store the ellipse outline itself so
      // rendering, hit-testing, selection and dragging all work unchanged.
      // A wide, short box gives the flattened ring that matches ice perspective.
      let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
      drawing.pts.forEach(q=>{ x0=Math.min(x0,q.x); y0=Math.min(y0,q.y); x1=Math.max(x1,q.x); y1=Math.max(y1,q.y); });
      const cx=(x0+x1)/2, cy=(y0+y1)/2;
      const rx=Math.max(1.2,(x1-x0)/2), ry=Math.max(0.6,(y1-y0)/2);
      const out=[]; for(let i=0;i<=48;i++){ const a=i/48*Math.PI*2;
        out.push({x:cx+rx*Math.cos(a), y:cy+ry*Math.sin(a)}); }
      drawing.pts=out;
    }
    if(drawing.pts.length>=2){
      if(drawing.type!=='pen' && drawing.type!=='skate' && drawing.type!=='ring'){
        const s=drawing.pts[0], en=drawing.pts[drawing.pts.length-1];
        let maxd=0; drawing.pts.forEach(pt=>{maxd=Math.max(maxd,distToSeg(pt.x,pt.y,s,en));});
        if(maxd<3) drawing.pts=[s,en];
      }
      drawing.owner=null;            // annotation lines never animate
      paths.push(drawing); selOne('path',drawing.id); updateInspector();
      if(drawing._cover){ const nr=drawing; drawing=null; coverPick(nr); return; }
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
  if(webBuilding){
    const pts=webBuilding.path.pts;
    if(pts.length>1) pts.pop();          // drop the duplicate the dbl-click added
    if(pts.length<2) paths=paths.filter(p=>p!==webBuilding.path);
    webBuilding=null; webCursor=null; selOne(null); updateInspector(); render(); return;
  }
  if(shotBuilding){
    const pts=shotBuilding.path.pts;
    if(pts.length>1) pts.pop();
    shotBuilding=null; shotCursor=null; selOne(null); updateInspector(); render(); return;
  }
  const mxy=drawnXY(e.offsetX,e.offsetY);
  const [wx,wy]=S2W(mxy[0],mxy[1]); const pc=pieceAt(wx,wy);
  if(pc && pc.type==='text'){ const s=window.prompt('Edit text:', pc.text||''); if(s!==null){ pushUndo(); pc.text=s.trim(); render(); } }
});
cv.addEventListener('contextmenu',e=>{
  e.preventDefault();
  if(pendingType){ pendingType=null; pendingOpts=null; pendingStamp=false; cv.style.cursor=''; updateHint(); render(); return; }
  if(skateBackBuilding){ skateBackBuilding=null; skateBackCursor=null; selOne(null); updateInspector(); render(); return; }
  if(skateRevBuilding){ skateRevBuilding=null; skateRevCursor=null; selOne(null); updateInspector(); render(); return; }
  if(skateBuilding){ skateBuilding=null; skateCursor=null; selOne(null); updateInspector(); render(); return; }
  if(passBuilding){ passBuilding=null; passCursor=null; selOne(null); updateInspector(); render(); return; }
  if(webBuilding){ webBuilding=null; webCursor=null; selOne(null); updateInspector(); render(); return; }
  if(shotBuilding){ shotBuilding=null; shotCursor=null; selOne(null); updateInspector(); render(); return; }
  if(building){ finishBuilding(); return; }
});
cv.addEventListener('wheel',e=>{ e.preventDefault();
  const f=e.deltaY<0?1.12:1/1.12; const _m=drawnXY(e.offsetX,e.offsetY), mx=_m[0], my=_m[1];
  const [wx,wy]=S2W(mx,my); cam.s*=f; cam.tx=mx-wx*cam.s; cam.ty=my-wy*cam.s; camMoved=true; render();
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
    const [wx,wy]=S2W(mx,my); cam.s*=f; cam.tx=mx-wx*cam.s; cam.ty=my-wy*cam.s; camMoved=true; render();
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
      h+=field(p.type==='player'?'Number':'Label','<input type="text" id="f_num" maxlength="3" value="'+escapeHtml(p.num||'')+'">');
    } else if(p.type==='text'){
      h+=field('Text — Enter starts a new line','<textarea id="f_text" rows="3" style="width:100%;box-sizing:border-box;resize:vertical;font:inherit">'+escapeHtml(p.text||'')+'</textarea>');
      h+=field('Colour', colorBtns(p.color||'#11181f'));
      h+=field('<span id="lbl_wrap">Width — '+(p.wrap>0?Math.round(p.wrap):'one line')+'</span>','<input type="range" id="f_wrap" min="0" max="160" step="2" value="'+(p.wrap||0)+'" title="Drag right to let the label run wider before it wraps. All the way left: no wrapping">');
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
    bind('f_wrap','input',v=>{ p.wrap=parseFloat(v)||0; const l=byId('lbl_wrap'); if(l) l.textContent='Width — '+(p.wrap>0?Math.round(p.wrap):'one line'); render(); });
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
    h+='<div class="mini">'+(isMotion? (prettyType(getPiece(p.owner)?.type||'piece')+' travels this lane on Play. Drag the dots to reshape.')
      : p.type==='ring' ? 'Drag the blue handles to stretch or shrink it, or drag inside the ring to move it.'
      : 'Diagram only — does not move.')+'</div>';
    h+=field('Colour', colorBtns(p.color));
    h+='<div class="field"><label id="lbl_w">Weight — '+(p.w||1).toFixed(1)+'</label><input type="range" id="p_w" min="0.3" max="8" step="0.1" value="'+(p.w||1)+'"></div>';
    h+='<div class="field"><label id="lbl_op">Opacity — '+Math.round((p.op==null?1:p.op)*100)+'%</label><input type="range" id="p_op" min="15" max="100" step="5" value="'+Math.round((p.op==null?1:p.op)*100)+'"></div>';
    if(!isMotion){
      h+='<div class="field"><label id="lbl_at">Appears at — '+((p.delay||0)/1000).toFixed(1)+'s</label><input type="range" id="p_at" min="0" max="'+Math.max(0,T-300)+'" step="100" value="'+(p.delay||0)+'"></div>';
      h+='<div class="field"><label id="lbl_hold">'+(p.freeze?'Freezes clip for':'Stays up for')+' — '+((p.dur||0)/1000).toFixed(1)+'s</label><input type="range" id="p_hold" min="300" max="'+T+'" step="100" value="'+Math.min(p.dur||T,T)+'"></div>';
      h+='<div class="field"><label style="display:flex;align-items:center;gap:7px;text-transform:none;font-size:11.5px;letter-spacing:0">'+
         '<input type="checkbox" id="p_freeze"'+(p.freeze?' checked':'')+' style="accent-color:var(--accent)"> Pause the clip while it&rsquo;s up</label></div>';
    }
    if(p.type==='ring'){ const rg=ringGeom(p);
      h+='<div class="field"><label>Width</label><input type="range" id="p_rx" min="1" max="60" step="0.5" value="'+rg.rx.toFixed(1)+'"></div>';
      h+='<div class="field"><label>Height</label><input type="range" id="p_ry" min="0.5" max="40" step="0.5" value="'+rg.ry.toFixed(1)+'"></div>';
    }
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
    bind('p_w','input',v=>{p.w=parseFloat(v); const l=byId('lbl_w'); if(l)l.textContent='Weight — '+parseFloat(v).toFixed(1); render();});
    bind('p_op','input',v=>{p.op=parseFloat(v)/100; const l=byId('lbl_op'); if(l)l.textContent='Opacity — '+Math.round(v)+'%'; render();});
    bind('p_at','input',v=>{p.delay=parseInt(v); if(p.delay+p.dur>T) p.dur=Math.max(300,T-p.delay);
      const l=byId('lbl_at'); if(l)l.textContent='Appears at — '+(p.delay/1000).toFixed(1)+'s'; render();});
    bind('p_hold','input',v=>{p.dur=Math.min(parseInt(v), Math.max(300,T-(p.delay||0)));
      const l=byId('lbl_hold'); if(l)l.textContent=(p.freeze?'Freezes clip for':'Stays up for')+' — '+(p.dur/1000).toFixed(1)+'s'; render();});
    byId('p_freeze')&&(byId('p_freeze').onchange=e=>{ pushUndo(); p.freeze=e.target.checked; updateInspector(); render(); });
    bind('p_rx','input',v=>{const g=ringGeom(p); setRing(p,g.cx,g.cy,parseFloat(v),g.ry); render();});
    bind('p_ry','input',v=>{const g=ringGeom(p); setRing(p,g.cx,g.cy,g.rx,parseFloat(v)); render();});
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
    applyView(viewPresets()[0]); render(); };
  const tc=document.getElementById('trapChk'); if(tc){ tc.checked=showTrap; tc.onchange=()=>{ showTrap=tc.checked; render(); }; }
}
document.getElementById('clearBtn').onclick=()=>{ if(pieces.length||paths.length){ keepBeforeWipe(); pushUndo(); pieces=[]; paths=[]; scenes[currentScene].pieces=pieces; scenes[currentScene].paths=paths; selOne(null); updateInspector(); render();
  // Names what it cleared AND what it did not. "Cleared" on a board with five
  // drill tabs open reads as though all five went.
  toast(scenes.length>1 ? 'Cleared this drill - the other '+(scenes.length-1)+' tab'+(scenes.length>2?'s are':' is')+' untouched' : 'Cleared'); } };
document.getElementById('zin').onclick=()=>{ zoomBy(1.18); };
document.getElementById('zout').onclick=()=>{ zoomBy(1/1.18); };
document.getElementById('zfit').onclick=()=>{ const v=viewPresets().find(p=>p.k===currentView)||viewPresets()[0]; fitRect(v.r); render(); };
function zoomBy(f){ const mx=cv.clientWidth/2,my=cv.clientHeight/2; const [wx,wy]=S2W(mx,my);
  cam.s*=f; cam.tx=mx-wx*cam.s; cam.ty=my-wy*cam.s; camMoved=true; render(); }

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
let imgNameHint=null;   // set by the UI layer when a clip supplies a better name
// Everything a drill occupies, in feet — pieces and route points. The rink is
// not the whole picture: a title sits above the boards, and on the field the
// drill can run off the grass, so the shot has to know where the ink actually is.
function inkBounds(){
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity,any=false;
  // Width and height apart: a title is a long, low box, and squaring it off
  // would push the frame half its own width above the boards.
  const add=(x,y,rx,ry)=>{ any=true; x0=Math.min(x0,x-rx); y0=Math.min(y0,y-ry); x1=Math.max(x1,x+rx); y1=Math.max(y1,y+ry); };
  for(const p of pieces){
    if(p.type==='text') add(p.x,p.y,(p._wft||10)/2,(p._hft||4)/2);
    else if(p.type==='image'){ const w=8*(p.size||1), h=w*((p.img&&p.img.height&&p.img.height/p.img.width)||0.62); add(p.x,p.y,w/2,h/2); }
    else { const r=pieceRadius(p)+1; add(p.x,p.y,r,r); }
  }
  for(const t of paths) for(const q of (t.pts||[])) add(q.x,q.y,1,1);
  return any ? {x:x0,y:y0,w:x1-x0,h:y1-y0} : null;
}
// The picture should be of the drill, not of the window. Shooting the stage
// meant the file was whatever the window happened to be showing, so a zoomed-in
// board lost the far end of the rink off the edge (Josh, 2026-09-11). Reframe
// onto a canvas sized to the surface itself before the shot, the way the clip
// export already does, and the file comes out the same shape every time.
function boardShot(){
  const b=worldBounds(), pad=1.5;
  let x=b.x-pad, y=b.y-pad, X=b.x+b.w+pad, Y=b.y+b.h+pad;
  const ink=inkBounds();
  if(ink){ x=Math.min(x,ink.x-2); y=Math.min(y,ink.y-2); X=Math.max(X,ink.x+ink.w+2); Y=Math.max(Y,ink.y+ink.h+2); }
  const w=X-x, h=Y-y;
  const scale=Math.min(8, Math.max(2, 2400/Math.max(w,h)));   // ~2400px on the long side
  // A surface that is meant to be seen turned gets shot turned. Everything
  // else shoots flat exactly as before, so no existing drill moves.
  const rot=configRot();
  const W=Math.round((rot?h:w)*scale), H=Math.round((rot?w:h)*scale);
  const saved={dpr:DPR,s:cam.s,tx:cam.tx,ty:cam.ty,rot:camRot,w:cv.width,h:cv.height};
  cv.width=W; cv.height=H; DPR=1; camRot=rot;
  // clear() turns the canvas a quarter about its own centre, so the offsets
  // carry that half-difference as well as the world origin.
  if(rot){ cam.s=scale; cam.tx=(W-H)/2 - x*scale; cam.ty=-y*scale - (W-H)/2; }
  else   { cam.s=scale; cam.tx=-x*scale; cam.ty=-y*scale; }
  render();
  const shot=document.createElement('canvas'); shot.width=W; shot.height=H;
  const sctx=shot.getContext('2d');
  sctx.fillStyle='#FFFFFF'; sctx.fillRect(0,0,W,H);
  sctx.drawImage(cv,0,0);
  DPR=saved.dpr; camRot=saved.rot; cam.s=saved.s; cam.tx=saved.tx; cam.ty=saved.ty;
  cv.width=saved.w; cv.height=saved.h;        // put the backing store back ourselves:
  resize();                                   // resize() bails out on a hidden canvas
  return shot;
}
function exportImage(fmt){
  let off;
  if(rinkConfig==='video'){
    // A clip's canvas is already at the clip's own resolution — copy it as it is.
    const W=cv.width, H=cv.height;
    off=document.createElement('canvas'); off.width=W; off.height=H;
    const octx=off.getContext('2d');
    octx.fillStyle='#FFFFFF'; octx.fillRect(0,0,W,H);
    octx.drawImage(cv,0,0,W,H);
  } else {
    off=boardShot();
  }
  const mime=fmt==='jpg'?'image/jpeg':'image/png';
  const ext=fmt==='jpg'?'jpg':'png';
  const safe=safeFileName(imgNameHint || (scenes[currentScene]||{}).name);
  const dims=off.width+'×'+off.height;

  // Pick the folder, same as Save does. A picture that always lands in Downloads
  // has to be moved by hand every time, and the whole point of these is that they
  // go somewhere - a Drive folder that syncs to the team site. Its own picker id,
  // separate from 'drillsDir', so the browser remembers where PICTURES go without
  // dragging the .json saves there too.
  if(window.showSaveFilePicker){
    off.toBlob(async (blob)=>{
      if(!blob){ toast('Could not build the picture'); return; }
      try{
        const handle=await window.showSaveFilePicker({
          id:'picturesDir',
          suggestedName:safe+'.'+ext,
          types:[{description:'Picture', accept:{[mime]:['.'+ext]}}]
        });
        const w=await handle.createWritable();
        await w.write(blob); await w.close();
        toast('"'+safe+'" saved — '+dims);
      }catch(err){
        if(err && err.name==='AbortError'){
          // Same trap the drill save already learned: a silent return after a
          // cancelled dialog looks exactly like a successful save.
          toast('Export cancelled — nothing was written.');
          return;
        }
        downloadImage(off,mime,ext,safe,dims);
      }
    }, mime, 0.95);
    return;
  }
  downloadImage(off,mime,ext,safe,dims);
}
// Fallback for browsers without the File System Access API, and for when the
// picker itself fails.
function downloadImage(off,mime,ext,safe,dims){
  const a=document.createElement('a');
  a.href=off.toDataURL(mime,0.95);
  a.download=safe+'.'+ext;
  a.click();
  toast('Picture saved to your downloads — '+dims);
}
document.getElementById('imgExportBtn').onclick=()=>exportImage('jpg');

// save / open
// Windows rejects \ / : * ? " < > | in a filename; everything else a coach
// might reasonably type — digits, hyphens, apostrophes, brackets, & — is fine
// and should survive. "9-01 Power Plays" comes through untouched.
function safeFileName(name){
  const s=(name||'').replace(/[\\\/:*?"<>|]/g,'').replace(/\s+/g,' ').trim();
  return s || ('drill-'+new Date().toISOString().slice(0,10));
}
// The saved shape, in one place. Save writes it to a file; autosave writes the
// same thing to browser storage, so a restored board is byte-for-byte what a
// saved one would have been.
function buildDrillData(){
  syncScene();
  return {v:2,showTrap,centerLogo,rinkSize,
    customLogo: LOGO_SRC.custom||null,
    currentScene,
    fileName: lastSaveName||'',
    sheet: sheetHead(),
    scenes: scenes.map(s=>({
      name:s.name, rinkType:s.rinkType||'full',
      // Notes and equipment were typed on screen and then dropped on the way
      // out - nothing wrote them into the file, so every drill came back blank
      // when you reopened it. They are the lines beside the rink on the
      // practice sheet, so they have to survive the round trip.
      notes:s.notes||'', equip:s.equip||'', mins:s.mins||'', rest:(s.rest===0||s.rest)?s.rest:'',
      pieces:s.pieces.map(p=>({...p,img:undefined,_src:p._src||null})),
      paths:s.paths.map(p=>({...p,_lut:undefined}))
    }))};
}
// One drill, on its own, for the bank. No practice header on it: a drill is not
// a practice, and a date stamped on a reusable drill is a lie by next week.
function buildOneDrillData(idx){
  syncScene();
  const s=scenes[idx]; if(!s) return buildDrillData();
  return {v:2, showTrap, centerLogo, rinkSize,
    customLogo: LOGO_SRC.custom||null,
    currentScene:0,
    scenes:[{
      name:s.name, rinkType:s.rinkType||'full',
      notes:s.notes||'', equip:s.equip||'', mins:s.mins||'', rest:(s.rest===0||s.rest)?s.rest:'',
      pieces:s.pieces.map(p=>({...p,img:undefined,_src:p._src||null})),
      paths:s.paths.map(p=>({...p,_lut:undefined}))
    }]};
}
// Save practice writes every tab, so every tab now matches a file. Save drill
// writes only the one you are on. Either way the tabs stop warning about work
// that is already on disk.
function markSaved(){
  if(_saveMode==='drill'){ if(scenes[currentScene]) scenes[currentScene].dirty=false; }
  else scenes.forEach(sc=>sc.dirty=false);
  updateSceneTabs();
}
async function doSaveDrill(name, dataIn){
  const data=dataIn||buildDrillData();
  const safe=safeFileName(name);
  const json=JSON.stringify(data);
  // Preferred: File System Access API — saves straight into a folder you pick (it remembers your Drills
  // folder across saves). This is app-only; it does NOT change the browser's global download location.
  if(window.showSaveFilePicker){
    try{
      const handle=await window.showSaveFilePicker({
        id:'drillsDir',                         // browser remembers this picker's last-used folder
        suggestedName:safe+'.json',
        types:[{description:'Drill file', accept:{'application/json':['.json']}}]
      });
      const w=await handle.createWritable();
      await w.write(json); await w.close();
      markSaved();                 // the tabs now match a file, and should say so
      toast('"'+safe+'" saved');
      return;
    }catch(err){
      if(err && err.name==='AbortError'){
        // Cancelling used to return in silence, which looks exactly like a
        // successful save. A whole board was lost to that: the dialog got
        // dismissed, nothing said otherwise, and the next reload took it.
        toast('Save cancelled — nothing was written. Your work is still here.');
        return;
      }
      // any other error: fall through to the download fallback below
    }
  }
  // Fallback (browsers without the File System Access API): normal download
  const blob=new Blob([json],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download=safe+'.json'; a.click();
  markSaved();
  toast('"'+safe+'" saved — move it to your Drills folder');
}
// The name a FILE was last saved under. A practice is many drills, so the file
// has a name of its own and the box should offer that back rather than
// whichever tab happens to be open.
let lastSaveName='';
let _saveMode='practice';
// The date buried in a file name, or '' if it carries none. A practice file is
// named for its day, so this is how the app can tell that the name it is about
// to offer belongs to a different practice than the one on the board.
function nameDateISO(s){ const m=String(s||'').match(/\d{4}-\d{2}-\d{2}/); return m?m[0]:''; }
function practiceNameFor(){
  const d=shDateValue()||'';
  if(!d) return '';
  // The TIME is deliberately not in here. A practice is the day; the time is a
  // fact about it that lives inside the file and is free to move. Putting it in
  // the name meant nudging 1100-1215 to 1100-1230 offered a different file, so
  // one practice quietly became two saves of the same day. Josh types a fuller
  // name when he wants one, and that name is what comes back next time.
  return (d+' practice').trim();
}
function saveModalCheck(){
  const inp=document.getElementById('drillNameInput');
  const what=document.getElementById('saveWhat');
  const warn=document.getElementById('saveWarn');
  if(!inp||!what||!warn) return;
  const d=shDateValue()||'', t=((document.getElementById('shTime')||{}).value||'').trim();
  what.textContent = _saveMode==='drill'
    ? 'Writes this one drill ('+(scenes[currentScene]&&scenes[currentScene].name||'')+'). No date, no practice header.'
    : 'Writes all '+scenes.length+' drill'+(scenes.length>1?'s':'')+(d?' for '+d:'')+(t?', '+t:'')+'.';
  const nd=nameDateISO(inp.value);
  const bad = _saveMode!=='drill' && d && nd && nd!==d;
  warn.style.display = bad?'block':'none';
  if(bad) warn.textContent='⚠ That name says '+nd+' but the board is set to '+d+'. Saving will overwrite the '+nd+' practice.';
}
function openSaveModal(mode){
  _saveMode=mode;
  const inp=document.getElementById('drillNameInput');
  const ttl=document.querySelector('#saveModal h2');
  if(ttl) ttl.textContent = mode==='drill' ? 'Save this drill' : 'Save practice';
  // lastSaveName is only offered back while it still belongs to THIS day.
  // Open the 21st, move the board to the 22nd, draw, and Save used to hand
  // back "2026-10-21 practice..." - tonight's work pointed at yesterday's file.
  const keep = lastSaveName &&
    (!shDateValue() || !nameDateISO(lastSaveName) || nameDateISO(lastSaveName)===shDateValue());
  inp.value = mode==='drill'
    ? (scenes[currentScene]&&scenes[currentScene].name||'')
    : ((keep?lastSaveName:'') || practiceNameFor() ||
       (scenes.length>1 ? ((shDateValue()||'')+' practice').trim()
                        : (scenes[currentScene]&&scenes[currentScene].name||'')));
  saveModalCheck();
  document.getElementById('saveModal').classList.add('show');
  setTimeout(()=>inp.select(),80);
}
on('drillNameInput','input',saveModalCheck);
on('saveDrillBtn','click',()=>openSaveModal('drill'));
document.getElementById('exportBtn').onclick=()=>openSaveModal('practice');
document.getElementById('saveModalCancel').onclick=()=>document.getElementById('saveModal').classList.remove('show');
document.getElementById('saveModalConfirm').onclick=()=>{
  const name=document.getElementById('drillNameInput').value;
  const clean=name.trim();
  // Last stop. A practice name carrying a different day than the board is how
  // one practice gets written over another, and the file picker will not ask
  // twice once the name matches something already in the folder.
  if(_saveMode!=='drill'){
    const d=shDateValue()||'', nd=nameDateISO(clean);
    if(d && nd && nd!==d && !confirm('This board is set to '+d+', but the name says '+nd+
        '.\n\nSaving as "'+clean+'" will overwrite the '+nd+' practice with these '+
        scenes.length+' drills.\n\nSave anyway?')) return;
  }
  document.getElementById('saveModal').classList.remove('show');
  if(_saveMode==='drill'){
    // Naming the file names the drill - here they are the same thing, and the
    // tab should say what the bank will show. The practice's own file name is
    // left alone, so the next Save practice still offers it.
    if(clean && scenes[currentScene]){ scenes[currentScene].name=clean; updateSceneTabs(); }
    doSaveDrill(name, buildOneDrillData(currentScene));
    return;
  }
  if(clean) lastSaveName=clean;
  // A one-drill file takes its name from the drill, so the tab, the JPG and the
  // printed heading all agree. A PRACTICE must not: saving four drills as
  // "2026-10-22 practice" would rename whichever tab was open and that name
  // prints in the title box on the sheet.
  if(clean && scenes.length===1 && scenes[currentScene]){
    scenes[currentScene].name=clean; updateSceneTabs();
  }
  doSaveDrill(name);
};
document.getElementById('drillNameInput').addEventListener('keydown',e=>{
  if(e.key==='Enter'){ document.getElementById('saveModalConfirm').click(); }
  if(e.key==='Escape'){ document.getElementById('saveModal').classList.remove('show'); }
});
// One file input, two jobs. 'replace' is Open drill... - the old behaviour, which
// swaps the whole practice for the file. 'append' is Add drill from file..., which
// brings the file's drills in as extra tabs and leaves what is open alone.
let _importMode='replace';
// Open replaces the whole practice, so the one on screen goes into the history
// first - that is the difference between swapping files and losing one.
document.getElementById('importBtn').onclick=()=>{ keepBeforeWipe(); _importMode='replace'; document.getElementById('jsonFile').click(); };
const _addBtn=document.getElementById('addDrillBtn');
if(_addBtn) _addBtn.onclick=()=>{ _importMode='append'; document.getElementById('jsonFile').click(); };

document.getElementById('jsonFile').onchange=e=>{ const f=e.target.files[0]; if(!f)return;
  const mode=_importMode;
  const r=new FileReader();
  r.onload=()=>{ try{ const o=JSON.parse(r.result);
      if(mode==='append') appendData(o, f.name); else { loadData(o); toast('Drill loaded'); }
    } catch(err){ toast('Could not read that file'); } };
  r.readAsText(f); e.target.value=''; };

// Bring a saved file's drills in as NEW TABS. Open drill... replaces everything,
// which is right when you are loading a practice but wrong when you want two
// systems side by side - and with five tabs open, "open" quietly costing you all
// five is the kind of surprise that loses work.
function appendData(o, fname){
  syncScene();
  const incoming = (o && o.scenes && o.scenes.length)
    ? o.scenes
    : [{ name:(fname||'Drill').replace(/\.json$/i,''), rinkType:o.rinkConfig||'full',
         pieces:o.pieces||[], paths:o.paths||[] }];

  // Ids are remapped rather than trusted. Two files saved separately both start
  // numbering at 1, so pasting one beside the other would give two pieces the
  // same id - and selection, deletion and the motion paths all key off id.
  const added=[];
  incoming.forEach(s=>{
    const sc=makeScene(s.name||'Drill');
    sc.rinkType=s.rinkType||'full';
    const remap={};
    sc.pieces=(s.pieces||[]).map(p=>{ const q={...p}; remap[p.id]=uid; q.id=uid++;
      if(p._src){ const img=new Image(); img.src=p._src; q.img=img; } return q; });
    sc.paths=(s.paths||[]).map(p=>{ const q={...p,_lut:null}; q.id=uid++;
      if(q.owner!=null && remap[q.owner]!=null) q.owner=remap[q.owner];   // keep routes on their skater
      return q; });
    // Everything the drill carries, not just its notes. This dropped mins and
    // equipment on the floor: a drill saved as 6 minutes came out of the
    // library blank, so the running total under-counted every practice built
    // from the bank and nobody could see why.
    sc.notes=s.notes||''; sc.equip=s.equip||''; sc.mins=s.mins||'';
    sc.rest=(s.rest===0||s.rest)?s.rest:(s.nobreak?0:'');
    sc.dirty=false;                 // it came out of a file, so it matches one
    scenes.push(sc); added.push(sc);
  });

  if(!added.length){ toast('Nothing in that file to add'); return; }
  loadScene(scenes.length-added.length);      // land on the first one added
  updateSceneTabs();
  toast('Added '+added.length+' drill'+(added.length>1?'s':'')+' — now '+scenes.length+' tabs');
}
function loadData(o){
  // Sheet size before anything else: the views and the piece positions are all
  // read against it, and loading a 200x100 drill onto an 85ft sheet puts every
  // piece in the wrong place without saying so.
  if(o.rinkSize && RINK_SIZES[o.rinkSize]){ rinkSize=o.rinkSize; RW=RINK_SIZES[rinkSize].w; RH=RINK_SIZES[rinkSize].h; buildRinkSizeSel(); }
  if(o.showTrap!==undefined) showTrap=o.showTrap;
  if(o.customLogo){ LOGO_SRC.custom=o.customLogo; const im=new Image(); im.src=o.customLogo; im.onload=()=>{try{render();}catch(e){}}; LOGO_IMG.custom=im; ensureLogoOption('custom','Custom'); }
  centerLogo=(o.centerLogo!==undefined)?o.centerLogo:centerLogo; syncLogoSel();
  // multi-scene format (v2)
  if(o.scenes && o.scenes.length){
    scenes=o.scenes.map(s=>{
      const sc=makeScene(s.name||'Drill');
      sc.rinkType=s.rinkType||'full';
      sc.notes=s.notes||''; sc.equip=s.equip||''; sc.mins=s.mins||'';
      // files written before Rest existed carry the tickbox it replaced
      sc.rest=(s.rest===0||s.rest)?s.rest:(s.nobreak?0:'');
      sc.dirty=false;               // ditto: opened from a file
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
  const _nt=document.getElementById('drillNotes'); if(_nt) _nt.value=s.notes||'';
  const _eq=document.getElementById('equipNotes'); if(_eq) _eq.value=s.equip||'';
  const _mn=document.getElementById('drillMins'); if(_mn) _mn.value=s.mins||'';
  const _nb=document.getElementById('drillRest'); if(_nb) _nb.value=(s.rest===0||s.rest)?s.rest:'';
  if(typeof growAllNotes==='function') growAllNotes();
  if(typeof updateMinsTotal==='function') updateMinsTotal();
  if(o.fileName) lastSaveName=o.fileName;   // Save offers the name it came in under
  applySheetHead(o.sheet);
  selOne(null); currentView=defaultView(); buildLayoutSeg(); buildViewSeg();
  applyView(viewPresets()[0]); updateInspector(); updateSceneTabs(); render();
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
  if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA')return;   // typing in a box, not a shortcut
  if(coverFrom!=null && e.key==='Escape'){ e.preventDefault(); cancelCover(); return; }
  if(building && (e.key==='Enter'||e.key==='Escape')){ e.preventDefault(); finishBuilding(); return; }
  if(skateBackBuilding && (e.key==='Enter'||e.key==='Escape')){ e.preventDefault(); skateBackBuilding=null; skateBackCursor=null; selOne(null); updateInspector(); render(); return; }
  if(skateRevBuilding && (e.key==='Enter'||e.key==='Escape')){ e.preventDefault(); skateRevBuilding=null; skateRevCursor=null; selOne(null); updateInspector(); render(); return; }
  if(skateBuilding && (e.key==='Enter'||e.key==='Escape')){ e.preventDefault(); skateBuilding=null; skateCursor=null; selOne(null); updateInspector(); render(); return; }
  if(passBuilding && (e.key==='Enter'||e.key==='Escape')){ e.preventDefault(); passBuilding=null; passCursor=null; selOne(null); updateInspector(); render(); return; }
  if(webBuilding && (e.key==='Enter'||e.key==='Escape')){ e.preventDefault(); webBuilding=null; webCursor=null; selOne(null); updateInspector(); render(); return; }
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
  if(coverFrom!=null){ h.textContent='Now circle the player they cover — Esc to cancel'; h.style.display='block'; return; }
  const onClip = (rinkConfig==='video');
  // The "drop a skater on the ice" line is for the drill board. On a clip
  // there is nothing to drop — the players are already in the footage.
  if(pieces.length===0 && !onClip){ h.textContent='Click a skater on the left to drop it on the ice — then draw a path from it and press Play.'; h.style.display='block'; return; }
  const clipTips={
    select:'Click a mark to pick it up • drag inside a ring to move it, the corner dot to resize • Delete removes it',
    ring:'Drag a box around a player — the ring shows as you drag and is fixed when you let go',
    cover:'Circle a player, then circle who they cover — a line joins the two',
    skate:'Draw the route you want them to take', arrow:'Point at what you want them to see',
    pen:'Freehand — circle, underline, scribble on the play',
    bar:'Drag a straight bar — a gap to close, a lane to seal',
    web:'Click each player, then double-click to close the web',
    text:'Click anywhere on the frame to drop a note',
    erase:'Click a mark to delete it' };
  const tips={ select:'Drag pieces • drag a selected lane\'s dots to reshape • Delete to remove',
    motion:'From a piece: drag to curve, or click to add turns (S/U/zig-zag). Click the end of a route to extend it. Double-click or Enter to finish.',
    skate:'Draw a skating route (diagram only, does not move)',
    pass:'Click to start a pass — click again to add a redirect/bump — double-click or Enter to finish. Draw as many passes as needed.', shot:'Draw a shot from the puck',
    arrow:'Draw a straight arrow (diagram only)', pen:'Freehand draw (diagram only)',
    text:'Click anywhere, on or off the ice, to drop a label; double-click a label to edit',
    ring:'Drag a box around what you want circled', bar:'Drag a straight bar',
    cover:'Circle a player, then circle who they cover — a line joins the two',
    web:'Click each player, then double-click to close the web',
    pan:'Drag to move the view', erase:'Click a piece or path to delete it' };
  const line = (onClip && clipTips[tool]) || tips[tool] || '';
  h.textContent=line; h.style.display = line ? 'block':'none';
}

// toast
let toastT;
function toast(m){ const t=document.getElementById('toast'); t.textContent=m; t.classList.add('show');
  clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove('show'),1700); }

// =========================================================
//  DEMO: 1 D breaks out 2 F's, swing, return 2v1
// =========================================================
// The demo lands in a tab of its own unless the one you are on is empty.
// It used to empty the current drill and build itself there, with nothing on
// the button to say so: Josh drew a practice, pressed it, and the sheet printed
// the 2v1 because that is what was on Drill 1 by then. An example you can look
// at is not worth a drill you drew.
function loadDemo(){
  syncScene();
  if(pieces.length || paths.length){
    addScene();
    scenes[currentScene].name='Demo — 2v1 breakout';
    updateSceneTabs();
  }
  buildDemo();
}
function buildDemo(){
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
  updateSceneTabs(); autosave();
  toast(scenes.length>1 ? '2v1 breakout loaded in its own tab — press Play'
                        : '2v1 breakout loaded — press Play');
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
// The notes box follows what is in it, up to the cap the stylesheet sets, and
// you can still drag it taller. Growing the box shortens the stage, and the
// board refits itself to that, so the rink stays whole either way.
function growNotes(el){
  if(!el) return;
  el.style.height='auto';
  el.style.height=Math.max(el.scrollHeight, 1)+'px';
}
function growAllNotes(){ ['drillNotes','equipNotes'].forEach(i=>growNotes(document.getElementById(i))); }
// ---- minutes per drill, and what they add up to ---------------------------
// The question a 4-5pm sheet is really asking is whether the plan fits the
// hour. Each drill carries its own minutes; the band totals them against the
// Time field, so you find out while you are building rather than on the ice.
function planMinutes(){
  syncScene();
  return scenes.reduce((n,s)=>n+(parseInt(s.mins,10)||0),0);
}
// The minutes between drills. Only drills with a time on them count as drills
// here - a blank slot is not something the team stands around waiting for -
// and there is no gap after the last one, so six drills make five gaps.
const GAP_KEY='jmdd.gap.v1';
function gapEach(){
  const el=document.getElementById('shGap');
  const v=el ? parseInt(el.value,10) : parseInt(localStorage.getItem(GAP_KEY)||'2',10);
  return (isFinite(v)&&v>=0) ? v : 0;
}
// A gap sits BETWEEN two timed drills, so the last one never earns one - and
// a drill marked "straight into next" hands its gap back. That is how a block
// of faceoff plays, walked through one after another, costs no water time.
// The rest owed AFTER one drill: its own number if it carries one - 0 means it
// runs straight into the next - and the Between-drills default if it does not.
function restAfter(s){
  const v=(s && s.rest!=='' && s.rest!=null) ? parseInt(s.rest,10) : NaN;
  return (isFinite(v) && v>=0) ? v : gapEach();
}
function timedScenes(){ syncScene(); return scenes.filter(s=>parseInt(s.mins,10)>0); }
// Nothing is owed after the LAST drill - you come off the ice, you do not
// stand on it getting water.
function gapCount(){ const t=timedScenes(); let n=0;
  for(let i=0;i<t.length-1;i++) if(restAfter(t[i])>0) n++; return n; }
function gapMinutes(){ const t=timedScenes(); let n=0;
  for(let i=0;i<t.length-1;i++) n+=restAfter(t[i]); return n; }
// True while every rest is the default, which is the only time the total can
// honestly be explained as "n x 2".
function restsAllDefault(){ const t=timedScenes();
  for(let i=0;i<t.length-1;i++) if(t[i].rest!=='' && t[i].rest!=null) return false;
  return true; }
// "1600-1700", "5:40 - 7:00", "4:00pm - 5:00pm" all mean the same thing to a
// coach, so they have to mean the same thing here.
function iceMinutes(str){
  const m=String(str||'').match(/(\d{1,2})[:.]?(\d{2})\s*([ap])?\.?m?\.?\s*(?:-|–|—|to)\s*(\d{1,2})[:.]?(\d{2})\s*([ap])?\.?m?\.?/i);
  if(!m) return 0;
  let h1=+m[1], n1=+m[2], h2=+m[4], n2=+m[5];
  const p1=(m[3]||'').toLowerCase(), p2=(m[6]||'').toLowerCase();
  if(p1==='p'&&h1<12) h1+=12; if(p1==='a'&&h1===12) h1=0;
  if(p2==='p'&&h2<12) h2+=12; if(p2==='a'&&h2===12) h2=0;
  let t1=h1*60+n1, t2=h2*60+n2;
  if(t2<=t1) t2+=720;                 // 5:40 - 7:00 with no am/pm on either end
  const d=t2-t1;
  return (d>0 && d<=360) ? d : 0;     // anything over six hours is a typo, not ice
}
function updateMinsTotal(){
  const el=document.getElementById('minsTotal'); if(!el) return;
  const drill=planMinutes(), gap=gapMinutes(), plan=drill+gap;
  const ice=iceMinutes((document.getElementById('shTime')||{}).value);
  el.className='sh-note';
  if(!drill){ el.textContent=''; el.title=''; return; }
  // The sum is shown split - 62+10 - because the 10 is an estimate and the 62
  // is not, and a single number hides which one to argue with.
  const sum = gap ? (drill+'+'+gap) : String(drill);
  const why = drill+' min of drills'+(gap
    ? (' + '+gap+' min rest'+(restsAllDefault() ? ' ('+gapCount()+' × '+gapEach()+')'
                                                : ' (across '+gapCount()+' break'+(gapCount()===1?'':'s')+')'))
    : ' + no rest');
  if(!ice){ el.textContent=sum+' min planned'; el.classList.add('on');
    el.title=why+'. Put the ice time in the Time box and this says whether it fits'; return; }
  el.textContent=sum+' of '+ice+' min';
  el.classList.add(plan>ice?'over':'fits');
  el.title = why+' — '+(plan>ice ? (plan-ice)+' minutes MORE than the ice you have'
                                 : (ice-plan)+' minutes spare');
}
// Every one of these is guarded. app.js is loaded by Film Room as well, and
// that page has no Min box and no sheet band: an unguarded addEventListener on
// a missing element throws, and everything after it in this file stops being
// wired up - which is how a drill-board feature breaks the clip page.
// Typed text and numbers never touch pushUndo, so they mark the drill here.
function touchScene(){ const sc=scenes[currentScene];
  if(sc && !sc.dirty){ sc.dirty=true; updateSceneTabs(); } }
function on(id, ev, fn){ const el=document.getElementById(id); if(el) el.addEventListener(ev, fn); return el; }
on('drillMins','input',function(){ scenes[currentScene].mins=this.value; touchScene(); updateMinsTotal(); autosave(); });
on('drillRest','input',function(){ scenes[currentScene].rest=this.value===''?'':Math.max(0,parseInt(this.value,10)||0); touchScene(); updateMinsTotal(); autosave(); });
on('shTime','input', function(){ timeTypedByHand(); updateMinsTotal(); });
// The gap is how Josh runs practice, not a property of one practice, so it
// lives in this browser and is there again tomorrow.
(function(){ const el=document.getElementById('shGap'); if(!el) return;
  const saved=localStorage.getItem(GAP_KEY); if(saved!==null) el.value=saved;
  el.addEventListener('input', function(){
    try{ localStorage.setItem(GAP_KEY, String(gapEach())); }catch(e){}
    updateMinsTotal();
  });
})();
on('drillNotes','input',function(){ scenes[currentScene].notes=this.value; touchScene(); growNotes(this); autosave(); });
on('equipNotes','input',function(){ scenes[currentScene].equip=this.value; touchScene(); growNotes(this); autosave(); });
growAllNotes();
updateMinsTotal();

// =========================================================
//  PRACTICE SHEET — every drill tab, four rinks to a page
// =========================================================
// The sheet Josh fills in by hand is a Publisher template: a crest and
// TEAM/COACH/DATE/TIME across the top, four blank rinks down the page with
// ruled lines beside each one, and a second page for rinks 5-8. This prints
// that sheet with the drills already drawn in. Drill tab 1 is rink 1, tab 5
// starts page 2, so the slots are the tabs you already switch between.
// Front and back carry different crests on the sheet Josh prints - the wide
// Seattle Kraken wordmark on page 1, the Jr Kraken lockup on page 2 - and
// neither is the centre-ice logo. So each page picks its own, and an upload is
// remembered in this browser as well as written into the file.
const SHEET_LOGO_KEY='jmdd.sheetLogos.v1';
let sheetLogoF='centre', sheetLogoB='centre';
const SHEET_UP={f:null, b:null};
function sheetHead(){
  const v=i=>{ const el=document.getElementById(i); return el?el.value:''; };
  // A crest that came from the drills folder is NOT written into the file: the
  // folder has it, and a 188KB picture inside every save made a four-drill
  // practice 551KB instead of 26KB. That weight also crowded the autosave
  // history, which is the thing standing between Josh and a lost board. A
  // crest he uploaded by hand still travels, because nothing else holds it.
  return {team:v('shTeam'), coach:v('shCoach'), date:v('shDate'), time:v('shTime'),
    logoF:sheetLogoF, logoB:sheetLogoB,
    upF: SHEET_UP.atF ? null : (SHEET_UP.f||null),
    upB: SHEET_UP.atB ? null : (SHEET_UP.b||null),
    crestFromFolder: !!(SHEET_UP.atF||SHEET_UP.atB)};
}
function applySheetHead(h){
  if(!h) return;
  const set=(i,val)=>{ const el=document.getElementById(i); if(el&&val!=null) el.value=val; };
  set('shTeam',h.team); set('shCoach',h.coach); set('shDate',h.date); set('shTime',h.time);
  // A crest that came from the drills folder outranks the one saved inside a
  // board. Restoring yesterday's practice used to drag yesterday's crest back
  // with it and quietly undo the lockup sitting in the folder.
  if(h.upF && !SHEET_UP.atF) SHEET_UP.f=h.upF;
  if(h.upB && !SHEET_UP.atB) SHEET_UP.b=h.upB;
  if(h.logoF && !SHEET_UP.atF) sheetLogoF=h.logoF;
  if(h.logoB && !SHEET_UP.atB) sheetLogoB=h.logoB;
  saveSheetLogos(); buildSheetLogoSels();
}
function saveSheetLogos(){
  try{ localStorage.setItem(SHEET_LOGO_KEY, JSON.stringify(
    {f:sheetLogoF, b:sheetLogoB, upF:SHEET_UP.f, upB:SHEET_UP.b,
     atF:SHEET_UP.atF||0, atB:SHEET_UP.atB||0})); }catch(e){}
}
function loadSheetLogos(){
  try{
    const o=JSON.parse(localStorage.getItem(SHEET_LOGO_KEY)||'null');
    if(!o) return;
    sheetLogoF=o.f||'centre'; sheetLogoB=o.b||'centre';
    SHEET_UP.f=o.upF||null; SHEET_UP.b=o.upB||null;
    SHEET_UP.atF=o.atF||0; SHEET_UP.atB=o.atB||0;
  }catch(e){}
}
// A picture for the print window, which is a blank document with no address of
// its own - a relative path into images/ resolves to nothing there.
function builtinLogoURL(k){
  if(!k || k==='none') return null;
  if(k==='custom') return LOGO_SRC.custom||null;
  const im=LOGO_IMG[k];
  if(!im || !im.complete || !im.naturalWidth) return null;
  const c=document.createElement('canvas');
  c.width=im.naturalWidth; c.height=im.naturalHeight;
  c.getContext('2d').drawImage(im,0,0);
  try{ return c.toDataURL('image/png'); }catch(e){ return null; }
}
function logoDataURL(){ return builtinLogoURL(centerLogo); }
function crestURL(which){
  const pick = which==='b' ? sheetLogoB : sheetLogoF;
  // "upload" with nothing in hand means the crest lives in a drills folder this
  // browser has not been given. Fall back to the centre logo rather than
  // printing a sheet with an empty corner.
  if(pick==='upload') return SHEET_UP[which] || logoDataURL();
  if(pick==='centre') return logoDataURL();
  return builtinLogoURL(pick);
}
function buildSheetLogoSels(){
  [['shLogoF','f'],['shLogoB','b']].forEach(([id,which])=>{
    const sel=document.getElementById(id); if(!sel) return;
    const cur = which==='b' ? sheetLogoB : sheetLogoF;
    let html='<option value="centre">Same as Centre</option><option value="none">No crest</option>';
    for(const k in LOGO_NAMES) html+='<option value="'+k+'">'+LOGO_NAMES[k]+'</option>';
    if(SHEET_UP[which]) html+='<option value="upload">Uploaded crest</option>';
    html+='<option value="pick">Upload…</option>';
    sel.innerHTML=html;
    sel.value=cur;
  });
}
// =========================================================
//  LINES FROM THE LINE-UP CARD
// =========================================================
// The lines live in the line-up card on the Kraken site, behind the coach key,
// in that browser's storage. This is a public page on another domain: it cannot
// read that, and it has no business asking a gated site for player names. So
// the card's own "Export all days" file does the travelling. It is held in this
// browser, written into nothing, and uploaded nowhere.
const LINES_KEY='jmdd.lines.v1';
let LINES={days:null, locked:null, roster:null, from:'', rosterFrom:'', at:0};
// The card's jersey palette, by its storage letter. Do not renumber: these
// letters are what the card wrote down.
// `print` is what goes on paper where the card's own colour would not read.
// Navy is #001628 on screen - R0 G22 B40 - and in an 8px square on a laser
// printer that is a black dot. Josh asked for it a shade lighter so the sheet
// shows navy as navy; the card is still the authority for what a player wears.
const JERSEY={n:{n:'Navy',hex:'#001628',print:'#0B2E4F'}, w:{n:'White',hex:'#FFFFFF'}, r:{n:'Red',hex:'#E9072B'},
  c:{n:'Baby blue',hex:'#99D9D9'}, y:{n:'Yellow',hex:'#F5C518'}, g:{n:'Green',hex:'#2E9E5B'},
  o:{n:'Orange',hex:'#E08A3C'}, p:{n:'Purple',hex:'#7A5AA8'}};
// Four lines across: forwards, then the pair, then the goalie on that line.
const LINE_ROWS=[
  ['f1l','f1c','f1r','d1l','d1r','g1'],
  ['f2l','f2c','f2r','d2l','d2r','g2'],
  ['f3l','f3c','f3r','d3l','d3r',null],
  ['f4l','f4c','f4r','d4l','d4r',null]
];
function saveLines(){
  try{ localStorage.setItem(LINES_KEY, JSON.stringify(LINES)); }catch(e){}
}
function loadLines(){
  try{ const o=JSON.parse(localStorage.getItem(LINES_KEY)||'null'); if(o) LINES=o; }catch(e){}
}
function linesNote(){
  const el=document.getElementById('linesNote'); if(!el) return;
  const bits=[];
  if(LINES.days){
    const k=Object.keys(LINES.days).sort();
    // The span of days is the useful part: it says at a glance whether the file
    // you loaded reaches the practice you are printing.
    bits.push(k.length+' day'+(k.length===1?'':'s')+(k.length?' '+k[0]+'…'+k[k.length-1].split('#')[0]:''));
  }
  if(LINES.roster) bits.push('roster');
  el.textContent = bits.length ? '✓ '+bits.join(' + ') : 'no lines loaded';
  el.classList.toggle('on', bits.length>0);
  el.title = bits.length ? 'Loaded from '+[LINES.from,LINES.rosterFrom].filter(Boolean).join(' and ')
    : 'Export all days from the line-up card, and roster.json, then load them here';
  const x=document.getElementById('linesClear');
  if(x) x.style.display = bits.length ? '' : 'none';
}
function clearLines(){
  LINES={days:null, locked:null, roster:null, from:'', rosterFrom:'', at:0};
  sheetSession='';
  try{ localStorage.removeItem(LINES_KEY); }catch(e){}
  linesNote(); buildSessionSel(); updateLinesState(); toast('Lines cleared');
}
// The folder you granted for the library is the same folder the export belongs
// in, so look there before asking for anything. Drop a fresh export in and the
// sheet picks it up on its own.
// A saved practice is named for its day - "2026-10-21 practice II afternoon,
// R2 4-5pm". A drill from the bank is not, and must never be offered as one.
function looksLikePractice(n){ return /\.json$/i.test(n) && /practice/i.test(n) && /\d{4}-\d{2}-\d{2}/.test(n); }
async function findPracticeFor(iso){
  if(!iso) return null;
  const dir=await libGet(); if(!dir) return null;
  try{ if(await dir.queryPermission({mode:'read'})!=='granted') return null; }catch(e){ return null; }
  let best=null, more=0;
  try{
    for await (const [name,h] of dir.entries()){
      if(h.kind!=='file' || !looksLikePractice(name) || name.indexOf(iso)<0) continue;
      const f=await h.getFile();
      if(best) more++;
      if(!best || f.lastModified>best.file.lastModified) best={name, file:f};
    }
  }catch(e){ return null; }
  if(best) best.more=more;
  return best;
}
let _dayOffer=null;
async function offerDayPractice(){
  const btn=document.getElementById('openDayBtn'); if(!btn) return;
  const iso=shDateValue();
  let hit=null;
  try{ hit=await findPracticeFor(iso); }catch(e){}
  _dayOffer=hit;
  const base=hit ? hit.name.replace(/\.json$/i,'') : '';
  // Nothing to offer, or it is already the practice on the board.
  if(!hit || base===lastSaveName){ btn.hidden=true; return; }
  btn.hidden=false;
  btn.textContent='📂 Open '+base;
  btn.title='A saved practice for '+iso+' is in your drills folder'+
    (hit.more?' ('+hit.more+' older one'+(hit.more>1?'s':'')+' too - this is the newest)':'')+
    '. Opening it REPLACES the drills on the board.';
}
function looksLikeLines(n){ return /lineup/i.test(n) && /\.json$/i.test(n); }
function looksLikeCalendar(n){ return /^calendar\.json$/i.test(n); }

// =========================================================
//  ICE COUNT — which session of the season this sheet is
// =========================================================
// Josh counts every team ice session from August tryouts on. Goalie clinics
// are NOT team ice: they run inside a practice window - "goalies leave
// practice" - so counting them would both double-count the hour and flatter
// the total. They are totalled on their own.
let CAL=null;                       // {events:[...]} from calendar.json
function isTeamIce(e){
  return e && e.kind==='ice' && !e.cancelled && !/goalie/i.test(e.title||'');
}
function isGoalieIce(e){
  return e && e.kind==='ice' && !e.cancelled && /goalie/i.test(e.title||'');
}
function eventMinutes(e){
  const p=s=>{ const m=String(s||'').match(/^(\d{1,2}):(\d{2})$/); return m?(+m[1]*60 + +m[2]):null; };
  const a=p(e.start), b=p(e.end);
  if(a==null||b==null) return 0;
  let d=b-a; if(d<0) d+=1440;         // a session that crosses midnight
  return (d>0 && d<=360) ? d : 0;
}
function teamIceSessions(){
  if(!CAL || !Array.isArray(CAL.events)) return [];
  return CAL.events.filter(isTeamIce)
    .slice()
    .sort((x,y)=> (x.date===y.date) ? String(x.start).localeCompare(String(y.start))
                                    : String(x.date).localeCompare(String(y.date)));
}
// The sheet's session picker says Ice 1 or Ice 2; the calendar says which ice
// that is by start time, so the two line up on the day's running order.
function iceCountFor(iso, sessionId){
  const list=teamIceSessions();
  if(!list.length || !iso) return null;
  const sameDay=list.filter(e=>e.date===iso);
  if(!sameDay.length) return null;
  const want = sessionId==='ice2' ? (sameDay[1]||sameDay[0]) : sameDay[0];
  let n=0, mins=0;
  for(const e of list){
    n++; mins+=eventMinutes(e);
    if(e===want) break;
  }
  const total=list.length;
  const totalMins=list.reduce((m,e)=>m+eventMinutes(e),0);
  return {n, total, hours:mins/60, seasonHours:totalMins/60};
}
function goalieIceHours(uptoISO){
  if(!CAL || !Array.isArray(CAL.events)) return null;
  const g=CAL.events.filter(isGoalieIce);
  const done=g.filter(e=>!uptoISO || String(e.date)<=uptoISO);
  return {sessions:done.length, hours:done.reduce((m,e)=>m+eventMinutes(e),0)/60,
          seasonSessions:g.length, seasonHours:g.reduce((m,e)=>m+eventMinutes(e),0)/60};
}
function fmtH(h){ return (Math.round(h*10)/10).toFixed(1).replace(/\.0$/,''); }
function looksLikeRoster(n){ return /^roster\.json$/i.test(n); }
// crest.png in that folder is the sheet's header mark. crest-front / crest-back
// override it per page when the two sides carry different lockups.
function crestRole(n){
  const m=String(n).match(/^crest(?:-(front|back))?\.(png|jpe?g|webp|gif)$/i);
  return m ? (m[1]||'both').toLowerCase() : null;
}
async function scanFolderForLines(dir){
  let lines=null, roster=null, cal=null; const crests={};
  for await (const [name,h] of dir.entries()){
    if(h.kind!=='file') continue;
    try{
      const role=crestRole(name);
      if(role){ crests[role]={name, file:await h.getFile()}; continue; }
      if(looksLikeCalendar(name)){ cal={name, file:await h.getFile()}; continue; }
      if(looksLikeLines(name)){
        const f=await h.getFile();
        // newest wins: a season's worth of exports can pile up in one folder
        if(!lines || f.lastModified>lines.file.lastModified) lines={name, file:f};
      } else if(looksLikeRoster(name)){
        roster={name, file:await h.getFile()};
      }
    }catch(e){}
  }
  return {lines, roster, crests, cal};
}
function fileToDataURL(f){
  return new Promise(res=>{ const r=new FileReader();
    r.onload=()=>res(r.result); r.onerror=()=>res(null); r.readAsDataURL(f); });
}
// Applied only when the file on disk is newer than the one already held, so a
// crest you uploaded by hand is not overwritten on every load.
async function applyFolderCrests(crests){
  if(!crests) return false;
  const pick=(role)=>crests[role]||crests.both||null;
  let changed=false;
  for(const which of ['f','b']){
    const c=pick(which==='f'?'front':'back');
    if(!c) continue;
    const stamp=which==='f'?'atF':'atB';
    const sel=()=> which==='b'?sheetLogoB:sheetLogoF;
    if(SHEET_UP[stamp] && c.file.lastModified<=SHEET_UP[stamp]){
      // Same file we already hold - but make sure it is still the one chosen.
      // Restoring a board flips the picker back to whatever that board saved,
      // and skipping here left the crest in storage and off the sheet.
      if(SHEET_UP[which] && sel()!=='upload'){
        if(which==='b') sheetLogoB='upload'; else sheetLogoF='upload';
        changed=true;
      }
      continue;
    }
    const url=await fileToDataURL(c.file);
    if(!url) continue;
    SHEET_UP[which]=url; SHEET_UP[stamp]=c.file.lastModified;
    if(which==='b') sheetLogoB='upload'; else sheetLogoF='upload';
    changed=true;
  }
  // A folder that names a front crest and no back one is saying the two pages
  // carry different marks. If the back is still holding the front's picture -
  // from back when a single crest.png drove both - hand it back to the centre
  // logo rather than printing the same lockup twice.
  if(crests.front && !crests.back && !crests.both &&
     sheetLogoB==='upload' && SHEET_UP.b && SHEET_UP.b===SHEET_UP.f){
    sheetLogoB='centre'; SHEET_UP.b=null; SHEET_UP.atB=0; changed=true;
  }
  if(changed){ saveSheetLogos(); buildSheetLogoSels(); }
  return changed;
}
// quiet: the silent look on load. Loud: the button was pressed and should say
// what it found, or admit it found nothing.
async function tryFolderLines(quiet){
  const dir=await libGet(); if(!dir) return false;
  try{ if(await dir.queryPermission({mode:'read'})!=='granted'){
    if(quiet) return false;                       // never prompt on page load
    if(await dir.requestPermission({mode:'read'})!=='granted') return false;
  } }catch(e){ return false; }
  let found=null;
  try{ found=await scanFolderForLines(dir); }catch(e){ return false; }
  if(!found) return false;
  if(found.cal){
    try{
      const o=JSON.parse(await found.cal.file.text());
      if(o && Array.isArray(o.events)){ CAL=o; updateIceCount(); }
    }catch(e){}
  }
  const crested=await applyFolderCrests(found.crests);
  if(!found.lines){
    if(crested && !quiet) toast('Crest read from '+dir.name);
    return crested;
  }
  // Already holding this one: a reload should not keep re-reading the same file.
  if(quiet && LINES.days && LINES.at && found.lines.file.lastModified<=LINES.at) return false;
  const got=[];
  try{
    const o=JSON.parse(await found.lines.file.text());
    if(takeLinesFile(o, found.lines.name)){ LINES.at=found.lines.file.lastModified; got.push('lines'); }
  }catch(e){}
  if(found.roster){
    try{ const r=JSON.parse(await found.roster.file.text());
      if(takeLinesFile(r, found.roster.name)) got.push('roster'); }catch(e){}
  }
  if(!got.length) return false;
  saveLines(); linesNote(); buildSessionSel(); updateLinesState();
  if(!quiet){
    const d=shDateValue(), hit=linesForDate(d);
    toast(got.join(' and ')+' read from '+dir.name+(hit?' — '+hit.key+' is on the sheet':
      (d?' — nothing saved for '+d:'')));
  }
  return true;
}
// One picker, both files: the export has days, the roster has players, so there
// is nothing to choose between and no wrong order to get them in.
function takeLinesFile(obj, fname){
  if(obj && obj.days && typeof obj.days==='object'){
    // lockedDays travels with the export. A locked day is one Josh has called
    // final, so the sheet can say so - and, more usefully, can say when it has
    // NOT been called yet and the lines may still move under you.
    LINES.days=obj.days; LINES.locked=obj.lockedDays||{}; LINES.from=fname; return 'lines';
  }
  if(obj && Array.isArray(obj.players)){
    const map={};
    obj.players.forEach(p=>{ if(p&&p.id) map[p.id]={num:p.num||'', name:p.name||''}; });
    LINES.roster=map; LINES.rosterFrom=fname; return 'roster';
  }
  return null;
}
// The card keys a day by its date, with a suffix for the other sessions: the
// bare date is Ice 1, '#ice2' the second ice time, '#off' the off-ice. Josh's
// Wednesday has two ice times and the lines differ between them, so the sheet
// has to say which one it is printing.
const SESS_NAME={'':'Ice 1', 'ice2':'Ice 2', 'off':'Off-ice'};
function sessionLabel(key){ const s=String(key||'').split('#')[1]||''; return SESS_NAME[s]||s||'Ice 1'; }
// The SCHEDULE decides how many ice times a day has. The line-up export only
// says which of them someone has written lines for - and on a day with no card
// yet, that used to leave the sheet with no session, no time and no count.
function sessionsForDate(iso){
  if(!iso) return [];
  const cal=teamIceSessions().filter(e=>e.date===iso);
  if(cal.length){
    return cal.slice(0,2).map((e,i)=>({
      key: i===0 ? iso : iso+'#ice2',
      id:  i===0 ? ''  : 'ice2',
      name:i===0 ? 'Ice 1' : 'Ice 2'
    }));
  }
  if(!LINES.days) return [];
  return Object.keys(LINES.days)
    .filter(k=>k===iso || k.indexOf(iso+'#')===0)
    .sort()
    .map(k=>({key:k, id:(k.split('#')[1]||''), name:SESS_NAME[k.split('#')[1]||'']||k.split('#')[1]}));
}
let sheetSession='';                 // '' = Ice 1, the card's own default
function linesForDate(iso){
  if(!LINES.days) return null;
  const list=sessionsForDate(iso);
  if(!list.length) return null;
  const want=list.find(s=>s.id===sheetSession) || list[0];
  // the schedule may name a session the card has no lines for
  if(!LINES.days[want.key]) return null;
  return {key:want.key, day:LINES.days[want.key], locked:!!(LINES.locked && LINES.locked[want.key])};
}
// Whether the day about to be printed has been called final. Josh locks a card
// once the lines are known, so locked means the paper will still be right at the
// rink; unlocked means they can still move and the sheet is a draft.
// The calendar knows when the ice is. Typing the date and then typing the time
// it already holds is work the app should not be asking for.
function calSessionFor(iso, sessionId){
  const list=teamIceSessions();
  const sameDay=list.filter(e=>e.date===iso);
  if(!sameDay.length) return null;
  return sessionId==='ice2' ? (sameDay[1]||sameDay[0]) : sameDay[0];
}
// Written the way Josh writes it: 1855-2010.
function calTimeFor(iso, sessionId){
  const e=calSessionFor(iso, sessionId);
  if(!e || !e.start || !e.end) return '';
  const strip=s=>String(s).replace(':','');
  return strip(e.start)+'-'+strip(e.end);
}
// Changing the date changes the time. That is the whole point - the calendar
// knows when the ice is, and a time left over from another day is just wrong.
//
// The one thing that survives is a time Josh typed FOR THIS DATE: he may know
// something the schedule does not. Type 1830-2000 on the 22nd and it stays on
// the 22nd; move to the 21st and the 21st's own time takes over.
// Keyed by date AND session, with the value, so leaving a session and coming
// back brings his time back rather than whatever the last session put there.
const TYPED_TIME={};
function timeKeyNow(){ return shDateValue()+'|'+sheetSession; }
function timeTypedByHand(){
  const el=document.getElementById('shTime'); if(!el) return;
  TYPED_TIME[timeKeyNow()]=el.value;
}
function fillTimeFromCalendar(){
  const el=document.getElementById('shTime'); if(!el) return;
  const mine=TYPED_TIME[timeKeyNow()];
  if(mine!=null){ if(el.value!==mine){ el.value=mine; updateMinsTotal(); } return; }
  const t=calTimeFor(shDateValue(), sheetSession);
  if(!t || el.value.trim()===t) return;
  el.value=t;
  updateMinsTotal();
  if(typeof autosave==='function') autosave();
}
function updateIceCount(){
  const el=document.getElementById('iceCount'); if(!el) return;
  const c=iceCountFor(shDateValue(), sheetSession);
  if(!c){ el.textContent=''; el.className='sh-note'; el.title=''; return; }
  fillTimeFromCalendar();
  el.textContent='ice #'+c.n+' · '+fmtH(c.hours)+' h';
  el.className='sh-note on';
  const g=goalieIceHours(shDateValue());
  el.title='Team ice session '+c.n+' of '+c.total+' this season, '+fmtH(c.hours)+
    ' hours to date of '+fmtH(c.seasonHours)+' scheduled'+
    (g?'. Goalie clinics are counted apart: '+g.sessions+' so far, '+fmtH(g.hours)+' h':'');
}
function updateLinesState(){
  // The ice count comes off the schedule and must not wait on a line-up card -
  // a practice with no lines set still happens, and still has a number.
  updateIceCount();
  const el=document.getElementById('linesState'); if(!el) return;
  el.className='sh-note';
  const d=shDateValue();
  if(!LINES.days || !d){ el.textContent=''; return; }
  const hit=linesForDate(d);
  if(!hit){ el.textContent='no lines for this date'; return; }
  el.textContent = sessionLabel(hit.key)+(hit.locked ? ' · FINAL — locked' : ' · not locked yet');
  el.classList.add(hit.locked?'final':'draft');
  el.title = hit.locked
    ? hit.key+' was called final in the line-up card'
    : hit.key+' is still open in the line-up card — these lines can change';
}
// Only shown when the date actually holds more than one session - a picker with
// one thing in it is furniture.
function buildSessionSel(){
  const wrap=document.getElementById('shSessionWrap'), sel=document.getElementById('shSession');
  if(!wrap||!sel) return;
  const list=sessionsForDate(shDateValue());
  // Shown whenever the date has a card at all, not only when it has two. Hiding
  // it on a one-session day meant that on a two-session day Josh had no reason
  // to look for it, and a sheet went to paper as Ice 1.
  if(!list.length){ wrap.style.display='none'; sheetSession=''; updateLinesState(); return; }
  wrap.style.display='';
  sel.innerHTML=list.map(s=>'<option value="'+s.id+'">'+s.name+'</option>').join('');
  if(!list.some(s=>s.id===sheetSession)) sheetSession=list[0].id;
  sel.value=sheetSession;
  updateLinesState();
}
// Last name only. "Lucas Kornylo" is a cell and a half wide; "Kornylo" is who
// you are looking for when you glance down the sheet.
function lastName(n){
  const p=String(n||'').trim().split(/\s+/);
  return p.length>1 ? p.slice(1).join(' ') : (p[0]||'');
}
// The card gives each player TWO jersey slots - "8 colours, two per player" -
// so jersey[id] is an array like ["n",""], not a letter. Reading it as a letter
// found nothing and printed no colour at all, which is how Josh's first sheet
// came out plain.
function jerseyDots(v){
  const keys=Array.isArray(v) ? v.filter(Boolean) : (v?[v]:[]);
  const out=keys.slice(0,2).map(k=>{
    const c=JERSEY[k]; if(!c) return '';
    return '<i class="jz" style="background:'+(c.print||c.hex)+'" title="'+escapeHtml(c.n)+'"></i>';
  }).filter(Boolean).join('');
  // No jersey set: hold the space so the numbers still line up down the column.
  return out || '<i class="nj"></i>';
}
// A guest is someone the card invented for a day - "guest-cao" - and who is
// in no roster. Josh skated one for three practices and then not again.
function isGuestId(id){ return /^guest[-_]/i.test(String(id||'')); }
function playerCell(id){
  if(!id) return {num:'', last:''};
  const r=LINES.roster && LINES.roster[id];
  // A guest never reaches the roster, so without this the sheet printed the
  // card's internal key - "guest-cao" - at the rink, beside real names.
  if(!r && isGuestId(id)) return {num:'', last:prettyGuest(id)};
  if(!r) return {num:'', last:id};   // no roster loaded: the card's own key still reads
  return {num:r.num||'', last:lastName(r.name)||r.num||id};
}
function prettyGuest(id){
  const raw=String(id).replace(/^guest[-_]/i,'').replace(/[-_]+/g,' ').trim();
  return raw.replace(/\b[a-z]/g, c=>c.toUpperCase()) || 'Guest';
}
let _logoTarget='f';
function wireSheetLogos(){
  const file=document.getElementById('shLogoFile');
  [['shLogoF','f'],['shLogoB','b']].forEach(([id,which])=>{
    const sel=document.getElementById(id); if(!sel||!file) return;
    sel.onchange=()=>{
      if(sel.value==='pick'){ _logoTarget=which; file.click();
        sel.value = which==='b'?sheetLogoB:sheetLogoF; return; }
      if(which==='b') sheetLogoB=sel.value; else sheetLogoF=sel.value;
      saveSheetLogos(); autosave();
    };
  });
  if(file) file.onchange=e=>{
    const f=e.target.files[0]; if(!f) return;
    const r=new FileReader();
    r.onload=()=>{
      SHEET_UP[_logoTarget]=r.result;
      if(_logoTarget==='b') sheetLogoB='upload'; else sheetLogoF='upload';
      saveSheetLogos(); buildSheetLogoSels(); autosave();
      toast('Crest set for the '+(_logoTarget==='b'?'back':'front')+' page');
    };
    r.readAsDataURL(f); e.target.value='';
  };
}
function sheetDate(iso){
  if(!iso) return '';
  const p=iso.split('-'); if(p.length!==3) return iso;
  const d=new Date(+p[0], +p[1]-1, +p[2]);
  if(isNaN(d)) return iso;
  return d.toLocaleDateString(undefined,{weekday:'short', month:'short', day:'numeric', year:'numeric'});
}
// Down to print size rather than shipping eight 2400px pictures into the sheet.
// Nothing on paper beats a 1100px box four inches wide, and a sheet of
// full-size shots takes seconds to open.
function shrinkShot(full, W){
  W=W||1100;
  const H=Math.max(1, Math.round(full.height*(W/full.width)));
  const c=document.createElement('canvas'); c.width=W; c.height=H;
  const cx=c.getContext('2d'); cx.fillStyle='#FFFFFF'; cx.fillRect(0,0,W,H);
  cx.drawImage(full,0,0,W,H);
  return c.toDataURL('image/jpeg',0.86);
}
// An empty sheet of ice on the board's current surface, for the slots no drill
// has been drawn into yet.
function blankShot(){
  const savedPieces=pieces, savedPaths=paths;
  pieces=[]; paths=[];
  let url=null;
  try{ url=shrinkShot(boardShot()); }
  finally{ pieces=savedPieces; paths=savedPaths; render(); }
  return url;
}
function practiceSheet(){
  syncScene();
  // The session list and the lock line are built when the date or the lines
  // change. Printing is the moment they have to be right, so rebuild them here
  // too - a sheet that went to paper saying Ice 1 because a listener never
  // fired is the failure this is guarding.
  try{ buildSessionSel(); updateLinesState(); updateIceCount(); }catch(e){}
  const back=currentScene;
  const slots=[];
  for(let i=0;i<scenes.length;i++){
    loadScene(i);                       // each slot prints on its own surface and view
    const s=scenes[i];
    slots.push({n:i+1, name:s.name||('Drill '+(i+1)), notes:s.notes||'', equip:s.equip||'',
      mins:(parseInt(s.mins,10)||0), rest:s.rest, url:shrinkShot(boardShot())});
  }
  loadScene(back);

  // Always a full sheet. The template he prints is two pages of four rinks
  // whatever is on it, and a back page that stops halfway is a page he cannot
  // use at the rink - the empty ones are what tomorrow's drills get drawn on.
  const target=Math.max(8, Math.ceil(slots.length/4)*4);
  if(slots.length<target){
    const blank=blankShot();
    for(let i=slots.length;i<target;i++)
      slots.push({n:i+1, name:'', notes:'', equip:'', url:blank});
  }

  const h=sheetHead(), esc=escapeHtml;
  const drillTotal=slots.reduce((n,s)=>n+(s.mins||0),0);
  // The paper has to agree with the band, gap included, or the sheet in his
  // hand says 62 while the board said 72 and one of them is wrong at the rink.
  const _timed=slots.filter(s=>(s.mins||0)>0);
  let gapPrint=0; for(let i=0;i<_timed.length-1;i++) gapPrint+=restAfter(_timed[i]);
  const planTotal=drillTotal+gapPrint;
  const ice=iceCountFor(h.date, sheetSession);
  const pages=[]; for(let i=0;i<slots.length;i+=4) pages.push(slots.slice(i,i+4));
  // Page 1 states the practice; page 2 carries the lineup, blank to fill in at
  // the rink. That is what is on the back of the sheet he already uses.
  const LINEUP_COLS=['LW','C','RW','LD','RD','G'], LINEUP_ROWS=4;
  // Filled from the line-up card's export when it holds this date, blank when it
  // does not - a grid you can still write on beats a grid that is not there.
  const found=linesForDate(h.date);
  // Who is not skating. The card knows - Josh knew it off the top of his head
  // for Wednesday - and a sheet that lists the lines should say who is out of
  // them, or you count heads on the ice and come up short.
  const benchHTML=()=>{
    if(!found) return '';
    // Guests are not listed as NOT SKATING. A guest who stopped coming is not
    // an absence to explain to the team - he was never on the roster to be
    // missing from - and the card keeps carrying him forward on the bench long
    // after he is gone.
    const names=(found.day.benchOrder||[]).filter(id=>!isGuestId(id)).map(id=>{
      const p=playerCell(id);
      return (p.num?p.num+' ':'')+p.last;
    }).filter(Boolean);
    return names.length ? '<div class="bench"><b>NOT SKATING:</b> '+esc(names.join(' · '))+'</div>' : '';
  };
  const lineupHTML=()=>{
    let t='<table class="lineup">'+LINEUP_COLS.map(()=>'<col>').join('')+
      '<tr>'+LINEUP_COLS.map(c=>'<th>'+c+'</th>').join('')+'</tr>';
    for(let r=0;r<LINEUP_ROWS;r++){
      const row=LINE_ROWS[r]||[];
      t+='<tr>'+LINEUP_COLS.map((_,c)=>{
        const slot=row[c];
        const pid=(found && slot) ? (found.day.slots||{})[slot] : null;
        if(!pid) return '<td></td>';
        const p=playerCell(pid);
        return '<td>'+jerseyDots((found.day.jersey||{})[pid])+
          (p.num?'<b>'+esc(p.num)+'</b> ':'')+esc(p.last)+'</td>';
      }).join('')+'</tr>';
    }
    return t+'</table>';
  };
  // Laid out like the Publisher sheet Josh has always used: crest top left, the
  // TEAM/COACH/DATE/TIME box top right, big numbers down the left margin, and
  // each rink paired with a small title box above its ruled lines.
  // Enough rules to fill the tallest box; the box clips what it does not need.
  const RULE_ROWS=new Array(16).fill('<i></i>').join('');
  const fld=(lbl,val)=>'<div class="f"><b>'+lbl+':</b><span>'+esc(val)+'</span></div>';
  const hdr=(pno)=>{
    const crest = crestURL(pno===1?'f':'b');
    // Page 2 has no fields block to balance, so the mark is centred in the
    // space beside the lineup rather than pinned to the corner - which is
    // where a lone crest looks stranded.
    if(pno===2) return '<div class="hdr">'+
      '<div class="backmark">'+(crest?'<img class="crest big" src="'+crest+'">':'')+'</div>'+
      '<div class="rightcol">'+lineupHTML()+benchHTML()+
        (found?'<div class="lockmark'+(found.locked?' fin':'')+'">'+
          esc(sessionLabel(found.key))+' · '+
          (found.locked?'FINAL — LOCKED':'NOT LOCKED — lines may change')+'</div>':'')+
      '</div></div>';
    const right = pno===1
      ? '<div class="fields">'+fld('TEAM',h.team)+fld('COACH',h.coach)+
          fld('DATE',sheetDate(h.date))+
          fld('TIME',h.time+(planTotal?('   ('+planTotal+' min planned'+(gapPrint?', incl '+gapPrint+' between drills':'')+')'):''))+
          (ice?'<div class="f ice"><b>ON ICE:</b><span>Session '+ice.n+' of the season &nbsp;·&nbsp; '+
            fmtH(ice.hours)+' hours to date</span></div>':'')+'</div>'
      : ('<div class="rightcol">'+lineupHTML()+benchHTML()+
          // Which card this is, not just whether it was locked. Both of Josh's
          // Wednesday cards are locked, so "FINAL" alone let an Ice 1 sheet
          // pass for the afternoon one.
          (found?'<div class="lockmark'+(found.locked?' fin':'')+'">'+
            esc(sessionLabel(found.key))+' · '+
            (found.locked?'FINAL — LOCKED':'NOT LOCKED — lines may change')+'</div>':'')+
        '</div>');
    return '<div class="hdr">'+
      (crest?'<img class="crest" src="'+crest+'">':'<div class="crest"></div>')+
      right+
    '</div>';
  };
  const row=(s)=>'<div class="row">'+
      '<img class="rink" src="'+s.url+'">'+
      '<div class="col">'+
        // The big numbers down the margin were Josh's own marker pen on a blank
        // template, not part of the sheet. The slot number rides on the title
        // instead, which says the same thing and gives the rink the width back.
        // An unused slot gets the empty title box off the blank template.
        '<div class="ttl"><span class="tnm">'+(s.name?'<i>'+s.n+'.</i> '+esc(s.name):'&nbsp;')+'</span>'+
          (s.mins?'<b class="tmin">'+s.mins+' min</b>':'')+'</div>'+
        // Real ruled elements, not a background gradient. Chrome does not print
        // background graphics unless the user digs into More settings, so the
        // lines were on screen and gone on paper - which is exactly what Josh
        // saw when he said none of the typing was underlined.
        // Text first, rules after. Ruling the lines the typing sits on is what
        // made a sentence look struck through and the box look like striped
        // paper; the rules are for what gets written at the rink, so they start
        // where the typing stops.
        '<div class="lines">'+
          '<div class="txt"><div class="ntext">'+esc(s.notes)+'</div>'+
          (s.equip?'<div class="eq"><b>Equipment:</b> '+esc(s.equip)+'</div>':'')+
          '</div>'+
          '<div class="rules">'+RULE_ROWS+'</div>'+
        '</div>'+
      '</div></div>';
  const body=pages.map((pg,i)=>'<div class="page">'+hdr(i+1)+pg.map(row).join('')+'</div>').join('');
  const title=(h.team?h.team+' — ':'')+'Practice sheet'+(h.date?' '+h.date:'');

  const html='<!doctype html><html><head><title>'+esc(title)+'<\/title><style>'+
    // tighter top and bottom than sides: the dead band under the last rink was
    // page margin, not layout
    '@page{size:letter portrait;margin:8mm 10mm}'+
    '*{margin:0;padding:0;box-sizing:border-box}'+
    // print-color-adjust so the jersey squares and the title bars survive a
    // printer that would otherwise drop every filled area
    'html,body{width:100%;background:#fff;color:#111;'+
      'font:12px/1.35 system-ui,Segoe UI,Arial,sans-serif;'+
      'print-color-adjust:exact;-webkit-print-color-adjust:exact}'+
    '.page{position:relative;width:100%;page-break-after:always}'+
    '.page:last-child{page-break-after:auto}'+
    // header: crest left, the fields box right, nothing underlining the page
    '.hdr{display:flex;align-items:flex-start;gap:16px;margin-bottom:7px}'+
    // room for a wide lockup, not just a square crest
    '.crest{height:72px;width:auto;max-width:310px;flex:0 0 auto;object-fit:contain;object-position:left center}'+
    '.backmark{flex:1;display:flex;align-items:center;justify-content:center;min-width:0}'+
    '.crest.big{height:96px;width:auto;max-width:200px;flex:0 0 auto;object-position:center}'+
    // the fields are a bordered block on his sheet, one ruled cell per line
    '.fields{margin-left:auto;width:54%;font-size:11.5px;border:1px solid #111;border-bottom:0}'+
    '.f{display:flex;align-items:center;gap:6px;border-bottom:1px solid #111;'+
      'padding:2px 5px;min-height:19px}'+
    '.f b{width:50px;letter-spacing:.5px;flex:0 0 auto}'+
    '.f span{flex:1}'+
    // the running count reads as a note on the practice, not another blank to fill
    '.f.ice{background:#F2F5F7;font-size:10.5px}'+
    '.f.ice span{font-weight:700;letter-spacing:.2px}'+
    // page 2: the lineup grid, blank to fill in at the rink
    // table-layout:fixed, or the columns size themselves off their contents and
    // C and G come out half the width of LW with nothing in any of them
    // wider than the fields box on the front: a last name needs the room a bare
    // number did not
    '.lineup{margin-left:auto;width:72%;border-collapse:collapse;table-layout:fixed;font-size:9.5px}'+
    '.lineup col{width:16.666%}'+
    // Rows read down a column, so they share a left edge: the jersey squares
    // line up into a strip you can read the navy/white split off at a glance.
    // Centred, every square starts wherever its name length puts it.
    '.lineup th,.lineup td{border:1px solid #111;overflow:hidden;white-space:nowrap}'+
    '.lineup th{text-align:center;font-weight:800;letter-spacing:.6px;background:#F2F5F7;'+
      'height:15px;font-size:9.5px;padding:0 2px}'+
    '.lineup td{height:21px;text-align:left;padding:0 2px 0 3px;font-weight:600;color:#333;'+
      'font-size:9px;letter-spacing:-.1px}'+
    // the number carries the row; the surname is support
    '.lineup td b{font-weight:800;color:#111;font-size:9.5px;'+
      'font-variant-numeric:tabular-nums;display:inline-block;min-width:13px;text-align:right}'+
    '.lineup td:empty{background:#FCFDFD}'+
    // the card's own FINAL chip, carried onto the paper
    '.rightcol{margin-left:auto;width:72%}'+
    '.rightcol .lineup{width:100%;margin-left:0}'+
    '.bench{font-size:9px;padding:2px 0 0;color:#111}'+
    '.bench b{letter-spacing:.4px}'+
    '.lockmark{font-size:8px;font-weight:800;letter-spacing:.6px;'+
      'padding:1px 0 0;color:#8a8a8a;text-align:right}'+
    '.lockmark.fin{color:#111}'+
    // the jersey colour as a square beside the number, so it survives a mono
    // printer as a shape rather than vanishing into a grey cell
    '.jz{display:inline-block;width:6px;height:6px;border:1px solid #111;margin-right:3px;'+
      'vertical-align:baseline;print-color-adjust:exact;-webkit-print-color-adjust:exact}'+
    // a cell with no jersey still starts its number where the others do
    '.lineup td .nj{display:inline-block;width:6px;margin-right:3px}'+
    '.row{display:flex;align-items:stretch;gap:7px;margin-bottom:9px;page-break-inside:avoid}'+
    '.rink{width:62%;height:auto;border:1px solid #111;border-radius:12px;align-self:flex-start}'+
    // title box on top, ruled lines filling the rest - one block per rink
    '.col{flex:1;display:flex;flex-direction:column;min-width:0}'+
    '.ttl{border:1px solid #111;padding:2px 6px;font-weight:800;font-size:11px;'+
      'text-transform:uppercase;letter-spacing:.4px;line-height:1.25;'+
      'display:flex;justify-content:space-between;gap:8px;align-items:baseline}'+
    // The name wraps onto as many lines as it needs. It used to be cut with an
    // ellipsis, so "PP/PK- 1:30 OZ FO Win, play it live with line changes and
    // such" printed as "PP/PK- 1:30 OZ FO WIN, PLAY IT LIV..." - and the half
    // that says what to DO was the half that went. The box grows downward and
    // the ruled lines below take what is left, so a long name costs a line of
    // writing space rather than the type getting smaller.
    '.ttl .tnm{min-width:0;overflow-wrap:anywhere}'+
    '.ttl .tmin{flex:0 0 auto;font-size:10px;letter-spacing:.3px}'+
    '.ttl i{font-style:normal;color:#555}'+
    // 24px rules against 11px type. At 20px and 12px a sentence ran to three
    // ruled lines and the box read as striped paper rather than writing - too
    // many underlines per sentence. Smaller type fits more words on a line and
    // the wider pitch gives each line air.
    // height:0 with flex:1 - the box must take its height from the rink beside
    // it, not from the rules inside it. Sized by content, sixteen rules made
    // every row taller than its own diagram.
    '.lines{flex:1 1 0;height:0;border:1px solid #111;border-top:0;padding:3px 6px 0;'+
      'overflow:hidden;display:flex;flex-direction:column;line-height:15px;font-size:11px}'+
    // takes whatever height the typing leaves, and clips the rules it cannot fit
    '.rules{flex:1;min-height:0;overflow:hidden;margin-top:4px}'+
    // Lighter than the type. At #111 the rule is the same weight as the words
    // and every line reads as struck through; a rule you write over has to sit
    // behind the ink, the way it does on paper.
    '.rules i{display:block;height:21px;border-bottom:1px solid #9AA7B2}'+
    '.txt{flex:0 0 auto}'+
    '.ntext{white-space:pre-wrap}'+
    '.eq{color:#1a5276}'+
    '<\/style><\/head><body>'+body+'<\/body><\/html>';
  showSheetPreview(html, safeFileName(title));
}
// The sheet used to open in a second window that printed itself. A blocked
// pop-up turned the whole feature into a toast - pressing the button appeared
// to do nothing - and you never saw the sheet before it went to paper. It is
// an iframe on this page now: you read it first, then print from the bar.
function showSheetPreview(html, fname){
  let ov=document.getElementById('sheetPrev');
  if(ov) ov.remove();
  ov=document.createElement('div');
  ov.id='sheetPrev';
  ov.innerHTML='<div class="sp-bar">'+
      '<span class="sp-ttl">Practice sheet</span>'+
      '<span class="sp-hint">Print sends it to paper. For a file, pick <b>Save as PDF</b> as the printer.</span>'+
      '<button class="tbtn" id="spPrint">🖨 Print / Save as PDF</button>'+
      '<button class="tbtn ghost" id="spClose">Close</button>'+
    '</div><div class="sp-body"><iframe id="spFrame" title="Practice sheet preview"><\/iframe><\/div>';
  document.body.appendChild(ov);
  const fr=ov.querySelector('#spFrame');
  fr.srcdoc=html;
  const close=()=>{ ov.remove(); document.removeEventListener('keydown',esc); };
  const esc=e=>{ if(e.key==='Escape') close(); };
  document.addEventListener('keydown',esc);
  ov.querySelector('#spClose').onclick=close;
  ov.querySelector('#spPrint').onclick=()=>{
    try{ fr.contentWindow.focus(); fr.contentWindow.print(); }
    catch(err){ toast('Could not open the print dialog'); }
  };
}
// =========================================================
//  DRILL LIBRARY — your saved drills, as pictures
// =========================================================
// "+ Add drill" opens a file picker, so you choose a drill by its filename and
// find out what it was after it lands. This grants the folder once, draws every
// drill in it, and lets you add the one you recognise.
//
// The folder handle goes in IndexedDB because a directory handle is not a
// string and localStorage only keeps strings. Chrome still asks to re-confirm
// the folder after a restart; that is the browser's call, not ours.
const LIB_DB='jmdd.lib.v1', LIB_STORE='handles', LIB_KEY='drillsDir';
function libIDB(){
  return new Promise((res,rej)=>{
    const r=indexedDB.open(LIB_DB,1);
    r.onupgradeneeded=()=>{ r.result.createObjectStore(LIB_STORE); };
    r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error);
  });
}
async function libPut(h){ const db=await libIDB(); return new Promise((res,rej)=>{
  const t=db.transaction(LIB_STORE,'readwrite'); t.objectStore(LIB_STORE).put(h,LIB_KEY);
  t.oncomplete=()=>res(); t.onerror=()=>rej(t.error); }); }
async function libGet(){ try{ const db=await libIDB(); return await new Promise((res,rej)=>{
  const t=db.transaction(LIB_STORE,'readonly'); const q=t.objectStore(LIB_STORE).get(LIB_KEY);
  q.onsuccess=()=>res(q.result||null); q.onerror=()=>rej(q.error); }); }catch(e){ return null; } }

// A thumbnail is the real board, drawn with that drill's pieces swapped in and
// put straight back - the same trick the empty rinks on the sheet use.
function drillThumb(scene){
  const savedP=pieces, savedT=paths, savedCfg=rinkConfig;
  let url=null;
  try{
    pieces=(scene.pieces||[]).map(p=>({...p}));
    paths=(scene.paths||[]).map(p=>({...p,_lut:null}));
    rinkConfig=scene.rinkType||'full';
    // 460 was fine for a 230px card and blurs the moment the card grows.
    url=shrinkShot(boardShot(), 760);
  }catch(e){ url=null; }
  finally{ pieces=savedP; paths=savedT; rinkConfig=savedCfg; render(); }
  return url;
}
async function readDrillFolder(dir){
  const out=[];
  for await (const [name,h] of dir.entries()){
    if(h.kind!=='file' || !/\.json$/i.test(name)) continue;
    try{
      const f=await h.getFile();
      const txt=await f.text();
      const o=JSON.parse(txt);
      const scenes0=(o && o.scenes && o.scenes.length) ? o.scenes
        : [{name:name.replace(/\.json$/i,''), rinkType:o.rinkConfig||'full', pieces:o.pieces||[], paths:o.paths||[]}];
      out.push({file:name, data:o, drills:scenes0, saved:f.lastModified||0});
    }catch(e){ /* a file that is not a drill is simply not shown */ }
  }
  return out.sort((a,b)=>a.file.localeCompare(b.file));
}
async function openLibrary(){
  let dir=await libGet();
  try{
    if(dir){
      const p=await dir.queryPermission({mode:'read'});
      if(p!=='granted'){
        const q=await dir.requestPermission({mode:'read'});
        if(q!=='granted') dir=null;
      }
    }
    if(!dir){
      if(!window.showDirectoryPicker){ toast('This browser cannot open a folder — use + Add drill'); return; }
      dir=await window.showDirectoryPicker({id:'drillsDir', mode:'read'});
      await libPut(dir);
      // Granting the folder here is the same grant Lines... needs, so take what
      // is in it now rather than making Josh press a second button to find out
      // the crest and the lines were sitting there all along.
      tryFolderLines(true).catch(()=>{});
    }
  }catch(err){
    if(err && err.name==='AbortError') return;      // cancelled: say nothing
    toast('Could not open that folder'); return;
  }
  toast('Reading '+dir.name+'…');
  const items=await readDrillFolder(dir);
  if(!items.length){ toast('No drill files in '+dir.name); return; }
  showLibrary(dir, items);
}
const LIBSIZE_KEY='jmdd.libsize.v1';
const LIBSORT_KEY='jmdd.libsort.v1';
// What a surface is called when it is a heading rather than a dropdown value.
const SURFACE_NAME={full:'Full sheet', half:'Half sheet', halves:'Two half sheets',
  halvesV:'Two half sheets vertical', twofull:'Two full sheets', field:'Grass field',
  iceplex:'KCI Iceplex'};
function showLibrary(dir, items){
  let ov=document.getElementById('libPanel'); if(ov) ov.remove();
  ov=document.createElement('div'); ov.id='libPanel';

  // One card per DRILL, not per file: a file holding four drills is four
  // things Josh might want, and he picks one of them.
  const cards=[];
  items.forEach((it,fi)=>{
    it.drills.forEach((d,di)=>{
      const nm=d.name||it.file.replace(/\.json$/i,'');
      cards.push({ fi, di, url:drillThumb(d),
        name:nm,
        label:(it.drills.length>1 ? nm+' · ' : '')+it.file.replace(/\.json$/i,''),
        file:it.file,
        saved:it.saved||0,
        surface:d.rinkType||'full' });
    });
  });

  const sizes={S:230, M:340, L:480};
  let size=localStorage.getItem(LIBSIZE_KEY); if(!sizes[size]) size='L';
  // Newest is the file's last-saved time. There is no creation date to be had
  // through a browser, and calling a save date "created" would be a small lie
  // that eventually costs Josh the drill he was looking for.
  const SORTS={az:'A–Z', newest:'Newest', oldest:'Oldest', surface:'Surface'};
  let sort=localStorage.getItem(LIBSORT_KEY); if(!SORTS[sort]) sort='az';
  let find='';

  const btn=(cls,k,txt,on)=>'<button class="'+cls+(on?' on':'')+'" data-k="'+k+'">'+txt+'</button>';
  ov.innerHTML='<div class="lib-bar"><span class="lib-ttl">Drill library</span>'+
      '<input id="libFind" class="libfind" type="search" placeholder="Find a drill…" autocomplete="off">'+
      '<span class="lib-hint" id="libCount"></span>'+
      '<span class="libseg" title="How the drills are ordered">Sort '+
        Object.keys(SORTS).map(k=>btn('libsort',k,SORTS[k],k===sort)).join('')+'</span>'+
      '<span class="libseg" title="How big the drill pictures are shown">Size '+
        Object.keys(sizes).map(k=>btn('libsize',k,k,k===size)).join('')+'</span>'+
      '<button class="tbtn ghost" id="libFolder">Change folder</button>'+
      '<button class="tbtn ghost" id="libClose">Close</button></div>'+
    '<div class="lib-grid"></div>';
  document.body.appendChild(ov);

  const grid=ov.querySelector('.lib-grid');
  const count=ov.querySelector('#libCount');
  const when=ms=>{ if(!ms) return ''; const d=new Date(ms);
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };

  function draw(){
    const q=find.trim().toLowerCase();
    let list=cards.filter(c=> !q || c.name.toLowerCase().includes(q) || c.file.toLowerCase().includes(q));
    const byName=(a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:'base',numeric:true});
    if(sort==='az') list.sort(byName);
    else if(sort==='newest') list.sort((a,b)=> b.saved-a.saved || byName(a,b));
    else if(sort==='oldest') list.sort((a,b)=> a.saved-b.saved || byName(a,b));
    else if(sort==='surface') list.sort((a,b)=>
      String(SURFACE_NAME[a.surface]||a.surface).localeCompare(SURFACE_NAME[b.surface]||b.surface) || byName(a,b));
    count.textContent=list.length+' of '+cards.length+' drill'+(cards.length===1?'':'s')+
      (q?' matching “'+find.trim()+'”':'')+' — click one to add it as a new tab';
    grid.innerHTML = list.length ? list.map(c=>
      '<button class="libcard" data-f="'+c.fi+'" data-d="'+c.di+'">'+
      (c.url?'<img src="'+c.url+'">':'<div class="libnone">no picture</div>')+
      '<span>'+escapeHtml(c.label)+
        '<i class="libmeta">'+escapeHtml(SURFACE_NAME[c.surface]||c.surface)+
        (c.saved?' · '+when(c.saved):'')+'</i></span></button>').join('')
      : '<p class="libempty">Nothing matches “'+escapeHtml(find.trim())+'”.</p>';
    grid.querySelectorAll('.libcard').forEach(b=>{
      b.onclick=()=>{
        const it=items[+b.dataset.f], di=+b.dataset.d;
        appendData({scenes:[it.drills[di]]}, it.file);   // one drill, not the file
        close();
      };
    });
  }
  const applySize=k=>{ grid.style.gridTemplateColumns='repeat(auto-fill,minmax('+sizes[k]+'px,1fr))'; };

  const close=()=>{ ov.remove(); document.removeEventListener('keydown',esc); };
  const esc=e=>{ if(e.key==='Escape'){ const f=ov.querySelector('#libFind');
    // Escape clears a search first, and only closes the panel when there is
    // nothing to clear - otherwise one key does two jobs and loses the list.
    if(f && f.value){ f.value=''; find=''; draw(); return; } close(); } };
  document.addEventListener('keydown',esc);
  ov.querySelector('#libClose').onclick=close;
  ov.querySelector('#libFolder').onclick=async()=>{
    try{
      const d=await window.showDirectoryPicker({id:'drillsDir', mode:'read'});
      await libPut(d); close();
      const got=await readDrillFolder(d);
      if(got.length) showLibrary(d,got); else toast('No drill files in '+d.name);
    }catch(e){ if(e && e.name!=='AbortError') toast('Could not open that folder'); }
  };
  ov.querySelectorAll('.libsize').forEach(b=>{ b.onclick=()=>{
    size=b.dataset.k; applySize(size);
    ov.querySelectorAll('.libsize').forEach(x=>x.classList.toggle('on',x===b));
    try{ localStorage.setItem(LIBSIZE_KEY,size); }catch(_){}
  }; });
  ov.querySelectorAll('.libsort').forEach(b=>{ b.onclick=()=>{
    sort=b.dataset.k;
    ov.querySelectorAll('.libsort').forEach(x=>x.classList.toggle('on',x===b));
    try{ localStorage.setItem(LIBSORT_KEY,sort); }catch(_){}
    draw();
  }; });
  const fi=ov.querySelector('#libFind');
  fi.oninput=()=>{ find=fi.value; draw(); };
  applySize(size); draw();
  setTimeout(()=>{ try{ fi.focus(); }catch(e){} }, 60);
}
// =========================================================
//  PRACTICES - every day, saved or still to build
// =========================================================
// The date box moves one day at a time and only tells you about a practice
// once you have guessed its date. Josh wants to jump around: see what was
// run, and see what is still to write. So this lists both - every practice
// file in the folder, and every team ice session on the calendar that has no
// practice yet.
function fmtDay(iso){
  const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(iso||''); if(!m) return iso||'';
  const d=new Date(+m[1], +m[2]-1, +m[3]);
  return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()]+' '+m[2]+'/'+m[3];
}
// Which number of the season each ice session is, counted the way the header
// counts it - every team ice session in date then start order, August included.
// Keyed by date|start so a day with two ice times gives two different numbers.
function seasonOrdinals(){
  const map=new Map(); let n=0;
  teamIceSessions().forEach(e=>{ map.set(e.date+'|'+String(e.start||''), ++n); });
  return {map, total:n};
}
// A saved practice says which session it is by the time in its header. "1855"
// matches the 18:55 ice; a file with no time, or one that matches nothing,
// falls back to the first session of that day rather than guessing.
function ordinalFor(ord, iso, timeStr){
  const day=teamIceSessions().filter(e=>e.date===iso);
  if(!day.length) return null;
  const want=String(timeStr||'').replace(/[^0-9]/g,'').slice(0,4);
  let hit=day[0];
  if(want) for(const e of day){ if(String(e.start||'').replace(':','')===want){ hit=e; break; } }
  return ord.map.get(hit.date+'|'+String(hit.start||'')) || null;
}
async function readPracticeFolder(dir){
  const out=[];
  for await (const [name,h] of dir.entries()){
    if(h.kind!=='file' || !looksLikePractice(name)) continue;
    const iso=(/\d{4}-\d{2}-\d{2}/.exec(name)||[''])[0];
    let drills=null, f=null, time='';
    try{
      f=await h.getFile();
      // Only the shape is wanted here, not the pictures - counting tabs off a
      // 1.3MB file for every row is why this reads the json and nothing else.
      const o=JSON.parse(await f.text());
      drills=(o.scenes||[]).length;
      // The practice's own time, which is how a day with two ice times says
      // WHICH of them this file is - and so which number of the season.
      time=(o.sheet&&o.sheet.time)||'';
    }catch(e){}
    out.push({name, iso, drills, time, file:f, saved:f?f.lastModified:0,
      size:f?f.size:0, base:name.replace(/\.json$/i,'')});
  }
  return out;
}
async function openPractices(){
  let dir=await libGet();
  try{
    if(dir){
      const p=await dir.queryPermission({mode:'read'});
      if(p!=='granted' && await dir.requestPermission({mode:'read'})!=='granted') dir=null;
    }
    if(!dir){
      if(!window.showDirectoryPicker){ toast('This browser cannot open a folder'); return; }
      dir=await window.showDirectoryPicker({id:'drillsDir', mode:'read'});
      await libPut(dir);
      tryFolderLines(true).catch(()=>{});
    }
  }catch(err){
    if(err && err.name==='AbortError') return;
    toast('Could not open that folder'); return;
  }
  let saved=[];
  try{ saved=await readPracticeFolder(dir); }catch(e){}
  showPractices(dir, saved);
}
function showPractices(dir, saved){
  let ov=document.getElementById('practicePanel'); if(ov) ov.remove();
  ov=document.createElement('div'); ov.id='practicePanel';
  // Newest first: the practice Josh wants is almost always a recent one, and
  // the future sits at the top where he is writing it.
  const byDay=new Map();
  saved.forEach(p=>{ if(!byDay.has(p.iso)) byDay.set(p.iso,[]); byDay.get(p.iso).push(p); });
  const rows=[];
  // Ice the calendar knows about that has nothing saved against it yet.
  teamIceSessions().forEach(e=>{
    if(byDay.has(e.date)) return;
    rows.push({iso:e.date, kind:'todo', ev:e, time:(e.start&&e.end)?(String(e.start).replace(':','')+'-'+String(e.end).replace(':','')):'' });
  });
  byDay.forEach((list,iso)=>{
    list.sort((a,b)=>b.saved-a.saved);
    rows.push({iso, kind:'saved', list});
  });
  rows.sort((a,b)=> String(b.iso).localeCompare(String(a.iso)));
  const ord=seasonOrdinals();
  const _t=new Date();
  const today=_t.getFullYear()+'-'+String(_t.getMonth()+1).padStart(2,'0')+'-'+String(_t.getDate()).padStart(2,'0');
  const html=rows.map((r,i)=>{
    const when=fmtDay(r.iso)+' <span class="pr-iso">'+r.iso+'</span>'+
      (r.iso===today?' <span class="pr-now">TODAY</span>':'');
    if(r.kind==='todo')
      return '<div class="prow prow-todo" data-i="'+i+'"><div class="pr-day">'+when+'</div>'+
        '<div class="pr-mid">no practice built'+(r.time?' · ice '+escapeHtml(r.time):'')+
        (function(){ const k=r.ev?ord.map.get(r.ev.date+'|'+String(r.ev.start||'')):null;
          return k?' · <b>#'+k+'</b> of '+ord.total:''; })()+'</div>'+
        '<button class="pr-go" data-build="'+i+'">Build it</button></div>';
    return '<div class="prow" data-i="'+i+'"><div class="pr-day">'+when+'</div>'+
      '<div class="pr-mid">'+r.list.map((p,j)=>
        '<button class="pr-file" data-open="'+i+'" data-j="'+j+'">'+
        escapeHtml(p.base)+'<span class="pr-meta">'+
        (function(){ const k=ordinalFor(ord, p.iso, p.time); return k?'#'+k+' · ':''; })()+
        (p.drills!=null?p.drills+' drill'+(p.drills===1?'':'s'):'?')+
        ' · '+Math.round(p.size/1024)+'KB</span></button>').join('')+'</div></div>';
  }).join('');
  ov.innerHTML='<div class="libwrap"><div class="libhead"><b>Practices</b>'+
    '<span class="libdir">'+escapeHtml(dir.name)+' · '+saved.length+' saved</span>'+
    '<button class="tbtn ghost" id="prClose">Close</button></div>'+
    '<div class="prlist">'+(html||'<p style="padding:14px">No practices and no ice on the calendar.</p>')+'</div>'+
    '<p class="prfoot">Opening a practice REPLACES the drills on the board. Build it just sets the date and time — your drills stay.</p></div>';
  document.body.appendChild(ov);
  const close=()=>ov.remove();
  ov.querySelector('#prClose').onclick=close;
  ov.onclick=e=>{ if(e.target===ov) close(); };
  ov.querySelectorAll('.pr-file').forEach(b=>{
    b.onclick=async()=>{
      const r=rows[+b.dataset.open], p=r.list[+b.dataset.j];
      const n=scenes.length;
      if(!confirm('Open "'+p.base+'"?\n\nThis REPLACES the '+n+' drill'+(n===1?'':'s')+
        ' on the board. Save first if you have not.')) return;
      try{
        keepBeforeWipe();
        const o=JSON.parse(await p.file.text());
        o.fileName=p.base;
        loadData(o);
        close();
        if(typeof offerDayPractice==='function') offerDayPractice().catch(()=>{});
      }catch(e){ toast('Could not open that practice'); }
    };
  });
  // A future day with no practice: point the header at it and leave the board
  // alone. That IS writing the future - the drills come next, from Josh.
  ov.querySelectorAll('.pr-go').forEach(b=>{
    b.onclick=()=>{
      const r=rows[+b.dataset.build];
      const dEl=document.getElementById('shDate'); if(dEl){ dEl.value=r.iso; dEl.dispatchEvent(new Event('change')); }
      close();
      toast(fmtDay(r.iso)+' — header set. The drills on the board are untouched.');
    };
  });
}
// Guarded: app.js is loaded by Film Room too, and that page has no sheet button.
// An unguarded onclick here would throw on load and take the whole clip page down.
const _sheetBtn=document.getElementById('sheetBtn');
if(_sheetBtn){
  _sheetBtn.onclick=practiceSheet;
  loadSheetLogos(); buildSheetLogoSels(); wireSheetLogos();
  loadLines(); linesNote();
  // A silent look in the granted folder on the way in: if a newer export is
  // sitting there, the sheet is right before you have touched anything. No
  // prompt - permission that is not already given is left alone.
  setTimeout(()=>{ tryFolderLines(true).catch(()=>{}); }, 400);
  // the sessions on offer follow the date on the sheet
  const _shDate=document.getElementById('shDate');
  // 'input' as well as 'change': a date typed rather than picked only fires
  // change on blur, and until then the session list belongs to the old date.
  // Debounced: a typed date fires per keystroke, and each check walks the
  // folder. A picked date settles well inside this.
  let _offerT=null;
  const _offerSoon=()=>{ clearTimeout(_offerT); _offerT=setTimeout(()=>{ offerDayPractice().catch(()=>{}); }, 350); };
  if(_shDate){ _shDate.addEventListener('change', buildSessionSel);
    _shDate.addEventListener('input', buildSessionSel);
    _shDate.addEventListener('change', _offerSoon);
    _shDate.addEventListener('input', _offerSoon); }
  // The offer never opens anything on its own. Opening a practice throws away
  // the drills on the board, so it is a click and then a question - and the
  // board goes into the autosave history first either way.
  on('openDayBtn','click', async function(){
    const hit=_dayOffer; if(!hit) return;
    const base=hit.name.replace(/\.json$/i,'');
    const n=scenes.length;
    if(!confirm('Open "'+base+'"?\n\nThis REPLACES the '+n+' drill'+(n===1?'':'s')+
      ' on the board with that practice. Save first if you have not.')) return;
    try{
      keepBeforeWipe();
      const o=JSON.parse(await hit.file.text());
      o.fileName=base;
      loadData(o);
      offerDayPractice().catch(()=>{});
    }catch(e){ toast('Could not open that practice'); }
  });
  setTimeout(()=>{ offerDayPractice().catch(()=>{}); }, 700);
  const _shSess=document.getElementById('shSession');
  if(_shSess) _shSess.addEventListener('change', ()=>{ sheetSession=_shSess.value; updateLinesState(); updateIceCount(); autosave(); });
  buildSessionSel();
  const _libBtn=document.getElementById('libBtn');
  if(_libBtn) _libBtn.onclick=openLibrary;
  const _prBtn=document.getElementById('practiceBtn');
  if(_prBtn) _prBtn.onclick=()=>{ openPractices().catch(()=>toast('Could not read the folder')); };
  const _linesClear=document.getElementById('linesClear');
  if(_linesClear) _linesClear.onclick=clearLines;
  const _linesBtn=document.getElementById('linesBtn');
  const _linesFile=document.getElementById('linesFile');
  if(_linesBtn && _linesFile){
    // The folder first, the picker only if it comes up empty.
    _linesBtn.onclick=async()=>{
      if(await tryFolderLines(false)) return;
      _linesFile.click();
    };
    _linesFile.onchange=e=>{
      const files=[...e.target.files]; if(!files.length) return;
      let got=[], bad=0, left=files.length;
      files.forEach(f=>{
        const r=new FileReader();
        r.onload=()=>{
          let o=null;
          try{ o=JSON.parse(r.result); }catch(err){}
          const kind=o?takeLinesFile(o,f.name):null;
          if(kind) got.push(kind); else bad++;
          if(--left===0){
            saveLines(); linesNote(); buildSessionSel();
            if(got.length){
              const d=shDateValue();
              const hit=linesForDate(d);
              const many=sessionsForDate(d).length>1 ? ' ('+sessionsForDate(d).length+' sessions — pick one)' : '';
              toast(got.join(' and ')+' loaded'+(hit?' — '+hit.key+' is on the sheet'+many:
                (d?' — nothing saved for '+d+' yet':'')));
            } else toast('That file is not the line-up export or the roster');
          }
        };
        r.readAsText(f);
      });
      e.target.value='';
    };
  }
}
function shDateValue(){ const el=document.getElementById('shDate'); return el?el.value:''; }
['shTeam','shCoach','shDate','shTime'].forEach(i=>{
  const el=document.getElementById(i); if(el) el.addEventListener('input', autosave);
});

// =========================================================
//  BOOT
// =========================================================
function resize(){ if(cv.clientWidth<1||cv.clientHeight<1) return; DPR=Math.min(window.devicePixelRatio||1,2);
  cv.width=cv.clientWidth*DPR; cv.height=cv.clientHeight*DPR;
  if(!camMoved && lastFit) fitRect(lastFit);
  render(); }
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

// =========================================================
//  AUTOSAVE
// =========================================================
// A board lived only in the tab until someone remembered to Save. Close it,
// reload it, or let the machine sleep it away and the work was gone - which is
// exactly what happened to the first DZ faceoff board on 2026-09-03.
//
// This is a SAFETY NET, not a filing system. It keeps ONE board - whatever was
// last on screen - in browser storage, and offers it back on the next load. It
// is not a substitute for Save: browser storage is per-browser, per-machine, and
// is cleared by anything that clears site data. The offer says so.
const AUTOSAVE_KEY='jmdd.autosave.v1';
let _autosaveT=null;

function autosaveNow(){
  // Telestration over a clip is skipped. The video is not stored, so restoring
  // the marks alone would drop a set of arrows onto an empty stage and look
  // like the app had lost the clip.
  if(rinkConfig==='video') return;
  try{
    const d=buildDrillData();
    const hasWork=d.scenes.some(s=>(s.pieces&&s.pieces.length)||(s.paths&&s.paths.length));
    // An empty board must CLEAR the snapshot, not preserve the last one. Otherwise
    // clearing the ice and starting fresh would still offer yesterday's board back
    // on the next load, which reads as the app ignoring you.
    if(!hasWork){ localStorage.removeItem(AUTOSAVE_KEY); return; }
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({at:Date.now(), data:d}));
    pushHistory(d);
  }catch(e){
    // Private windows and a full quota both throw. An autosave that cannot write
    // must never interrupt the drawing - it is the backup, not the work.
  }
}
// ---- autosave history -----------------------------------------------------
// One slot was one slot too few. The autosave fires two seconds AFTER a change,
// so anything that empties the board - Demo drill did it, Clear drill and Open
// still do - overwrites the only copy of what was there a moment earlier.
// Josh lost a drill to exactly that. So keep the last few boards, newest last,
// and offer them.
const HIST_KEY='jmdd.autosave.history.v1';
const HIST_MAX=10, HIST_BYTES=2500000;   // well inside a 5MB origin quota
function readHistory(){
  try{ const a=JSON.parse(localStorage.getItem(HIST_KEY)||'[]'); return Array.isArray(a)?a:[]; }
  catch(e){ return []; }
}
function pushHistory(d){
  try{
    const json=JSON.stringify(d);
    const hist=readHistory();
    // No point keeping the same board twice; a drag that changed nothing is not
    // a version.
    if(hist.length && hist[hist.length-1].json===json) return;
    hist.push({at:Date.now(), json});
    while(hist.length>HIST_MAX) hist.shift();
    // Trim by size too: eight drills with images can be large, and a quota
    // error would take the whole autosave down with it.
    let total=hist.reduce((n,h)=>n+h.json.length,0);
    while(hist.length>1 && total>HIST_BYTES){ total-=hist.shift().json.length; }
    localStorage.setItem(HIST_KEY, JSON.stringify(hist));
  }catch(e){
    // Out of room: drop the oldest and let the next write try again. The board
    // on screen is never affected by a failed backup.
    try{ const h=readHistory(); h.shift(); localStorage.setItem(HIST_KEY, JSON.stringify(h)); }catch(_){}
  }
}
// Before anything that empties or replaces the board, write what is there NOW -
// ahead of the debounce, which would otherwise only ever capture the aftermath.
function keepBeforeWipe(){ try{ autosaveNow(); }catch(e){} }
// Debounced, because pushUndo fires on every drag of every piece.
function autosave(){ clearTimeout(_autosaveT); _autosaveT=setTimeout(autosaveNow, 2000); }
// Last chance on the way out, ahead of the debounce.
window.addEventListener('beforeunload', autosaveNow);
// A tab hidden on a phone or iPad may never get beforeunload at all.
document.addEventListener('visibilitychange', ()=>{ if(document.hidden) autosaveNow(); });

function _agoText(ms){
  const m=Math.round((Date.now()-ms)/60000);
  if(m<1) return 'a moment ago';
  if(m<60) return m+' minute'+(m===1?'':'s')+' ago';
  const h=Math.round(m/60);
  if(h<24) return h+' hour'+(h===1?'':'s')+' ago';
  return new Date(ms).toLocaleString();
}

// Offered, never applied silently. Restoring over a board someone had just
// started would be a second way to lose work, and the whole point here is to
// stop losing work.
function offerRestore(){
  let raw=null;
  try{ raw=localStorage.getItem(AUTOSAVE_KEY); }catch(e){ return; }
  if(!raw) return;
  let snap=null;
  try{ snap=JSON.parse(raw); }catch(e){ try{ localStorage.removeItem(AUTOSAVE_KEY); }catch(_){} return; }
  if(!snap || !snap.data || !snap.data.scenes) return;

  const n=snap.data.scenes.length;
  const names=snap.data.scenes.map(s=>s.name).filter(Boolean).slice(0,3).join(', ');

  const bar=document.createElement('div');
  bar.style.cssText='position:fixed;left:50%;transform:translateX(-50%);bottom:18px;z-index:9999;'+
    'background:#0C2233;border:1px solid #2A6E86;border-radius:10px;padding:10px 14px;'+
    'display:flex;gap:12px;align-items:center;flex-wrap:wrap;max-width:min(680px,94vw);'+
    'box-shadow:0 12px 34px rgba(0,0,0,.45);color:#E8F3F6;'+
    'font:13px/1.35 "Segoe UI",system-ui,-apple-system,Arial,sans-serif';
  const txt=document.createElement('div');
  txt.innerHTML='<b>You have an unsaved board</b> from '+_agoText(snap.at)+
    ' &mdash; '+n+' drill'+(n===1?'':'s')+(names?' ('+names+')':'')+
    '<div style="opacity:.7;font-size:11px;margin-top:2px">Kept in this browser only. Save it to a file to keep it properly.</div>';
  const yes=document.createElement('button');
  yes.textContent='Restore it';
  yes.style.cssText='background:#5BC2D6;color:#04141c;border:0;border-radius:999px;'+
    'padding:.45em 1.1em;font-weight:700;cursor:pointer;font:inherit;font-weight:700';
  const no=document.createElement('button');
  no.textContent='Discard';
  no.style.cssText='background:none;color:#9DBCCB;border:1px solid #2A6E86;border-radius:999px;'+
    'padding:.45em 1em;cursor:pointer;font:inherit';
  yes.onclick=()=>{ bar.remove(); try{ loadData(snap.data); }catch(e){ toast('Could not restore that board'); } };
  no.onclick =()=>{ bar.remove(); try{ localStorage.removeItem(AUTOSAVE_KEY); }catch(e){} };
  bar.appendChild(txt); bar.appendChild(yes);

  // Earlier boards, when there are any older than the one being offered. This is
  // the way back from a wipe: the newest copy is the aftermath, the one before
  // it is the work.
  const hist=readHistory().filter(h=>h.at < snap.at - 1000);
  if(hist.length){
    const more=document.createElement('button');
    more.textContent='Earlier… ('+hist.length+')';
    more.style.cssText='background:none;color:#9DBCCB;border:1px solid #2A6E86;border-radius:999px;'+
      'padding:.45em 1em;cursor:pointer;font:inherit';
    more.onclick=()=>{ bar.remove(); showHistory(); };
    bar.appendChild(more);
  }
  bar.appendChild(no);
  document.body.appendChild(bar);
}
// A list of the boards this browser has held, newest first, each described by
// what is in it rather than by a timestamp alone.
function showHistory(){
  const hist=readHistory().slice().reverse();
  if(!hist.length){ toast('No earlier boards kept'); return; }
  let ov=document.getElementById('histPanel'); if(ov) ov.remove();
  ov=document.createElement('div'); ov.id='histPanel';
  const rows=hist.map((h,i)=>{
    let d=null; try{ d=JSON.parse(h.json); }catch(e){}
    const sc=(d&&d.scenes)||[];
    const n=sc.length;
    const names=sc.map(s=>s.name).filter(Boolean).slice(0,4).join(', ');
    const marks=sc.reduce((a,s)=>a+((s.pieces||[]).length+(s.paths||[]).length),0);
    return '<button class="histrow" data-i="'+i+'">'+
      '<b>'+_agoText(h.at)+'</b>'+
      '<span>'+n+' drill'+(n===1?'':'s')+' · '+marks+' piece'+(marks===1?'':'s')+
      (names?' · '+escapeHtml(names):'')+'</span></button>';
  }).join('');
  ov.innerHTML='<div class="lib-bar"><span class="lib-ttl">Earlier boards</span>'+
      '<span class="lib-hint">Kept in this browser only — newest first. Opening one replaces what is on screen.</span>'+
      '<button class="tbtn ghost" id="histClose">Close</button></div>'+
    '<div class="hist-list">'+rows+'</div>';
  document.body.appendChild(ov);
  const close=()=>{ ov.remove(); document.removeEventListener('keydown',esc); };
  const esc=e=>{ if(e.key==='Escape') close(); };
  document.addEventListener('keydown',esc);
  ov.querySelector('#histClose').onclick=close;
  ov.querySelectorAll('.histrow').forEach(b=>{
    b.onclick=()=>{
      const h=hist[+b.dataset.i];
      keepBeforeWipe();                       // the board on screen joins the list too
      try{ loadData(JSON.parse(h.json)); close(); }
      catch(e){ toast('Could not open that board'); }
    };
  });
}
offerRestore();

// Circle or triangle for skaters. Two buttons over one grid of positions rather
// than DrillChange's 24 - shape x colour x position is a lot of buttons, and the
// thumbnails already redraw so you can see the pairing you have chosen.
function buildShapeSwitch(){
  const host=document.getElementById('playerShapes');
  if(!host) return;
  host.innerHTML='';
  [['circle','Circle','<circle cx="12" cy="12" r="7.5" fill="currentColor"/>'],
   ['triangle','Triangle','<path d="M12 3.5l8.5 15h-17z" fill="currentColor"/>']
  ].forEach(([k,name,svg])=>{
    const b=document.createElement('button');
    b.type='button';
    b.className=(playerShape===k)?'on':'';
    b.title=name+' skaters';
    b.innerHTML='<svg viewBox="0 0 24 24" width="18" height="18" style="display:block">'+svg+'</svg>';
    b.style.cssText='display:inline-flex;align-items:center;justify-content:center;padding:4px 9px';
    b.onclick=()=>{ playerShape=k; buildShapeSwitch();
      fillTray('skaters',SKATERS); fillTray('positions',POSITIONS); };
    host.appendChild(b);
  });
}
buildShapeSwitch();

// Sheet-size picker. Built from RINK_SIZES so adding a size is one line there.
function buildRinkSizeSel(){
  const sel=document.getElementById('rinkSizeSel');
  if(!sel) return;
  sel.innerHTML='';
  Object.entries(RINK_SIZES).forEach(([k,d])=>{
    const o=document.createElement('option'); o.value=k; o.textContent=d.t;
    if(k===rinkSize) o.selected=true;
    sel.appendChild(o);
  });
  sel.onchange=()=>{ pushUndo(); setRinkSize(sel.value);
    toast(RINK_SIZES[rinkSize].t); };
}
buildRinkSizeSel();
