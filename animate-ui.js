/* ============================================================
   animate-ui.js — Klipdraw-Animate-style shell for JM Drill Draw
   Loads AFTER app.js. It never forks the engine; it wraps it.

   Provides:
     • File / Edit / View menus driving the engine's own buttons
     • A left tool rail with a contextual panel (Players / Objects / Tool)
     • A right Properties / Surface / Notes panel
     • A real keyframe timeline: one track per moving piece, bars you can
       drag to retime, diamonds for each puck pass, a draggable playhead.
   ============================================================ */
(function () {
  'use strict';

  var $ = function (i) { return document.getElementById(i); };
  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };

  // ---------------------------------------------------------
  // 1. Top-bar menus
  // ---------------------------------------------------------
  var menus = [].slice.call(document.querySelectorAll('[data-menu]'));
  function closeMenus() { menus.forEach(function (m) { m.classList.remove('open'); }); }
  menus.forEach(function (m) {
    m.querySelector('button').addEventListener('click', function (e) {
      e.stopPropagation();
      var was = m.classList.contains('open');
      closeMenus();
      if (!was) m.classList.add('open');
    });
  });
  document.addEventListener('click', closeMenus);

  // Menu items simply click the engine's own (hidden) buttons, so there is
  // exactly one implementation of every action.
  function relay(menuId, targetId) {
    var b = $(menuId);
    if (b) b.addEventListener('click', function () { closeMenus(); $(targetId).click(); });
  }
  relay('mFileNew', 'clearBtn');
  relay('mFileOpen', 'importBtn');
  relay('mFileSave', 'exportBtn');
  relay('mFileJpg', 'imgExportBtn');
  relay('mFileRec', 'recBtn');
  relay('mFilePrint', 'printBtn');
  relay('mFileDemo', 'demoBtn');
  relay('mEditUndo', 'undoBtn');
  relay('mEditRedo', 'redoBtn');
  relay('mEditStagger', 'staggerBtn');
  relay('mEditClear', 'clearBtn');
  relay('mViewFit', 'zfit');
  relay('mViewIn', 'zin');
  relay('mViewOut', 'zout');
  relay('mViewTheme', 'darkIceBtn');
  relay('mViewImg', 'imgBtn');

  // ---------------------------------------------------------
  // 2. Right panel tabs
  // ---------------------------------------------------------
  var rtabs = [].slice.call(document.querySelectorAll('.kd-rtabs button'));
  rtabs.forEach(function (b) {
    b.addEventListener('click', function () {
      var k = b.dataset.rtab;
      rtabs.forEach(function (x) { x.classList.toggle('on', x === b); });
      document.querySelectorAll('.kd-rtab').forEach(function (p) {
        p.classList.toggle('on', p.dataset.rtab === k);
      });
    });
  });
  function showPropsTab() {
    var b = document.querySelector('.kd-rtabs button[data-rtab="props"]');
    if (b && !b.classList.contains('on')) b.click();
  }

  // ---------------------------------------------------------
  // 3. Tool rail — add Players / Objects, keep panel in sync
  // ---------------------------------------------------------
  var railHost = $('tools');
  var panelTitle = $('kdPanelTitle');
  var toolName = $('kdToolName');
  var toolTip = $('kdToolTip');

  function railBtn(k, label, svg) {
    var b = document.createElement('button');
    b.className = 'tool';
    b.dataset.k = k;
    b.type = 'button';
    b.innerHTML = '<svg viewBox="0 0 24 24">' + svg + '</svg>' + label;
    return b;
  }

  var bPlayers = railBtn('players', 'Players',
    '<circle cx="9" cy="8" r="3.2" fill="none" stroke="currentColor" stroke-width="2"/>' +
    '<path d="M3.5 20c0-3.3 2.5-5.5 5.5-5.5s5.5 2.2 5.5 5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
    '<circle cx="17.5" cy="9" r="2.4" fill="none" stroke="currentColor" stroke-width="2"/>' +
    '<path d="M15 20c0-2.6 1.6-4.3 3.6-4.3S22 17.4 22 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>');
  var bObjects = railBtn('objects', 'Objects',
    '<rect x="3" y="13" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/>' +
    '<circle cx="17.5" cy="17" r="4" fill="none" stroke="currentColor" stroke-width="2"/>' +
    '<path d="M8 3l5 8H3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>');
  var div1 = document.createElement('div'); div1.className = 'kd-raildiv';

  railHost.insertBefore(div1, railHost.firstChild);
  railHost.insertBefore(bObjects, railHost.firstChild);
  railHost.insertBefore(bPlayers, railHost.firstChild);

  // a second divider after Select, so Select reads as its own group
  var selBtn = railHost.querySelector('.tool[data-k="select"]');
  if (selBtn && selBtn.nextSibling) {
    var div2 = document.createElement('div'); div2.className = 'kd-raildiv';
    railHost.insertBefore(div2, selBtn.nextSibling);
  }

  // the rail is icon-first, so every button gets a tooltip
  railHost.querySelectorAll('.tool').forEach(function (b) {
    if (!b.title) b.title = b.textContent.trim();
  });

  var TIPS = {
    select: 'Click to pick one piece. <b>Drag a box</b> over empty ice to grab several, <b>Shift-click</b> to add or remove. Drag any selected piece to move the whole group.',
    motion: 'The animation tool. <b>Drag from a piece</b> to draw where it travels, or click to add turns. Double-click or Enter to finish. Every route becomes a bar on the timeline.',
    skate: 'Draws a skating route. Diagram only — it does not move anything.',
    skateback: 'Draws a puck-carry route. Diagram only.',
    skaterev: 'Draws a backwards-skating route. Diagram only.',
    pass: 'Click to start a pass, click again to add a redirect, double-click or Enter to finish. Diagram only.',
    shot: 'Draws a shot line. Diagram only.',
    arrow: 'Draws a straight arrow. Diagram only.',
    web: 'Click each player (or each corner of a space), then Enter to close it. Joins every point to every other with hairlines over a faint blanket. <b>Dense mesh = bunched up. Sparse = space available.</b> Red for a problem, green for a chance.',
    cover: 'Circle one player, then circle who they cover — a thin line joins the two and follows them if you move either ring. Click a ring you already drew to link that one instead. <b>Esc</b> cancels a half-made pair.',
    ring: 'Drag a box to drop a hollow ring. Wide and short gives the flattened ellipse that sits right on the ice — put it under a player or on open space.',
    bar: 'Drag a short, thick straight segment. No arrowhead — for marking a gap, a line, or where someone stopped.',
    pen: 'Freehand draw anywhere — the fat lasso for circling an area of the ice.',
    text: 'Click anywhere — on or off the ice — to drop a label. Double-click a label to edit it.',
    pan: 'Drag to move the view around. Scroll or use the zoom buttons to change scale.',
    erase: 'Click any piece or line to delete it.',
    players: 'Pick a team colour, then a skater or position. Click the ice to place it — it keeps stamping until you press Esc. Type a <b>jersey number</b> first to use your own numbers; retype it between clicks to number a whole line-up.',
    objects: 'Nets, pucks, cones, tires, bumpers, dots. Click one, then click the ice to place it.'
  };
  var LABELS = { players: 'Players', objects: 'Objects' };
  TOOLS.forEach(function (t) { LABELS[t.k] = t.n; });

  function showPanel(k) {
    var sec = (k === 'players' || k === 'objects') ? k : 'tool';
    document.querySelectorAll('.kd-sec').forEach(function (s) {
      s.classList.toggle('on', s.dataset.sec === sec);
    });
    // The marks footer is sticky to the bottom of the panel, so it sits on top
    // of whatever is scrolled behind it — which was already burying Positions,
    // and the jersey-number box made the squeeze worse. None of it (mark
    // colour, weight, opacity, freeze) applies while you are placing players,
    // who take their colour from Team colour above. Objects still need it for
    // the mark palette, so it only steps aside here.
    var pfoot = document.querySelector('.kd-pfoot');
    if (pfoot) pfoot.style.display = (k === 'players') ? 'none' : '';
    panelTitle.textContent = LABELS[k] || 'Tool';
    if (sec === 'tool') {
      toolName.textContent = LABELS[k] || 'Tool';
      toolTip.innerHTML = TIPS[k] || '';
    }
  }

  function pickPalette(k) {
    setTool('select');
    railHost.querySelectorAll('.tool').forEach(function (b) {
      b.classList.toggle('on', b.dataset.k === k);
    });
    showPanel(k);
  }
  bPlayers.addEventListener('click', function () { pickPalette('players'); });
  bObjects.addEventListener('click', function () { pickPalette('objects'); });

  // ---------------------------------------------------------
  // 3a. Jersey number — put a chosen number on the next skater
  // ---------------------------------------------------------
  // Read at placement time rather than when the tool is armed, so a number
  // typed between two clicks applies to the second one. That means a line-up
  // goes: click Skater once, then type 17 · click, type 9 · click, type 4 ·
  // click — without re-arming anything.
  var numBox = $('playerNum'), numRow = numBox.parentNode;
  function numMark() { numRow.classList.toggle('set', !!numBox.value.trim()); }
  numBox.addEventListener('input', numMark);
  numBox.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { this.blur(); }
    if (e.key === 'Escape') { this.value = ''; numMark(); this.blur(); }
  });
  $('playerNumAuto').addEventListener('click', function () {
    numBox.value = ''; numMark(); numBox.focus();
  });

  var _addPiece = addPiece;
  addPiece = function (type, at, opts) {
    // Only a plain skater takes the typed number. The Positions buttons carry
    // their own label (F, C, LD…) and a paste carries the number it copied —
    // neither should be overwritten by whatever is sitting in the box.
    if (type === 'player' && (!opts || opts.num == null)) {
      var n = numBox.value.trim();
      if (n) { opts = Object.assign({}, opts || {}); opts.num = n; }
    }
    return _addPiece(type, at, opts);
  };

  // Wrap setTool so panel + rail stay in sync however the tool changed
  // (rail click, keyboard shortcut v/s/p/a, or the engine itself).
  var _setTool = setTool;
  setTool = function (k) {
    _setTool(k);
    showPanel(k);
  };

  // ---------------------------------------------------------
  // 3b. Mark colour + weight
  //
  // Colours and weights taken from the Klipdraw exports: saturated, fat, no
  // fills. Diagram hairlines vanish over footage.
  // ---------------------------------------------------------
  var MARK_COLOURS = [
    ['Black', '#111111'], ['Green', '#19CC4C'], ['Yellow', '#FFD100'],
    ['Sky blue', '#22A0E0'], ['Navy', '#1B3A9B'], ['Red', '#E8313A'],
    ['Orange', '#F2811D'], ['Magenta', '#D6259B'], ['White', '#FFFFFF']
  ];

  var cChip = $('colourChip'), cName = $('colourName'), cMenu = $('colourMenu');

  // A visible grid, not a dropdown: one click per colour instead of two.
  function paintColourMenu() {
    cMenu.innerHTML = MARK_COLOURS.map(function (c) {
      return '<button type="button" class="kd-sw' + (activeColor === c[1] ? ' on' : '') +
        '" data-col="' + c[1] + '" title="' + c[0] + '" style="background:' + c[1] + '"></button>';
    }).join('');
    cMenu.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        setMarkColour(b.dataset.col);
      });
    });
  }

  // Recently used colours, most recent first. Persisted so the row is still
  // useful next time the app opens; storage can throw in some contexts, so
  // every access is guarded and the row simply starts empty if it fails.
  var recent = [];
  try {
    var saved = localStorage.getItem('kd.recentColours');
    if (saved) recent = JSON.parse(saved).slice(0, 8);
  } catch (e) { recent = []; }

  function paintRecent() {
    var el = $('recentColours');
    $('recentLbl').style.display = recent.length ? '' : 'none';
    el.style.display = recent.length ? '' : 'none';
    el.innerHTML = recent.map(function (hex) {
      var name = (MARK_COLOURS.filter(function (c) { return c[1] === hex; })[0] || [hex])[0];
      return '<button type="button" class="kd-sw' + (activeColor === hex ? ' on' : '') +
        '" data-col="' + hex + '" title="' + name + '" style="background:' + hex + '"></button>';
    }).join('');
    el.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function (e) { e.stopPropagation(); setMarkColour(b.dataset.col); });
    });
  }

  function noteRecent(hex) {
    recent = [hex].concat(recent.filter(function (c) { return c !== hex; })).slice(0, 8);
    try { localStorage.setItem('kd.recentColours', JSON.stringify(recent)); } catch (e) { }
  }

  function setMarkColour(hex) {
    if (selSet.length) {
      // recolour what's selected rather than arming a colour nobody asked for
      pushUndo();
      selPieces().forEach(function (p) { p.color = hex; });
      selPaths().forEach(function (pa) { pa.color = hex; });
      render(); updateInspector();
    }
    activeColor = hex;
    var found = MARK_COLOURS.filter(function (c) { return c[1] === hex; })[0];
    cChip.style.background = hex;
    cName.textContent = found ? found[0] : hex;
    noteRecent(hex);
    paintColourMenu(); paintRecent();
    fillTray('equip', EQUIP); fillTray('positions', POSITIONS);
  }


  var wSlider = $('markWeight'), wPrev = $('markWPrev');
  var wDirty = false;   // one undo entry per drag, not one per pixel

  function applyWeight(v) {
    markW = v;
    wPrev.style.height = Math.max(2, v * 1.6).toFixed(1) + 'px';
    var ps = selPaths();
    if (ps.length) {
      // Apply live while dragging. Committing only on release made the slider
      // look broken: you'd drag it and nothing on the ice would move.
      if (!wDirty) { pushUndo(); wDirty = true; }
      ps.forEach(function (pa) { pa.w = v; });
      render();
      updateInspector();
    }
  }
  wSlider.addEventListener('pointerdown', function () { wDirty = false; });
  wSlider.addEventListener('keydown', function () { wDirty = false; });
  wSlider.addEventListener('input', function () { applyWeight(parseFloat(this.value)); });
  wSlider.addEventListener('change', function () { wDirty = false; });

  var oSlider = $('markOpacity'), oVal = $('markOpVal');
  var oDirty = false;
  function applyOpacity(pct) {
    markOp = pct / 100;
    oVal.textContent = Math.round(pct) + '%';
    var ps = selPaths();
    if (ps.length) {
      if (!oDirty) { pushUndo(); oDirty = true; }
      ps.forEach(function (pa) { pa.op = markOp; });
      render(); updateInspector();
    }
  }
  // How long a newly drawn mark stays up. Applies to the selection too, so you
  // can shorten a mark you've already drawn without hunting for its bar edge.
  var holdBtns = [].slice.call(document.querySelectorAll('#markHolds button'));
  holdBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      markHold = b.dataset.hold ? parseInt(b.dataset.hold, 10) : null;
      holdBtns.forEach(function (x) { x.classList.toggle('on', x === b); });
      var ps = selPaths().filter(function (p) { return !(p.motion || p.owner); });
      if (ps.length) {
        pushUndo();
        ps.forEach(function (p) {
          var rest = T - p.delay;
          p.dur = Math.max(300, markHold == null ? rest : Math.min(markHold, rest));
        });
        lastSig = ''; render(); updateInspector();
      }
    });
  });

  // Plays-on vs pauses, as a visible two-way choice. This was a checkbox at the
  // bottom of a long panel and simply wasn't being found.
  var modeBtns = [].slice.call(document.querySelectorAll('#markModes button'));
  function setFreezeMode(on, applyToSel) {
    markFreeze = !!on;
    $('markFreezeChk').checked = markFreeze;
    modeBtns.forEach(function (b) { b.classList.toggle('on', (b.dataset.freeze === '1') === markFreeze); });
    $('holdLbl').textContent = markFreeze ? 'Clip pauses for' : 'Mark stays up for';
    // "Rest" means "to the end of the clip" — as a pause that's a ten-second
    // hang that reads as a crash, so it's not offered while pausing.
    var restBtn = document.querySelector('#markHolds [data-hold=""]');
    restBtn.disabled = markFreeze;
    restBtn.style.display = markFreeze ? 'none' : '';
    if (markFreeze && markHold == null) {
      markHold = 2000;
      holdBtns.forEach(function (b) { b.classList.toggle('on', b.dataset.hold === '2000'); });
    }
    if (applyToSel) {
      var ps = selPaths().filter(function (p) { return !(p.motion || p.owner); });
      if (ps.length) {
        pushUndo();
        ps.forEach(function (p) {
          p.freeze = markFreeze;
          if (markFreeze && p.dur > 5000) p.dur = markHold || 2000;
        });
        lastSig = ''; render(); updateInspector();
      }
    }
  }
  modeBtns.forEach(function (b) {
    b.addEventListener('click', function () { setFreezeMode(b.dataset.freeze === '1', true); });
  });

  oSlider.addEventListener('pointerdown', function () { oDirty = false; });
  oSlider.addEventListener('keydown', function () { oDirty = false; });
  oSlider.addEventListener('input', function () { applyOpacity(parseFloat(this.value)); });
  oSlider.addEventListener('change', function () { oDirty = false; });

  // Keeping a newly drawn mark selected is the right default — it's how every
  // vector editor works and it lets you tweak what you just made. The hazard is
  // that these same controls double as "settings for the next mark", so changing
  // one silently edits the mark you just drew. Rather than remove the behaviour,
  // label which mode you're in and mirror the selected mark's own values here.
  function syncPanelToSelection() {
    var head = $('editHead');
    var ps = selPaths().filter(function (p) { return !(p.motion || p.owner); });
    if (!ps.length) {
      head.textContent = 'New marks';
      head.classList.remove('on');
      // Restore the controls to the NEW-MARK defaults. Without this they keep
      // showing whatever the last selected mark had, so the freeze box could
      // read unchecked while markFreeze was still true (and the reverse) —
      // you'd draw a mark whose settings did not match the panel.
      setFreezeMode(markFreeze, false);
      wSlider.value = markW;
      wPrev.style.height = Math.max(2, markW * 1.6).toFixed(1) + 'px';
      oSlider.value = Math.round(markOp * 100);
      oVal.textContent = Math.round(markOp * 100) + '%';
      holdBtns.forEach(function (b) {
        var v = b.dataset.hold ? parseInt(b.dataset.hold, 10) : null;
        b.classList.toggle('on', v === markHold);
      });
      return;
    }
    head.textContent = ps.length === 1
      ? 'Editing ' + (TYPE_LABEL[ps[0].type] || ps[0].type)
      : 'Editing ' + ps.length + ' marks';
    head.classList.add('on');

    // reflect the mark's own settings, without firing the input handlers
    var p = ps[0];
    wSlider.value = p.w || 1;
    wPrev.style.height = Math.max(2, (p.w || 1) * 1.6).toFixed(1) + 'px';
    var pct = Math.round((p.op == null ? 1 : p.op) * 100);
    oSlider.value = pct; oVal.textContent = pct + '%';
      setFreezeMode(!!p.freeze, false);
    var rest = T - (p.delay || 0);
    holdBtns.forEach(function (b) {
      var v = b.dataset.hold ? parseInt(b.dataset.hold, 10) : null;
      var match = v == null ? (p.dur >= rest - 60) : Math.abs(p.dur - Math.min(v, rest)) < 60;
      b.classList.toggle('on', match);
    });
    if (p.color) {
      cChip.style.background = p.color;
      var f = MARK_COLOURS.filter(function (c) { return c[1] === p.color; })[0];
      cName.textContent = f ? f[0] : p.color;
    }
  }

  var _updateInspector = updateInspector;
  updateInspector = function () {
    _updateInspector.apply(this, arguments);
    try { syncPanelToSelection(); } catch (e) { }
  };

  // ---------------------------------------------------------
  // 4. Timeline
  // ---------------------------------------------------------
  var grid = $('kdGrid');
  var ruler = $('kdRuler');
  var tracksEl = $('kdTracks');
  var namesEl = $('kdNames');
  var playhead = $('kdPlayhead');
  var trackInfo = $('kdTrackInfo');

  var ROW = 26;
  var rows = [];        // [{kind:'path'|'puck', path?, piece?}]
  var lastSig = '';
  var lastW = 0;
  var lastT = 0;

  // A five-minute clip squeezed into one screen width is about 250ms per pixel,
  // so isolating a few seconds means dragging a twelve-pixel gap and the two
  // trim handles sit on top of each other. The timeline has its own zoom: the
  // content is gridW() * tlZoom wide and the grid scrolls to it.
  var tlZoom = 1;
  function gridW() { return grid.clientWidth || 1; }
  function contentW() { return Math.max(gridW(), Math.round(gridW() * tlZoom)); }
  function maxZoom() { return Math.max(1, Math.min(120, 40000 / gridW())); }
  function msToX(ms) { return (ms / T) * contentW(); }
  function xToMs(x) { return (x / contentW()) * T; }
  // x measured against the content, so it stays right once the grid is scrolled
  function eventMs(e) {
    var x = e.clientX - grid.getBoundingClientRect().left + grid.scrollLeft;
    return xToMs(clamp(x, 0, contentW()));
  }
  function setZoom(z, anchorMs) {
    z = clamp(z, 1, maxZoom());
    if (Math.abs(z - tlZoom) < 0.001) return;
    var W = gridW();
    if (anchorMs == null) anchorMs = tNow;
    var heldAt = msToX(anchorMs) - grid.scrollLeft;      // where it sits on screen
    if (heldAt < 0 || heldAt > W) heldAt = W / 2;        // off screen: centre it
    tlZoom = z;
    syncTimeline(true);
    grid.scrollLeft = clamp(msToX(anchorMs) - heldAt, 0, Math.max(0, contentW() - W));
    movePlayhead(); layoutTrim();
  }

  // Every path gets a track now, not just the moving ones: a motion bar means
  // "the piece travels here", a mark's bar means "this drawing is on screen".
  function motionPaths() {
    return paths.slice();
  }
  function isMotion(p) { return !!(p.motion || p.owner); }

  var TYPE_LABEL = {
    ring: 'Ring', link: 'Cover', web: 'Web', bar: 'Bar', pen: 'Freehand', arrow: 'Arrow',
    pass: 'Pass', shot: 'Shot', skate: 'Skate', skateback: 'Puck carry',
    skaterev: 'Backwards', text: 'Text'
  };
  function puckPieces() {
    return pieces.filter(function (p) {
      return (p.type === 'puck' || p.type === 'ball') && p.legs && p.legs.length;
    });
  }

  function rowLabel(r) {
    if (r.kind === 'puck') return prettyType(r.piece.type);
    var p = r.path;
    if (!isMotion(p)) return TYPE_LABEL[p.type] || p.type;
    var owner = p.owner ? getPiece(p.owner) : null;
    if (!owner) return 'Motion';
    var n = (owner.num || '').toString().trim();
    return prettyType(owner.type) + (n ? ' ' + n : '');
  }
  function rowColor(r) {
    if (r.kind === 'puck') return r.piece.color || '#111418';
    return r.path.color || 'var(--accent)';
  }

  function signature() {
    // inMs/outMs belong here: without them, dragging a trim handle left the
    // track rebuild — and so the "N marks · … out" readout — showing stale
    // numbers that disagreed with the trim.
    var s = T + '|' + Math.round(inMs) + '|' + Math.round(outMs) + '|' +
      (sel ? sel.kind + sel.id : '-') + '|';
    motionPaths().forEach(function (p) {
      s += p.id + ',' + p.delay + ',' + p.dur + ',' + p.owner + ',' + p.color + ',' + (p.hidden ? 1 : 0) + ',' + (p.freeze ? 1 : 0) + ';';
    });
    s += '#';
    puckPieces().forEach(function (p) {
      s += p.id + ',' + p.legs.map(function (l) { return l.type + l.s; }).join('.') + ';';
    });
    return s;
  }

  // A 5-second drill and a 3-minute video clip both have to read well, so the
  // tick spacing is chosen from the total length rather than hard-coded.
  var STEPS = [100, 250, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000];
  function niceStep() {
    var want = clamp(Math.floor(contentW() / 110), 4, 400);
    var raw = T / want;
    for (var i = 0; i < STEPS.length; i++) if (STEPS[i] >= raw) return STEPS[i];
    return STEPS[STEPS.length - 1];
  }
  function fmtT(ms) {
    if (T < 60000) return (ms / 1000).toFixed(ms % 1000 ? 1 : 0) + 's';
    var s = Math.round(ms / 1000);
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }

  function buildRuler() {
    var W = contentW();
    ruler.style.width = W + 'px';
    var major = niceStep();
    var minor = major / 2;
    var h = '';
    for (var ms = 0; ms <= T + 1; ms += minor) {
      var x = (ms / T) * W;
      var isMajor = Math.abs(ms % major) < 1;
      h += '<div class="kd-tick' + (isMajor ? '' : ' minor') + '" style="left:' + x.toFixed(1) + 'px"></div>';
      if (isMajor) h += '<div class="kd-tlab" style="left:' + x.toFixed(1) + 'px">' + fmtT(ms) + '</div>';
    }
    ruler.innerHTML = h;
  }

  // Total real time the freezes add inside the trim window.
  function holdTotal() {
    return paths.filter(function (p) {
      return p.freeze && !p.hidden && !isMotion(p) && p.delay >= inMs && p.delay <= outMs;
    }).reduce(function (s, p) { return s + (p.dur || 0); }, 0);
  }

  function buildTracks() {
    var W = contentW();
    tracksEl.style.width = W + 'px';
    rows = [];
    rows.push({ kind: 'clip' });                       // the clip itself, always on top
    motionPaths().forEach(function (p) { rows.push({ kind: 'path', path: p }); });
    puckPieces().forEach(function (p) { rows.push({ kind: 'puck', piece: p }); });

    var nMarks = rows.length - 1;
    var holds = holdTotal();
    trackInfo.textContent = nMarks + (nMarks === 1 ? ' mark' : ' marks') + ' · ' +
      (holds
        ? fmtT(trimSpan()) + ' + ' + (holds / 1000).toFixed(1) + 's holds = ' + fmtT(trimSpan() + holds) + ' out'
        : fmtT(trimSpan()) + ' out');


    // gridlines on the same beat as the ruler
    var major = niceStep();
    var lines = '';
    for (var ms = major; ms < T; ms += major) {
      lines += '<div class="kd-gline" style="left:' + ((ms / T) * W).toFixed(1) + 'px"></div>';
    }

    var nh = '', th = '';
    rows.forEach(function (r, i) {
      if (r.kind === 'clip') {
        // The clip's own track. Its bar is the trim window; each freeze shows
        // as a stop marker, since on a clip-time axis a pause takes no clip
        // time at all — it just holds there for N seconds of real time.
        var cname = vidName ? vidName.replace(/\.[^.]+$/, '') : 'Drill';
        nh += '<div class="kd-name kd-cliprow"><span class="kd-chip" style="background:var(--accent)"></span>' +
          '<span class="kd-nm">' + cname + '</span></div>';
        var cl = (inMs / T) * W, cw = Math.max(4, ((outMs - inMs) / T) * W);
        var stops = '';
        paths.filter(function (p) {
          return p.freeze && !p.hidden && !isMotion(p) && p.delay >= inMs && p.delay <= outMs;
        }).forEach(function (p) {
          stops += '<div class="kd-stop" style="left:' + ((p.delay / T) * W).toFixed(1) + 'px"' +
            ' title="Clip pauses ' + (p.dur / 1000).toFixed(1) + 's here"><b>' +
            (p.dur / 1000).toFixed(1) + 's</b></div>';
        });
        th += '<div class="kd-track kd-cliptrack">' + lines +
          '<div class="kd-clipbar" style="left:' + cl.toFixed(1) + 'px;width:' + cw.toFixed(1) + 'px"></div>' +
          stops + '</div>';
        return;
      }
      var selected = sel && ((r.kind === 'path' && sel.kind === 'path' && sel.id === r.path.id) ||
        (r.kind === 'puck' && sel.kind === 'piece' && sel.id === r.piece.id));
      var hid = r.kind === 'path' && r.path.hidden;
      nh += '<div class="kd-name' + (selected ? ' on' : '') + (hid ? ' off' : '') + '" data-row="' + i + '">' +
        '<button class="kd-eye" data-eye="' + i + '" title="Show / hide this mark">' +
        (hid ? '&#9663;' : '&#9679;') + '</button>' +
        '<span class="kd-chip" style="background:' + rowColor(r) + '"></span>' +
        '<span class="kd-nm">' + rowLabel(r) + '</span>' +
        '<button class="kd-del" data-del="' + i + '" title="Delete this mark">&times;</button></div>';

      var inner = '';
      if (r.kind === 'path') {
        var p = r.path;
        var left = (p.delay / T) * W;
        var w = Math.max(10, (p.dur / T) * W);
        if (p.freeze) {
          // A pause takes no clip time, so it gets a marker at its instant —
          // not a bar, which would imply it covers that much footage.
          inner = '<div class="kd-frzmark' + (selected ? ' sel' : '') + '" data-row="' + i + '"' +
            ' style="left:' + left.toFixed(1) + 'px;background:' + (p.color || '#B9E60C') + '"' +
            ' title="Clip pauses ' + (p.dur / 1000).toFixed(1) + 's here — drag to move the moment">' +
            '<b>&#9208; ' + (p.dur / 1000).toFixed(1) + 's</b></div>';
        } else {
          inner = '<div class="kd-bar' + (selected ? ' sel' : '') + '" data-row="' + i + '"' +
            ' style="left:' + left.toFixed(1) + 'px;width:' + w.toFixed(1) + 'px;background:' +
            (p.color || '#B9E60C') + '">' +
            '<span class="kd-bt">' + (p.dur / 1000).toFixed(1) + 's</span>' +
            '<div class="kd-hand l" data-edge="l"></div><div class="kd-hand r" data-edge="r"></div></div>';
        }
      } else {
        r.piece.legs.forEach(function (l, li) {
          inner += '<div class="kd-key' + (selected ? ' sel' : '') + '" data-row="' + i + '" data-leg="' + li + '"' +
            ' title="' + (l.type === 'pass' ? 'Pass' : 'Carry') + ' at ' + (l.s / 1000).toFixed(1) + 's"' +
            ' style="left:' + ((l.s / T) * W).toFixed(1) + 'px;background:' +
            (l.type === 'pass' ? 'var(--accent)' : '#6d747d') + '"></div>';
        });
      }
      th += '<div class="kd-track" data-row="' + i + '">' + lines + inner + '</div>';
    });
    namesEl.innerHTML = nh;
    tracksEl.innerHTML = th;
    playhead.style.height = (22 + rows.length * ROW) + 'px';

    namesEl.querySelectorAll('.kd-name').forEach(function (el) {
      el.addEventListener('click', function () { selectRow(+el.dataset.row); });
    });
    namesEl.querySelectorAll('.kd-eye').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        var r = rows[+b.dataset.eye];
        if (!r || r.kind !== 'path') return;
        pushUndo();
        r.path.hidden = !r.path.hidden;
        lastSig = ''; render();
      });
    });
    namesEl.querySelectorAll('.kd-del').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        var r = rows[+b.dataset.del];
        if (!r || r.kind !== 'path') return;
        pushUndo();
        paths = paths.filter(function (x) { return x !== r.path; });
        scenes[currentScene].paths = paths;
        selOne(null); updateInspector();
        lastSig = ''; render();
      });
    });
  }

  function selectRow(i) {
    var r = rows[i];
    if (!r) return;
    if (r.kind === 'path') {
      selOne('path', r.path.id);
      // A freeze exists at a single instant, so park the playhead on it —
      // otherwise you select the mark and cannot see what you're editing.
      if (r.path.freeze && !isMotion(r.path)) { tNow = r.path.delay; syncScrub(); }
    }
    else selOne('piece', r.piece.id);
    showPropsTab();
    updateInspector();
    render();
  }

  function movePlayhead() {
    var x = msToX(tNow);
    playhead.style.left = x.toFixed(1) + 'px';
    // Zoomed in, the playhead runs off the end of the view within a second or
    // two. Keep it in frame without fighting a scroll the user is doing.
    if (tlZoom > 1 && playing) {
      var W = gridW(), L = grid.scrollLeft;
      if (x < L + 40 || x > L + W - 40) {
        grid.scrollLeft = clamp(x - W * 0.35, 0, Math.max(0, contentW() - W));
      }
    }
  }

  // ---- timeline zoom controls ----
  [].slice.call($('kdZoom').querySelectorAll('button')).forEach(function (b) {
    b.addEventListener('click', function () {
      var k = b.dataset.z;
      if (k === 'fit') { setZoom(1, 0); grid.scrollLeft = 0; }
      else setZoom(tlZoom * (k === 'in' ? 1.7 : 1 / 1.7), tNow);
    });
  });
  grid.addEventListener('wheel', function (e) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setZoom(tlZoom * (e.deltaY < 0 ? 1.25 : 1 / 1.25), eventMs(e));
    } else if (e.shiftKey && contentW() > gridW()) {
      e.preventDefault();
      grid.scrollLeft = clamp(grid.scrollLeft + e.deltaY, 0, contentW() - gridW());
    }
  }, { passive: false });

  // Setting the in/out at the playhead beats dragging a handle to the pixel,
  // and on a long clip it is the only practical way to cut a few seconds out.
  function markIn() { inMs = clamp(tNow, 0, outMs - 200); syncTimeline(true); render(); }
  function markOut() { outMs = clamp(tNow, inMs + 200, T); syncTimeline(true); render(); }
  $('kdMarkIn').onclick = markIn;
  $('kdMarkOut').onclick = markOut;
  window.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'i' || e.key === 'I') { e.preventDefault(); markIn(); }
    else if (e.key === 'o' || e.key === 'O') { e.preventDefault(); markOut(); }
  });

  function syncTimeline(force) {
    var w = gridW();
    // the ruler depends on both the pixel width and the total length
    if (force || w !== lastW || T !== lastT) { lastW = w; lastT = T; buildRuler(); lastSig = ''; }
    var sig = signature();
    if (sig !== lastSig) { lastSig = sig; buildTracks(); }
    movePlayhead();
    layoutTrim();
    enforceOut();
  }

  // keep the name column scrolled with the track column
  grid.addEventListener('scroll', function () {
    namesEl.style.transform = 'translateY(' + (-grid.scrollTop) + 'px)';
  });

  // ---------------------------------------------------------
  // 5. Timeline dragging
  // ---------------------------------------------------------
  var drag = null;

  function localX(e) {
    return clamp(e.clientX - grid.getBoundingClientRect().left + grid.scrollLeft, 0, contentW());
  }

  grid.addEventListener('pointerdown', function (e) {
    var bar = e.target.closest ? e.target.closest('.kd-bar') : null;
    var key = e.target.closest ? e.target.closest('.kd-key') : null;
    var frz = e.target.closest ? e.target.closest('.kd-frzmark') : null;
    var x = localX(e);

    // a freeze marker only moves — its length is real time, not clip time,
    // so there is no edge to stretch here
    if (frz) {
      var fr = rows[+frz.dataset.row];
      pushUndo();
      drag = { mode: 'move', path: fr.path, grabMs: xToMs(x) - fr.path.delay,
               d0: fr.path.delay, u0: fr.path.dur };
      selOne('path', fr.path.id); showPropsTab(); updateInspector();
      grid.setPointerCapture(e.pointerId);
      onDrag(e); e.preventDefault();
      return;
    }

    if (key) {
      var kr = rows[+key.dataset.row];
      pushUndo();
      drag = { mode: 'key', piece: kr.piece, leg: +key.dataset.leg };
      selOne('piece', kr.piece.id); showPropsTab(); updateInspector();
    } else if (bar) {
      var br = rows[+bar.dataset.row];
      var edge = e.target.dataset ? e.target.dataset.edge : null;
      pushUndo();
      drag = {
        mode: edge === 'r' ? 'dur' : edge === 'l' ? 'lead' : 'move',
        path: br.path, grabMs: xToMs(x) - br.path.delay,
        d0: br.path.delay, u0: br.path.dur
      };
      selOne('path', br.path.id); showPropsTab(); updateInspector();
    } else {
      drag = { mode: 'scrub' };
      playing = false; setPlayUI();
    }
    grid.setPointerCapture(e.pointerId);
    onDrag(e);
    e.preventDefault();
  });

  function onDrag(e) {
    if (!drag) return;
    var ms = xToMs(localX(e));

    if (drag.mode === 'scrub') {
      tNow = clamp(ms, 0, T);
      syncScrub();
    } else if (drag.mode === 'move') {
      // a freeze can sit anywhere in the clip — its duration costs no clip time,
      // so the usual "must finish before the end" clamp doesn't apply
      var hi = drag.path.freeze ? T : Math.max(0, T - drag.path.dur);
      drag.path.delay = Math.round(clamp(ms - drag.grabMs, 0, hi) / 50) * 50;
      // dragging a freeze scrubs with it, so you see the frame you're landing on
      if (drag.path.freeze) { tNow = drag.path.delay; syncScrub(); }
    } else if (drag.mode === 'dur') {
      drag.path.dur = Math.round(clamp(ms - drag.path.delay, 300, T - drag.path.delay) / 50) * 50;
    } else if (drag.mode === 'lead') {
      var end = drag.d0 + drag.u0;
      var nd = Math.round(clamp(ms, 0, end - 300) / 50) * 50;
      drag.path.delay = nd;
      drag.path.dur = end - nd;
    } else if (drag.mode === 'key') {
      var legs = drag.piece.legs;
      legs[drag.leg].s = Math.round(clamp(ms, 0, T) / 50) * 50;
      // keep the possession chain in order, the same rule the inspector uses
      for (var k = 1; k < legs.length; k++) {
        if (legs[k].s <= legs[k - 1].s) legs[k].s = legs[k - 1].s + 100;
      }
    }
    if (drag.mode !== 'scrub') lastSig = '';
    render();
  }

  grid.addEventListener('pointermove', onDrag);
  grid.addEventListener('pointerup', function () { drag = null; updateInspector(); });
  grid.addEventListener('pointercancel', function () { drag = null; });

  // ---------------------------------------------------------
  // 6. Transport extras
  // ---------------------------------------------------------
  $('kdToStart').onclick = function () {
    playing = false; setPlayUI(); tNow = 0; syncScrub(); render();
  };
  $('kdToEnd').onclick = function () {
    playing = false; setPlayUI(); tNow = T; syncScrub(); render();
  };

  // Frame-step. Browsers don't expose a clip's real frame rate, so this assumes
  // 30fps — close enough to land on a moment, which is the whole point.
  var FRAME = 1000 / 30;
  var stepMs = FRAME;          // how far one press moves; 1f until you change it
  function step(n, ms) {
    playing = false; setPlayUI();
    tNow = clamp(tNow + n * (ms || stepMs), 0, T);
    syncScrub(); render();
  }
  $('kdPrevF').onclick = function () { step(-1); };
  $('kdNextF').onclick = function () { step(1); };

  // A single frame is right for finding the exact moment of a tip-in and far
  // too slow for crossing a shift. The size is a choice, and it drives the
  // buttons and the arrow keys together.
  var stepBtns = [].slice.call($('kdStepSize').querySelectorAll('button'));
  stepBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      stepMs = parseFloat(b.dataset.ms) || FRAME;
      stepBtns.forEach(function (x) { x.classList.toggle('on', x === b); });
      var lbl = b.textContent.trim();
      $('kdPrevF').title = 'Back ' + lbl + ' (←)';
      $('kdNextF').title = 'Forward ' + lbl + ' (→)';
    });
  });
  window.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    // Shift always gives a single frame, whatever the step is set to, so you
    // can jump close and then walk in without touching the control.
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1, e.shiftKey ? FRAME : 0); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); step(1, e.shiftKey ? FRAME : 0); }
  });

  // ---------------------------------------------------------
  // 6b. Video markup mode
  //
  // The engine dispatches surface backgrounds as
  //   kind==='field' ? drawFieldBg : kind==='iceplex' ? drawIceplexBg : drawRinkBg
  // so an unknown kind falls through to drawRinkBg. Wrapping that one function
  // is enough to add a whole new surface without touching app.js. ctx.drawImage
  // takes a <video> exactly like an <img>, and tick() already calls render()
  // every frame, so the clip animates with no changes to the render loop.
  // ---------------------------------------------------------
  var vid = null;        // the <video> element, or null
  var vidURL = null;     // object URL to revoke
  var vidName = '';
  var VW = 200, VH = 112.5;   // clip size in world units (16:9 default)

  CONFIGS.video = { label: 'Video clip', panels: [{ ox: 0, oy: 0, kind: 'video' }] };

  var _panelW = panelW, _panelH = panelH;
  panelW = function (k) { return k === 'video' ? VW : _panelW(k); };
  panelH = function (k) { return k === 'video' ? VH : _panelH(k); };

  var _drawRinkBg = drawRinkBg;
  drawRinkBg = function (p) {
    if (p.kind !== 'video') return _drawRinkBg(p);
    var a = W2S(p.ox, p.oy), b = W2S(p.ox + VW, p.oy + VH);
    var w = b[0] - a[0], h = b[1] - a[1];
    ctx.save();
    ctx.fillStyle = '#000';
    ctx.fillRect(a[0], a[1], w, h);
    if (vid && vid.readyState >= 2) {
      try { ctx.drawImage(vid, a[0], a[1], w, h); } catch (e) { }
    } else {
      ctx.fillStyle = '#8B929C';
      ctx.font = '600 14px system-ui,Segoe UI,sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(vid ? 'Loading clip…' : 'No clip loaded — File ▸ Open video…',
        a[0] + w / 2, a[1] + h / 2);
      ctx.textAlign = 'start';
    }
    ctx.strokeStyle = '#343A43';
    ctx.lineWidth = 1;
    ctx.strokeRect(a[0], a[1], w, h);
    ctx.restore();
  };

  var _viewPresets = viewPresets;
  viewPresets = function () {
    if (rinkConfig !== 'video') return _viewPresets();
    return [
      { k: 'frame', t: 'Frame', r: { x: 0, y: 0, w: VW, h: VH } },
      { k: 'vleft', t: 'Left', r: { x: 0, y: 0, w: VW * 0.6, h: VH } },
      { k: 'vright', t: 'Right', r: { x: VW * 0.4, y: 0, w: VW * 0.6, h: VH } }
    ];
  };
  var _defaultView = defaultView;
  defaultView = function () { return rinkConfig === 'video' ? 'frame' : _defaultView(); };

  // --- clock: the clip is the master while it plays, the slave while you scrub
  var _syncScrub = syncScrub;
  syncScrub = function () {
    // runs first: a hold pins tNow before anything else reads it
    if (typeof checkFreeze === 'function') checkFreeze();
    if (vid && vid.duration) {
      if (!vid.paused && !vid.ended) {
        tNow = clamp(vid.currentTime * 1000, 0, T);
      } else {
        var want = tNow / 1000;
        if (Math.abs(vid.currentTime - want) > 0.04) {
          try { vid.currentTime = want; } catch (e) { }
        }
      }
    }
    _syncScrub();
    if (T >= 60000) {
      $('timeLbl').textContent = fmtT(tNow) + ' / ' + fmtT(T);
    }
  };

  var _togglePlay = togglePlay;
  togglePlay = function () {
    _togglePlay();
    if (!vid) return;
    if (playing) {
      try { vid.currentTime = tNow / 1000; } catch (e) { }
      var pr = vid.play();
      // autoplay policy can still refuse with sound; fall back to muted
      if (pr && pr.catch) pr.catch(function () { vid.muted = true; updateVideoPanel(); vid.play().catch(function () { }); });
    } else {
      vid.pause();
    }
  };

  // app.js does `playBtn.onclick = togglePlay`, which captured the ORIGINAL
  // function by value before the wrapper above existed — so the button would
  // bypass it while the Space key (which resolves the name at call time) would
  // not. Rebind to pick up the wrapper. Same story for the demo drill.
  $('playBtn').onclick = togglePlay;

  var _loadDemo = loadDemo;
  loadDemo = function () {
    // a rink drill and a clip are different contexts; don't leave both loaded
    if (vid) { disposeVideo(); rinkConfig = 'full'; scenes[currentScene].rinkType = 'full'; }
    _loadDemo();
    lastT = 0; updateVideoPanel();
  };
  $('demoBtn').onclick = loadDemo;

  $('loopChk').addEventListener('change', function () { if (vid) vid.loop = this.checked; });

  function openVideo() { $('vidFile').click(); }

  function loadVideoFile(file) {
    disposeVideo();
    vidURL = URL.createObjectURL(file);
    vidName = file.name;
    vid = document.createElement('video');
    vid.preload = 'auto';
    vid.playsInline = true;
    vid.loop = !!$('loopChk').checked;
    vid.muted = !!$('vidMute').checked;

    vid.addEventListener('loadedmetadata', function () {
      VW = 200;
      VH = 200 * ((vid.videoHeight / vid.videoWidth) || 0.5625);
      T = Math.max(1000, Math.round(vid.duration * 1000));
      pushUndo();
      rinkConfig = 'video';
      scenes[currentScene].rinkType = 'video';
      currentView = 'frame';
      buildLayoutSeg(); buildViewSeg();
      fitRect(viewPresets()[0].r);
      tNow = 0; playing = false; setPlayUI();
      lastT = 0;               // force the ruler to rebuild at the new length
      inMs = 0; outMs = T;     // trim spans the whole clip until you drag it in
      syncScrub(); updateVideoPanel(); render();
      toast('Loaded ' + vidName + ' — ' + fmtT(T));
    }, { once: true });

    vid.addEventListener('error', function () {
      var n = vidName;
      disposeVideo(); updateVideoPanel(); render();
      toast('Could not read ' + n + ' — try MP4 (H.264) or WebM');
    }, { once: true });

    vid.src = vidURL;
    updateVideoPanel();
  }

  function disposeVideo() {
    if (vid) {
      try { vid.pause(); } catch (e) { }
      vid.removeAttribute('src');
      try { vid.load(); } catch (e) { }
    }
    if (vidURL) { URL.revokeObjectURL(vidURL); vidURL = null; }
    vid = null; vidName = '';
  }

  function removeVideo() {
    if (!vid && rinkConfig !== 'video') { toast('No clip loaded'); return; }
    disposeVideo();
    if (rinkConfig === 'video') {
      pushUndo();
      rinkConfig = 'full';
      scenes[currentScene].rinkType = 'full';
      currentView = defaultView();
      buildLayoutSeg(); buildViewSeg();
      fitRect(viewPresets()[0].r);
    }
    T = 5000; $('speed').value = 9;
    tNow = 0; playing = false; setPlayUI();
    lastT = 0; inMs = 0; outMs = T;
    syncScrub(); updateVideoPanel(); render();
    toast('Clip removed');
  }

  $('vidFile').addEventListener('change', function (e) {
    var f = e.target.files[0];
    e.target.value = '';
    if (f) loadVideoFile(f);
  });
  $('vidOpen').onclick = openVideo;
  $('vidRemove').onclick = removeVideo;
  $('vidMute').addEventListener('change', function () { if (vid) vid.muted = this.checked; });
  relay('mFileVideo', 'vidOpen');
  relay('mFileVideoOff', 'vidRemove');

  // Picking "Video clip" in the Surface list with nothing loaded opens the picker.
  // The engine's own onchange has already run by the time this fires.
  $('rinkSel').addEventListener('change', function () {
    if (this.value === 'video' && !vid) openVideo();
    updateVideoPanel();
  });

  function updateVideoPanel() {
    var loaded = !!(vid && vid.duration);
    $('vidName').textContent = loaded ? vidName : (vid ? 'Loading…' : 'No clip loaded');
    $('vidMeta').textContent = loaded
      ? vid.videoWidth + '×' + vid.videoHeight + ' · ' + fmtT(T)
      : 'MP4 (H.264) or WebM';
    $('vidRemove').disabled = !vid;
    $('vidMute').checked = vid ? !!vid.muted : false;
    // While a clip is loaded the timeline length IS the clip length.
    var sp = $('speed');
    sp.disabled = loaded;
    sp.parentNode.style.opacity = loaded ? 0.4 : 1;
    sp.parentNode.title = loaded ? 'Length is set by the video clip' : '';
  }

  // ---------------------------------------------------------
  // 6c. In / out trim + clip export
  //
  // Drag the two handles to pick the window you want (5s, 25s, whatever),
  // then Export records the canvas from in to out with the marks burned in.
  // Audio is pulled off the clip when the browser allows it.
  // ---------------------------------------------------------
  var inMs = 0, outMs = 0;      // outMs 0 == "not set yet", filled from T
  var exporting = false;
  var shadeL = $('kdShadeL'), shadeR = $('kdShadeR'), hIn = $('kdIn'), hOut = $('kdOut');

  function trimSpan() { return Math.max(0, outMs - inMs); }

  function clampTrim() {
    if (!outMs || outMs > T) outMs = T;
    if (inMs > T - 200) inMs = Math.max(0, T - 200);
    if (outMs <= inMs + 200) outMs = Math.min(T, inMs + 200);
  }

  function layoutTrim() {
    clampTrim();
    var W = contentW(), h = 22 + rows.length * ROW;
    var a = (inMs / T) * W, b = (outMs / T) * W;
    shadeL.style.left = '0px'; shadeL.style.width = a.toFixed(1) + 'px'; shadeL.style.height = h + 'px';
    shadeR.style.left = b.toFixed(1) + 'px'; shadeR.style.width = Math.max(0, W - b).toFixed(1) + 'px';
    shadeR.style.height = h + 'px';
    hIn.style.left = a.toFixed(1) + 'px'; hIn.style.height = h + 'px';
    hOut.style.left = b.toFixed(1) + 'px'; hOut.style.height = h + 'px';
    $('kdSelInfo').textContent = 'Clip ' + fmtT(trimSpan());
  }

  function trimDrag(handle, which) {
    handle.addEventListener('pointerdown', function (e) {
      e.stopPropagation(); e.preventDefault();
      // capture is a nicety, not a requirement — listen on window so the drag
      // survives the pointer leaving the handle either way
      try { handle.setPointerCapture(e.pointerId); } catch (err) { }
      var move = function (ev) {
        var ms = eventMs(ev);
        if (which === 'in') inMs = clamp(ms, 0, outMs - 200);
        else outMs = clamp(ms, inMs + 200, T);
        layoutTrim();
        // rebuild so the "N marks · … out" readout tracks the drag; without a
        // render it sat on the old numbers until something else redrew
        render();
      };
      var up = function () {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }
  trimDrag(hIn, 'in');
  trimDrag(hOut, 'out');

  $('kdSelAll').onclick = function () { inMs = 0; outMs = T; layoutTrim(); };

  // Playback respects the trim window: start at `in`, stop (or loop) at `out`.
  var _togglePlay2 = togglePlay;
  togglePlay = function () {
    resetHolds();                       // every run through re-arms the freezes
    if (!playing && (tNow < inMs || tNow >= outMs - 30)) { tNow = inMs; syncScrub(); }
    _togglePlay2();
  };
  $('playBtn').onclick = togglePlay;

  // --- freeze holds ----------------------------------------------------
  // A freeze mark stops the clip on its frame for `dur` of REAL time, then
  // lets it run on without the mark. The video clock stands still during the
  // hold while wall-clock advances, so the two can't share a timer.
  var holdNow = null;      // {path, at, endsAt}
  var holdDone = [];       // ids already held this pass, so it fires once

  function resetHolds() {
    if (holdNow && vid && playing) { try { vid.play(); } catch (e) { } }
    holdNow = null; _holdPath = null; holdDone = [];
  }

  function checkFreeze() {
    if (!playing) { if (holdNow) { holdNow = null; _holdPath = null; } return; }
    if (holdNow) {
      if (performance.now() >= holdNow.endsAt) {
        holdDone.push(holdNow.path.id);
        holdNow = null; _holdPath = null;
        if (vid) vid.play().catch(function () { });
      } else {
        tNow = holdNow.at;               // clock stands still
        return;
      }
    }
    for (var i = 0; i < paths.length; i++) {
      var p = paths[i];
      if (!p.freeze || p.hidden || isMotion(p)) continue;
      if (holdDone.indexOf(p.id) >= 0) continue;
      if (tNow >= (p.delay || 0)) {
        holdNow = { path: p, at: p.delay || 0, endsAt: performance.now() + (p.dur || 2000) };
        _holdPath = p;
        tNow = holdNow.at;
        if (vid) vid.pause();
        break;
      }
    }
  }

  function enforceOut() {
    if (!playing) return;
    if (tNow >= outMs) {
      if (loop && !exporting) {
        // Seek the CLIP as well, not just the clock. While playing, the video
        // is the master and tNow is pulled from vid.currentTime every frame —
        // so setting tNow alone was overwritten a frame later and playback ran
        // straight past the out point to the end of the clip.
        tNow = inMs;
        if (vid) { try { vid.currentTime = inMs / 1000; } catch (e) { } }
        resetHolds();                 // freezes re-arm for the next pass round
        syncScrub();
      }
      else { tNow = outMs; playing = false; setPlayUI(); if (vid) vid.pause(); syncScrub(); }
    }
  }

  // --- export ---------------------------------------------------------
  // MP4/H.264 first so clips play on a phone without converting; WebM is the
  // fallback. Pairing matters: MP4 needs AAC, WebM needs Opus.
  function pickMime() {
    var opts = [
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4',
      'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'
    ];
    for (var i = 0; i < opts.length; i++) if (MediaRecorder.isTypeSupported(opts[i])) return opts[i];
    return 'video/webm';
  }

  // The clip's audio, rebuilt through WebAudio.
  //
  // Taking vid.captureStream().getAudioTracks() and bolting that track onto the
  // canvas stream makes the MP4 muxer emit zero bytes and hang on stop (WebM
  // tolerates it). Re-originating the audio through a MediaStreamDestination
  // yields a track MP4 accepts. createMediaElementSource can only be called
  // once per element and reroutes its output, so it's cached and reconnected to
  // ctx.destination to keep local playback audible.
  var audioCtx = null, srcNode = null, srcFor = null;
  function clipAudioTrack() {
    if (!vid) return null;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      if (srcFor !== vid) {
        srcNode = audioCtx.createMediaElementSource(vid);
        srcNode.connect(audioCtx.destination);
        srcFor = vid;
      }
      var dest = audioCtx.createMediaStreamDestination();
      srcNode.connect(dest);
      return dest.stream.getAudioTracks()[0] || null;
    } catch (e) { return null; }
  }

  // Recording the visible canvas meant the clip was re-encoded at whatever size
  // the stage happened to be: a 1280x720 source came out 576x324, a fifth of
  // the pixels, and every export looked soft. For the length of the recording
  // the canvas backing store is resized to the clip's own resolution and the
  // camera is pointed straight at the video panel, so what MediaRecorder sees
  // is full size. The stage looks stretched while it records — the CSS box has
  // not moved and the browser scales the bigger backing store into it — but the
  // file is correct.
  var savedView = null;
  function useNativeView() {
    if (!vid || !vid.videoWidth) return null;
    var MAXW = 1920;                       // 4K would be a 33MP canvas per frame
    var w = vid.videoWidth, h = vid.videoHeight;
    if (w > MAXW) { h = Math.round(h * MAXW / w); w = MAXW; }
    w -= w % 2; h -= h % 2;                // H.264 will not take odd dimensions
    savedView = { dpr: DPR, s: cam.s, tx: cam.tx, ty: cam.ty };
    cv.width = w; cv.height = h;
    DPR = 1;
    cam.s = w / VW; cam.tx = 0; cam.ty = 0;   // the panel spans VW world units
    render();
    return { w: w, h: h };
  }
  function restoreView() {
    if (!savedView) return;
    DPR = savedView.dpr;
    cam.s = savedView.s; cam.tx = savedView.tx; cam.ty = savedView.ty;
    savedView = null;
    resize();                              // puts the backing store back
    render();
  }

  function exportClip() {
    if (exporting) return;
    if (trimSpan() < 200) { toast('Drag the in/out handles to pick a window first'); return; }

    var native = useNativeView();
    var stream = cv.captureStream(30);
    var withAudio = false;
    var atrack = clipAudioTrack();
    if (atrack) { stream.addTrack(atrack); withAudio = true; }

    var mime = pickMime();
    var ext = mime.indexOf('mp4') >= 0 ? 'mp4' : 'webm';
    var rec, chunks = [];
    // Bitrate has to follow the resolution, or the extra pixels just get spent
    // on compression artefacts.
    var px = native ? native.w * native.h : cv.width * cv.height;
    var rate = Math.max(8000000, Math.round(px * 30 * 0.15));
    try {
      rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: rate });
    } catch (e) { restoreView(); toast('This browser cannot record — try Chrome'); return; }

    rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = function () {
      var blob = new Blob(chunks, { type: 'video/' + ext });
      restoreView();
      exporting = false;
      $('kdExport').classList.remove('rec');
      $('kdExport').textContent = '⬇ Export clip';
      // A muxer that fails silently produces a zero-byte file. Say so rather
      // than dropping an unplayable download in the user's folder.
      if (!blob.size) {
        toast('Export failed — the ' + ext.toUpperCase() + ' encoder produced no data. Try again, or mute the clip.');
        return;
      }
      var base = (vidName ? vidName.replace(/\.[^.]+$/, '') : 'drill');
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = base + '_marked_' + Math.round(inMs / 100) / 10 + 's-' + Math.round(outMs / 100) / 10 + 's.' + ext;
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      toast('Saved ' + fmtT(trimSpan()) + ' ' + ext.toUpperCase() +
        (native ? ' at ' + native.w + '×' + native.h : '') +
        (withAudio ? ' with audio' : ' (no audio)') + ' to your downloads');
    };

    exporting = true;
    $('kdExport').classList.add('rec');
    $('kdExport').textContent = '⏹ Recording…';

    // park on the in-point, let the clip actually seek, then roll.
    // Holds are re-armed so every freeze fires into the recording.
    resetHolds();
    playing = false; setPlayUI();
    tNow = inMs; syncScrub(); render();

    var begin = function () {
      rec.start(100);
      playing = true; lastTs = 0; setPlayUI();
      if (vid) { try { vid.currentTime = inMs / 1000; } catch (e) { } vid.play().catch(function () { }); }
      // Read the clip's own clock rather than tNow: tNow is advanced by the
      // rAF render loop, which the browser throttles when the tab isn't
      // visible, and a stuck watcher would record forever.
      var watch = setInterval(function () {
        var at = (vid && vid.duration) ? vid.currentTime * 1000 : tNow;
        if (at >= outMs || !playing) {
          clearInterval(watch);
          playing = false; setPlayUI();
          if (vid) vid.pause();
          tNow = outMs; syncScrub(); render();
          setTimeout(function () { if (rec.state !== 'inactive') rec.stop(); }, 120);
        }
      }, 40);
    };
    // Don't start recording on a timer — wait until the clip has actually
    // landed on the in-point, or the head of the export is padded with
    // whatever frame happened to be showing.
    if (vid) {
      var started = false;
      var go = function () { if (!started) { started = true; begin(); } };
      vid.addEventListener('seeked', go, { once: true });
      try { vid.currentTime = inMs / 1000; } catch (e) { }
      setTimeout(go, 1200);                 // fallback if 'seeked' never fires
    } else begin();
  }

  $('kdExport').onclick = function () { exporting ? null : exportClip(); };

  // ---------------------------------------------------------
  // 7. Hook the engine's render loop
  // ---------------------------------------------------------
  var _render = render;
  render = function () {
    _render.apply(this, arguments);
    syncTimeline(false);
  };

  if (window.ResizeObserver) {
    new ResizeObserver(function () { syncTimeline(true); }).observe(grid);
  }
  window.addEventListener('resize', function () { syncTimeline(true); });

  // ---------------------------------------------------------
  // 7b. Autosave — a reload should never cost you a board
  // ---------------------------------------------------------
  // The board lived only in the tab: a refresh, a crash, or a stray Ctrl-W and
  // an hour of work was gone. This keeps the current state in localStorage and
  // puts it back on the next load. It is a safety net, not a filing system —
  // File ▸ Save is still how a drill gets a name and a home.
  var AKEY = 'kd.autosave';
  function boardData() {
    syncScene();
    return {
      v: 2, showTrap: showTrap, centerLogo: centerLogo,
      customLogo: LOGO_SRC.custom || null,
      currentScene: currentScene,
      scenes: scenes.map(function (s) {
        return {
          name: s.name, rinkType: s.rinkType || 'full',
          pieces: s.pieces.map(function (p) {
            var q = Object.assign({}, p); q.img = undefined; q._src = p._src || null; return q;
          }),
          paths: s.paths.map(function (p) {
            var q = Object.assign({}, p); q._lut = undefined; return q;
          })
        };
      })
    };
  }
  var lastSaved = '';
  function autosaveNow() {
    try {
      var d = boardData();
      var empty = d.scenes.every(function (s) { return !s.pieces.length && !s.paths.length; });
      if (empty) { localStorage.removeItem(AKEY); lastSaved = ''; return; }
      var json = JSON.stringify(d);
      if (json === lastSaved) return;
      localStorage.setItem(AKEY, JSON.stringify({ at: Date.now(), data: d }));
      lastSaved = json;
    } catch (e) { /* private mode or quota — File ▸ Save still works */ }
  }
  var saveTimer = null;
  function autosaveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(autosaveNow, 700); }

  // pushUndo runs just before every change the engine considers undoable, and
  // the debounce means the write happens after the change has landed.
  var _pushUndo = pushUndo;
  pushUndo = function () { _pushUndo.apply(this, arguments); autosaveSoon(); };
  // A backstop for edits that never touch the undo stack — inspector sliders,
  // retiming a bar on the timeline.
  setInterval(autosaveNow, 4000);
  window.addEventListener('beforeunload', autosaveNow);

  function restoreAutosave() {
    var raw = null;
    try { raw = localStorage.getItem(AKEY); } catch (e) { return; }
    if (!raw) return;
    var o = null;
    try { o = JSON.parse(raw); } catch (e) { return; }
    if (!o || !o.data || !o.data.scenes) return;
    if (pieces.length || paths.length) return;   // never clobber a live board
    try {
      loadData(o.data);
      toast('Picked up where you left off — File ▸ New to start fresh');
    } catch (e) { }
  }

  // ---------------------------------------------------------
  // 8. Boot
  // ---------------------------------------------------------
  // Speed slider 2..12 maps to T=(14-v)*1000, so 9 == the engine's default 5s.
  $('speed').value = 9;
  showPanel('select');
  showPropsTab();
  updateVideoPanel();
  setMarkColour('#111111');            // black by default; all colours stay in the palette
  applyWeight(parseFloat(wSlider.value));
  applyOpacity(parseFloat(oSlider.value));
  paintRecent();
  restoreAutosave();
  syncTimeline(true);
  setTimeout(function () { syncTimeline(true); }, 300);
})();
