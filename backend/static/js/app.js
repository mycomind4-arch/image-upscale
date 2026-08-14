/**
 * Image Upscale Lab — Main Application v2
 * Professional AI image restoration workstation
 */
const State = {
  page: 'enhance', capabilities: null,
  originalFile: null, originalUrl: null, originalAnalysis: null,
  enhancedUrl: null, enhancedMeta: null, enhancedBlob: null,
  isProcessing: false,
  viewMode: 'single', showOriginal: false,
  mode: 'auto', scale: 4, model: 'auto', fidelity: 0.75,
  advanced: { denoise: 0, sharpen: 0, texture: 0, colorCorrection: 0, tileSize: 0, tilePadding: 8, outputFormat: 'png' },
  faceFidelity: 0.7, faceEnabled: false, candidates: [], history: [],
};
function $(s, p = document) { return p.querySelector(s); }
function $$(s, p = document) { return [...p.querySelectorAll(s)]; }
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (v !== null && v !== undefined) e.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    if (typeof c === 'string') e.appendChild(document.createTextNode(c));
    else e.appendChild(c);
  }
  return e;
}
function formatMP(w, h) { const mp = (w * h) / 1e6; return mp >= 1 ? `${mp.toFixed(1)} MP` : `${Math.round(mp * 1000)} KMP`; }
function formatSize(b) { return b < 1024 ? `${b} B` : b < 1048576 ? `${(b/1024).toFixed(1)} KB` : `${(b/1048576).toFixed(1)} MB`; }
function formatDuration(ms) { return ms < 1000 ? `${ms}ms` : `${(ms/1000).toFixed(1)}s`; }
function formatDate(ts) { return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function clamp(v, mn, mx) { return Math.max(mn, Math.min(mx, v)); }
const History = {
  KEY: 'image-upscale-history',
  load() { try { return JSON.parse(localStorage.getItem(this.KEY) || '[]'); } catch { return []; } },
  save(items) { try { localStorage.setItem(this.KEY, JSON.stringify(items)); } catch {} },
  add(entry) { State.history.unshift(entry); this.save(State.history); },
  remove(id) { State.history = State.history.filter(h => h.id !== id); this.save(State.history); },
  clear() { State.history = []; this.save(State.history); },
};
const App = {
  viewer: null,
  async init() {
    State.history = History.load();
    this._buildShell();
    this._bindGlobalEvents();
    await this._loadCapabilities();
    this._navigate('enhance');
  },
  _buildShell() {
    document.body.innerHTML = '';
    const shell = el('div', { class: 'app-shell' });
    const header = el('header', { class: 'app-header' });
    header.innerHTML = `
      <div class="brand">
        <div class="brand-mark">${ICONS.enhance}</div>
        <div class="brand-text"><span>Image Upscale</span><span class="sub">Lab</span></div>
      </div>
      <nav class="nav" role="navigation" aria-label="Main navigation">
        <button class="nav-item active" data-page="enhance">Enhance</button>
        <button class="nav-item" data-page="compare">Compare</button>
        <button class="nav-item" data-page="history">History</button>
        <button class="nav-item" data-page="benchmarks">Benchmarks</button>
        <button class="nav-item" data-page="settings">Settings</button>
      </nav>
      <div class="header-spacer"></div>
      <div class="header-status">
        <div class="device-badge" id="deviceBadge"><span class="dot idle"></span><span id="deviceName">Detecting…</span></div>
        <span class="status-text" id="headerStatus">Ready</span>
      </div>
      <button class="icon-btn" id="shortcutsBtn" aria-label="Keyboard shortcuts" data-tooltip="Shortcuts">${ICONS.keyboard}</button>
    `;
    shell.appendChild(header);
    const body = el('div', { class: 'app-body' }); body.id = 'appBody';
    shell.appendChild(body);
    const sb = el('footer', { class: 'status-bar' }); sb.id = 'statusBar';
    sb.innerHTML = `
      <div class="status-item"><span class="status-dot ready" id="statusDot"></span><span id="statusLabel">Ready</span></div>
      <div class="status-item"><span>Model:</span><span class="status-value" id="statusModel">—</span></div>
      <div class="status-item"><span>Device:</span><span class="status-value" id="statusDevice">—</span></div>
      <div class="status-item"><span>Scale:</span><span class="status-value" id="statusScale">—</span></div>
      <div class="spacer"></div>
      <div class="status-item" id="statusRuntime"></div>
    `;
    shell.appendChild(sb);
    document.body.appendChild(shell);
    $$('.nav-item').forEach(b => b.addEventListener('click', () => this._navigate(b.dataset.page)));
    $('#shortcutsBtn').addEventListener('click', () => this._showShortcuts());
  },
  _navigate(page) {
    State.page = page;
    $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === page));
    const body = $('#appBody'); body.innerHTML = '';
    switch (page) {
      case 'enhance': this._renderEnhancePage(body); break;
      case 'compare': this._renderComparePage(body); break;
      case 'history': this._renderHistoryPage(body); break;
      case 'benchmarks': this._renderBenchmarksPage(body); break;
      case 'settings': this._renderSettingsPage(body); break;
    }
  },
  _renderEnhancePage(body) {
    body.appendChild(this._buildLeftPanel());
    const ca = el('div', { class: 'canvas-area' });
    body.appendChild(ca);
    body.appendChild(this._buildRightPanel());
    if (State.originalUrl) this._renderCanvas(ca); else this._renderDropZone(ca);
  },
  _renderDropZone(ca) {
    ca.innerHTML = `
      <div class="drop-zone" id="dropZone" role="button" tabindex="0" aria-label="Upload image">
        <div class="drop-zone-frame">
          <div class="drop-zone-icon">${ICONS.upload}</div>
          <div class="drop-zone-title">Drop an image to begin</div>
          <div class="drop-zone-subtitle">JPG · PNG · WEBP · TIFF</div>
          <div class="drop-zone-actions">
            <button class="btn btn-primary" id="chooseFileBtn">${ICONS.folder} Choose Image</button>
            <button class="btn btn-secondary" id="pasteBtn">${ICONS.clipboard} Paste from Clipboard</button>
          </div>
        </div>
      </div>`;
    const dz = $('#dropZone'); const fi = this._createFileInput();
    dz.addEventListener('click', e => { if (!e.target.closest('button')) fi.click(); });
    dz.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fi.click(); } });
    $('#chooseFileBtn').addEventListener('click', e => { e.stopPropagation(); fi.click(); });
    $('#pasteBtn').addEventListener('click', e => { e.stopPropagation(); this._pasteFromClipboard(); });
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
    dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('dragover'); const f = e.dataTransfer.files[0]; if (f && f.type.startsWith('image/')) this._handleFile(f); });
  },
  _createFileInput() {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = 'image/*'; i.style.display = 'none';
    document.body.appendChild(i);
    i.addEventListener('change', () => { if (i.files[0]) this._handleFile(i.files[0]); i.remove(); });
    return i;
  },
  _pasteFromClipboard() {
    navigator.clipboard.read().then(items => {
      for (const it of items) for (const t of it.types) if (t.startsWith('image/')) { it.getAsFile().then(f => this._handleFile(f)); return; }
      this._showToast('No image found in clipboard', 'warning');
    }).catch(() => this._showToast('Clipboard access denied', 'error'));
  },
  async _handleFile(file) {
    State.originalFile = file;
    if (State.originalUrl) URL.revokeObjectURL(State.originalUrl);
    State.originalUrl = URL.createObjectURL(file);
    State.enhancedUrl = null; State.enhancedMeta = null; State.originalAnalysis = null;
    State.enhancedBlob = null; State.viewMode = 'single'; State.showOriginal = false;
    try { State.originalAnalysis = await API.analyzeImage(file); } catch (e) { console.warn('Analysis failed:', e.message); }
    this._navigate('enhance');
  },
};

// ===== CANVAS RENDERING =====
Object.assign(App, {
  _renderCanvas(ca) {
    const toolbar = el('div', { class: 'canvas-toolbar' });
    toolbar.innerHTML = `
      <button class="tb-btn" id="tbZoomOut" aria-label="Zoom out" data-tooltip="Zoom out (-)">${ICONS.zoomOut}</button>
      <div style="display:flex;align-items:center;padding:0 6px;"><span class="zoom-value" id="zoomValue" style="font-size:var(--font-size-sm);color:var(--text-secondary);min-width:42px;text-align:center;font-variant-numeric:tabular-nums;">100%</span></div>
      <button class="tb-btn" id="tbZoomIn" aria-label="Zoom in" data-tooltip="Zoom in (+)">${ICONS.zoomIn}</button>
      <div class="tb-divider"></div>
      <button class="tb-btn" id="tbFit" aria-label="Fit" data-tooltip="Fit (F)">${ICONS.fit}</button>
      <button class="tb-btn" id="tbActual" aria-label="Actual size" data-tooltip="Actual Size (1)">${ICONS.actualSize}</button>
      <button class="tb-btn" id="tbRotate" aria-label="Rotate" data-tooltip="Rotate">${ICONS.rotate}</button>
      <button class="tb-btn" id="tbReset" aria-label="Reset" data-tooltip="Reset (R)">${ICONS.reset}</button>
      <div class="tb-divider"></div>
      ${State.enhancedUrl ? `
      <button class="tb-btn ${State.viewMode === 'side-by-side' ? 'active' : ''}" id="tbSbs" aria-label="Side by side" data-tooltip="Side by Side">${ICONS.compare}</button>
      <button class="tb-btn ${State.viewMode === 'split' ? 'active' : ''}" id="tbSplit" aria-label="Split" data-tooltip="Split View">${ICONS.layers}</button>
      <button class="tb-btn ${State.viewMode === 'overlay' ? 'active' : ''}" id="tbOverlay" aria-label="Overlay" data-tooltip="Overlay">${ICONS.eye}</button>
      <button class="tb-btn ${State.viewMode === 'difference' ? 'active' : ''}" id="tbDiff" aria-label="Difference" data-tooltip="Difference Map">${ICONS.sliders}</button>
      ` : ''}
      <div class="spacer"></div>
      <button class="tb-btn" id="tbShowOrig" aria-label="Show original" data-tooltip="Toggle Original (O)">${ICONS.image}</button>
      <button class="tb-btn" id="tbNew" aria-label="New image" data-tooltip="New Image (Ctrl+O)">${ICONS.folder}</button>
    `;
    ca.appendChild(toolbar);
    const vp = el('div', { class: 'canvas-viewport' }); vp.id = 'canvasViewport';
    ca.appendChild(vp);
    const ov = el('div', { class: 'processing-overlay hidden' }); ov.id = 'processingOverlay';
    ov.innerHTML = `<div class="spinner"></div><div class="processing-label" id="processingLabel">Processing…</div><div class="processing-sub" id="processingSub"></div><div class="progress-bar" style="width:200px;margin-top:8px"><div class="progress-bar-fill indeterminate" id="progressFill"></div></div>`;
    vp.appendChild(ov);
    if (State.viewMode === 'side-by-side' && State.enhancedUrl) this._renderSideBySide(vp);
    else if (State.viewMode === 'split' && State.enhancedUrl) this._renderSplit(vp);
    else if (State.viewMode === 'overlay' && State.enhancedUrl) this._renderOverlay(vp);
    else if (State.viewMode === 'difference' && State.enhancedUrl) this._renderDifference(vp);
    else {
      this.viewer = new ImageViewer(vp);
      this.viewer.onZoomChange = pct => { const z = $('#zoomValue'); if (z) z.textContent = pct + '%'; };
      const src = State.showOriginal ? State.originalUrl : (State.enhancedUrl || State.originalUrl);
      this.viewer.load(src);
    }
    this._renderCanvasInfo(vp);
    this._bindCanvasToolbar();
    if (State.enhancedMeta) this._updateResultPanel();
  },

  _renderCanvasInfo(vp) {
    const info = el('div', { class: 'canvas-info' });
    if (State.originalAnalysis) {
      const a = State.originalAnalysis;
      info.appendChild(el('div', { class: 'info-chip' }, el('span', { class: 'label' }, 'Original'), el('span', { class: 'value' }, a.width + ' × ' + a.height)));
      info.appendChild(el('div', { class: 'info-chip' }, el('span', { class: 'value' }, formatMP(a.width, a.height))));
      info.appendChild(el('div', { class: 'info-chip' }, el('span', { class: 'value' }, a.image_type)));
    }
    if (State.enhancedMeta) {
      const m = State.enhancedMeta;
      info.appendChild(el('div', { class: 'info-chip' }, el('span', { class: 'label' }, 'Enhanced'), el('span', { class: 'value' }, m.dimensions)));
      info.appendChild(el('div', { class: 'info-chip' }, el('span', { class: 'value' }, m.mp)));
      info.appendChild(el('div', { class: 'info-chip' }, el('span', { class: 'label' }, 'Model'), el('span', { class: 'value' }, m.pipeline)));
      info.appendChild(el('div', { class: 'info-chip' }, el('span', { class: 'label' }, 'Scale'), el('span', { class: 'value' }, State.scale + '×')));
      info.appendChild(el('div', { class: 'info-chip' }, el('span', { class: 'label' }, 'Runtime'), el('span', { class: 'value' }, m.runtime)));
    }
    vp.appendChild(info);
  },

  _renderSideBySide(vp) {
    vp.innerHTML = '';
    const c = el('div', { class: 'compare-container' });
    const l = el('div', { class: 'compare-side' });
    const r = el('div', { class: 'compare-side' });
    l.appendChild(el('div', { class: 'compare-label' }, 'Original'));
    r.appendChild(el('div', { class: 'compare-label', style: { left: 'auto', right: '8px' } }, 'Enhanced'));
    l.appendChild(el('img', { class: 'canvas-img', src: State.originalUrl, draggable: 'false' }));
    r.appendChild(el('img', { class: 'canvas-img', src: State.enhancedUrl, draggable: 'false' }));
    c.appendChild(l); c.appendChild(r); vp.appendChild(c);
  },

  _renderSplit(vp) {
    vp.innerHTML = '';
    const split = el('div', { class: 'split-view' });
    split.innerHTML = `
      <div class="split-image-wrap left"><div class="compare-label">Original</div><img class="canvas-img" src="${State.originalUrl}" draggable="false" style="width:100%;height:100%;object-fit:contain"></div>
      <div class="split-image-wrap right"><div class="compare-label" style="left:auto;right:8px">Enhanced</div><img class="canvas-img" src="${State.enhancedUrl}" draggable="false" style="width:100%;height:100%;object-fit:contain"></div>
      <div class="split-divider" id="splitDivider" style="left:50%"></div>
    `;
    vp.appendChild(split);
    this._bindSplitDivider(split, '#splitDivider');
  },

  _bindSplitDivider(split, sel) {
    const d = $(sel); const rw = split.querySelector('.split-image-wrap.right');
    let drag = false;
    const move = cx => { const r = split.getBoundingClientRect(); const p = clamp(((cx - r.left) / r.width) * 100, 0, 100); d.style.left = p + '%'; rw.style.clipPath = 'inset(0 0 0 ' + p + '%)'; };
    d.addEventListener('mousedown', e => { drag = true; e.preventDefault(); });
    d.addEventListener('touchstart', e => { drag = true; move(e.touches[0].clientX); e.preventDefault(); }, { passive: false });
    window.addEventListener('mousemove', e => { if (drag) move(e.clientX); });
    window.addEventListener('touchmove', e => { if (drag) { move(e.touches[0].clientX); e.preventDefault(); } }, { passive: false });
    window.addEventListener('mouseup', () => drag = false);
    window.addEventListener('touchend', () => drag = false);
  },

  _renderOverlay(vp) {
    vp.innerHTML = '';
    const w = el('div', { class: 'overlay-view' });
    w.innerHTML = `
      <img class="canvas-img" src="${State.originalUrl}" draggable="false" style="opacity:0.5;z-index:1">
      <img class="canvas-img" src="${State.enhancedUrl}" draggable="false" style="opacity:0.7;z-index:2">
      <div style="position:absolute;bottom:12px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:8px;z-index:10;background:rgba(16,16,18,0.85);backdrop-filter:blur(10px);border:1px solid var(--border-subtle);border-radius:var(--radius);padding:8px 12px;">
        <span style="font-size:var(--font-size-sm);color:var(--text-muted);">Original</span>
        <input type="range" class="slider" id="overlaySlider" min="0" max="100" value="50" style="width:140px">
        <span style="font-size:var(--font-size-sm);color:var(--text-muted);">Enhanced</span>
      </div>`;
    vp.appendChild(w);
    const s = $('#overlaySlider'); const imgs = w.querySelectorAll('img');
    s.addEventListener('input', () => { const v = parseInt(s.value); imgs[0].style.opacity = (100 - v) / 100; imgs[1].style.opacity = v / 100; });
  },

  _renderDifference(vp) {
    vp.innerHTML = '';
    const w = el('div', { class: 'difference-view' });
    const canvas = el('canvas'); w.appendChild(canvas); vp.appendChild(w);
    const oi = new Image(), ei = new Image(); let loaded = 0;
    const compute = () => {
      loaded++; if (loaded < 2) return;
      const maxDim = 1024;
      const ratio = Math.min(maxDim / oi.naturalWidth, maxDim / oi.naturalHeight, 1);
      const w = Math.round(oi.naturalWidth * ratio), h = Math.round(oi.naturalHeight * ratio);
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(oi, 0, 0, w, h);
      const oData = ctx.getImageData(0, 0, w, h);
      const tmp = document.createElement('canvas'); tmp.width = w; tmp.height = h;
      tmp.getContext('2d').drawImage(ei, 0, 0, w, h);
      const eData = tmp.getContext('2d').getImageData(0, 0, w, h);
      const out = ctx.createImageData(w, h);
      for (let i = 0; i < oData.data.length; i += 4) {
        out.data[i] = Math.abs(oData.data[i] - eData.data[i]) * 4;
        out.data[i+1] = Math.abs(oData.data[i+1] - eData.data[i+1]) * 4;
        out.data[i+2] = Math.abs(oData.data[i+2] - eData.data[i+2]) * 4;
        out.data[i+3] = 255;
      }
      ctx.putImageData(out, 0, 0);
    };
    oi.onload = compute; ei.onload = compute; oi.src = State.originalUrl; ei.src = State.enhancedUrl;
    const info = el('div', { class: 'canvas-info' });
    info.appendChild(el('div', { class: 'info-chip' }, el('span', { class: 'value' }, 'Difference Map (amplified 4×)')));
    vp.appendChild(info);
  },

  _bindCanvasToolbar() {
    const v = this.viewer;
    $('#tbZoomOut')?.addEventListener('click', () => v?.zoomOut());
    $('#tbZoomIn')?.addEventListener('click', () => v?.zoomIn());
    $('#tbFit')?.addEventListener('click', () => v?.fit());
    $('#tbActual')?.addEventListener('click', () => v?.actualSize());
    $('#tbRotate')?.addEventListener('click', () => v?.rotate());
    $('#tbReset')?.addEventListener('click', () => { State.viewMode = 'single'; this._navigate('enhance'); });
    $('#tbSbs')?.addEventListener('click', () => { State.viewMode = 'side-by-side'; this._navigate('enhance'); });
    $('#tbSplit')?.addEventListener('click', () => { State.viewMode = 'split'; this._navigate('enhance'); });
    $('#tbOverlay')?.addEventListener('click', () => { State.viewMode = 'overlay'; this._navigate('enhance'); });
    $('#tbDiff')?.addEventListener('click', () => { State.viewMode = 'difference'; this._navigate('enhance'); });
    $('#tbShowOrig')?.addEventListener('click', () => {
      if (State.viewMode !== 'single') State.viewMode = 'single';
      State.showOriginal = !State.showOriginal; this._navigate('enhance');
    });
    $('#tbNew')?.addEventListener('click', () => {
      State.originalFile = null;
      if (State.originalUrl) URL.revokeObjectURL(State.originalUrl);
      State.originalUrl = null; State.enhancedUrl = null; State.enhancedMeta = null; State.originalAnalysis = null;
      this._navigate('enhance');
    });
  },
});

// ===== LEFT PANEL =====
Object.assign(App, {
  _buildLeftPanel() {
    const panel = el('aside', { class: 'panel panel-left' });
    // MODE
    const modeSec = el('div', { class: 'panel-section' });
    modeSec.appendChild(el('div', { class: 'panel-title' },
      el('span', {}, 'Mode'),
      el('span', { class: 'tooltip-icon', 'data-tooltip': 'Fidelity preserves original, Detail allows stronger AI, Best tests multiple models', html: ICONS.info })
    ));
    const modeSeg = el('div', { class: 'segmented', id: 'modeSeg' });
    const modes = [
      { id: 'auto', label: 'Auto', tip: 'Automatic model selection' },
      { id: 'fidelity', label: 'Fidelity', tip: 'Preserves original information and minimizes reconstruction' },
      { id: 'balanced', label: 'Balanced', tip: 'Best general-purpose enhancement' },
      { id: 'detail', label: 'Detail', tip: 'Allows stronger AI reconstruction' },
      { id: 'best', label: 'Best', tip: 'Tests multiple suitable models and picks the best result' },
    ];
    for (const m of modes) {
      const item = el('button', { class: `segmented-item ${State.mode === m.id ? 'active' : ''}`, 'data-tooltip': m.tip }, m.label);
      item.addEventListener('click', () => {
        State.mode = m.id;
        $$('#modeSeg .segmented-item').forEach(b => b.classList.toggle('active', b === item));
        if (m.id === 'best') this._showToast('Best Quality mode tests all available models', 'info');
      });
      modeSeg.appendChild(item);
    }
    modeSec.appendChild(modeSeg); panel.appendChild(modeSec);
    // UPSCALE
    const scaleSec = el('div', { class: 'panel-section' });
    scaleSec.appendChild(el('div', { class: 'panel-title' }, 'Upscale'));
    const scaleSeg = el('div', { class: 'segmented', id: 'scaleSeg' });
    for (const s of [{ val: 2, label: '2×' }, { val: 4, label: '4×' }, { val: 8, label: '8×' }]) {
      const item = el('button', { class: `segmented-item ${State.scale === s.val ? 'active' : ''}` }, s.label);
      item.addEventListener('click', () => {
        State.scale = s.val;
        $$('#scaleSeg .segmented-item').forEach(b => b.classList.toggle('active', b === item));
        this._updateDimensionPreview();
      });
      scaleSeg.appendChild(item);
    }
    scaleSec.appendChild(scaleSeg);
    const dimPrev = el('div', { class: 'mt-3', id: 'dimPreview', style: { fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' } });
    scaleSec.appendChild(dimPrev); this._updateDimensionPreview(dimPrev);
    panel.appendChild(scaleSec);
    // MODEL
    const modelSec = el('div', { class: 'panel-section' });
    modelSec.appendChild(el('div', { class: 'panel-title' }, 'Model'));
    const ml = el('div', { class: 'model-list', id: 'modelList' });
    modelSec.appendChild(ml); this._renderModelList(ml);
    panel.appendChild(modelSec);
    // ADVANCED
    const advSec = el('div', { class: 'panel-section' });
    const advTrig = el('button', { class: 'collapsible-trigger', id: 'advTrigger' },
      el('span', {}, 'Advanced'), el('span', { class: 'chevron', html: ICONS.chevronRight }));
    advSec.appendChild(advTrig);
    const advContent = el('div', { class: 'collapsible-content', id: 'advContent' });
    advContent.innerHTML = `
      <div class="slider-row mt-3"><span class="slider-label">Denoise</span><input type="range" class="slider" id="advDenoise" min="0" max="1" step="0.05" value="${State.advanced.denoise}"><span class="slider-value" id="advDenoiseVal">${State.advanced.denoise.toFixed(2)}</span></div>
      <div class="slider-row"><span class="slider-label">Sharpen</span><input type="range" class="slider" id="advSharpen" min="0" max="1" step="0.05" value="${State.advanced.sharpen}"><span class="slider-value" id="advSharpenVal">${State.advanced.sharpen.toFixed(2)}</span></div>
      <div class="slider-row"><span class="slider-label">Texture</span><input type="range" class="slider" id="advTexture" min="0" max="1" step="0.05" value="${State.advanced.texture}"><span class="slider-value" id="advTextureVal">${State.advanced.texture.toFixed(2)}</span></div>
      <div class="slider-row"><span class="slider-label">Color</span><input type="range" class="slider" id="advColor" min="0" max="1" step="0.05" value="${State.advanced.colorCorrection}"><span class="slider-value" id="advColorVal">${State.advanced.colorCorrection.toFixed(2)}</span></div>
      <div class="slider-row"><span class="slider-label">Tile Size</span><input type="range" class="slider" id="advTileSize" min="0" max="1024" step="64" value="${State.advanced.tileSize}"><span class="slider-value" id="advTileSizeVal">${State.advanced.tileSize === 0 ? 'Auto' : State.advanced.tileSize}</span></div>
      <div class="slider-row"><span class="slider-label">Padding</span><input type="range" class="slider" id="advTilePad" min="0" max="32" step="4" value="${State.advanced.tilePadding}"><span class="slider-value" id="advTilePadVal">${State.advanced.tilePadding}</span></div>
      <div class="mt-3"><span class="slider-label" style="display:block;margin-bottom:6px;">Output Format</span><div class="segmented" id="fmtSeg">
        <button class="segmented-item ${State.advanced.outputFormat === 'png' ? 'active' : ''}" data-fmt="png">PNG</button>
        <button class="segmented-item ${State.advanced.outputFormat === 'jpg' ? 'active' : ''}" data-fmt="jpg">JPG</button>
        <button class="segmented-item ${State.advanced.outputFormat === 'webp' ? 'active' : ''}" data-fmt="webp">WEBP</button>
      </div></div>`;
    advSec.appendChild(advContent); panel.appendChild(advSec);
    advTrig.addEventListener('click', () => { advTrig.classList.toggle('open'); advContent.classList.toggle('open'); });
    setTimeout(() => {
      const bind = (id, vid, key) => { const s = $(id); if (!s) return; s.addEventListener('input', e => { State.advanced[key] = parseFloat(e.target.value); $(vid).textContent = parseFloat(e.target.value).toFixed(2); }); };
      bind('#advDenoise', '#advDenoiseVal', 'denoise');
      bind('#advSharpen', '#advSharpenVal', 'sharpen');
      bind('#advTexture', '#advTextureVal', 'texture');
      bind('#advColor', '#advColorVal', 'colorCorrection');
      $('#advTileSize')?.addEventListener('input', e => { State.advanced.tileSize = parseInt(e.target.value); $('#advTileSizeVal').textContent = State.advanced.tileSize === 0 ? 'Auto' : State.advanced.tileSize; });
      $('#advTilePad')?.addEventListener('input', e => { State.advanced.tilePadding = parseInt(e.target.value); $('#advTilePadVal').textContent = State.advanced.tilePadding; });
      $$('#fmtSeg .segmented-item').forEach(b => b.addEventListener('click', () => {
        $$('#fmtSeg .segmented-item').forEach(x => x.classList.remove('active'));
        b.classList.add('active'); State.advanced.outputFormat = b.dataset.fmt;
      }));
    }, 0);
    // FACE
    const faceSec = el('div', { class: 'panel-section' }); faceSec.id = 'faceSection';
    faceSec.appendChild(el('div', { class: 'panel-title' }, el('span', {}, 'Face Restoration'), el('span', { class: 'badge badge-purple' }, 'CodeFormer')));
    const fp = el('div', { class: 'face-panel', id: 'facePanel' });
    this._renderFacePanel(fp); faceSec.appendChild(fp); panel.appendChild(faceSec);
    // ENHANCE BUTTON
    const actSec = el('div', { class: 'panel-section', style: { borderBottom: 'none' } });
    const btn = el('button', { class: 'btn btn-primary btn-lg btn-block', id: 'enhanceBtn', onclick: () => this._runEnhancement(), html: `${ICONS.sparkles} Enhance Image` });
    actSec.appendChild(btn); panel.appendChild(actSec);
    return panel;
  },

  _updateDimensionPreview(pe) {
    const e = pe || $('#dimPreview'); if (!e) return;
    if (!State.originalAnalysis) { e.textContent = ''; return; }
    const a = State.originalAnalysis; const nw = a.width * State.scale, nh = a.height * State.scale;
    e.innerHTML = `<span style="color:var(--text-secondary)">${a.width} × ${a.height}</span> <span style="color:var(--text-muted)">→</span> <span style="color:var(--accent-text)">${nw} × ${nh}</span> <span style="color:var(--text-muted)">(${formatMP(nw, nh)})</span>`;
    if (nw * nh > 100000000) e.innerHTML += `<div style="color:var(--warning);font-size:var(--font-size-xs);margin-top:4px">Large output — may take significant time and memory</div>`;
  },

  _renderModelList(c) {
    c.innerHTML = '';
    const caps = State.capabilities;
    if (!caps) { c.innerHTML = '<div style="color:var(--text-muted);font-size:var(--font-size-sm);padding:4px 0">Loading models…</div>'; return; }
    const auto = el('div', { class: `model-item ${State.model === 'auto' ? 'selected' : ''}`, onclick: () => { State.model = 'auto'; this._renderModelList(c); } });
    auto.innerHTML = '<div class="model-info"><div class="model-name">Auto</div><div class="model-meta">AI Router selects best model</div></div>';
    c.appendChild(auto);
    for (const m of caps.models) {
      const available = m.status === 'available';
      const scales = (m.supported_scales || []).map(s => s + '×').join('/');
      const item = el('div', { class: `model-item ${!available ? 'disabled' : ''} ${State.model === m.id ? 'selected' : ''}` });
      if (available) item.addEventListener('click', () => { State.model = m.id; this._renderModelList(c); });
      let badge;
      if (m.status === 'available') badge = '<span class="badge badge-success">Ready</span>';
      else if (m.status === 'unsupported') badge = '<span class="badge badge-neutral">Coming Soon</span>';
      else if (m.notes) badge = '<span class="badge badge-neutral">Not Installed</span>';
      else badge = '<span class="badge badge-neutral">Not Installed</span>';
      const meta = m.name || m.id;
      item.innerHTML = `<div class="model-info"><div class="model-name">${m.family} ${scales}</div><div class="model-meta">${meta}</div></div>${badge}`;
      c.appendChild(item);
    }
  },

  _renderFacePanel(p) {
    p.innerHTML = '';
    const caps = State.capabilities;
    const cf = caps?.models?.find(m => m.backend === 'codeformer');
    const a = State.originalAnalysis;
    const fi = a?.faces || { count: 0, source: null };
    if (cf?.status === 'available') {
      p.appendChild(el('div', { class: 'face-info' }, el('span', { class: 'badge badge-success' }, 'Ready'), el('span', { class: 'hint' }, 'CodeFormer ready')));
    } else {
      p.appendChild(el('div', { class: 'face-info' }, el('span', { class: 'badge badge-neutral' }, 'Not Installed'), el('span', { class: 'hint' }, 'Using fallback enhancement')));
    }
    if (!a) { p.appendChild(el('div', { class: 'hint', style: { marginTop: 'var(--sp-2)' } }, 'Load an image to detect faces')); return; }
    if (fi.count > 0) {
      p.appendChild(el('div', { class: 'face-info', style: { marginTop: 'var(--sp-2)' } },
        el('span', { class: 'badge badge-info' }, `${fi.count} face${fi.count > 1 ? 's' : ''} detected`),
        el('span', { class: 'hint' }, `via ${fi.source || 'detector'}`)));
      p.appendChild(el('div', { class: 'slider-row', style: { marginTop: 'var(--sp-3)' } },
        el('span', { class: 'slider-label' }, 'Enable'),
        el('input', { type: 'checkbox', id: 'faceToggle', checked: State.faceEnabled, style: { accentColor: 'var(--accent)' } })));
      p.querySelector('#faceToggle')?.addEventListener('change', e => State.faceEnabled = e.target.checked);
      p.appendChild(el('div', { class: 'slider-row' },
        el('span', { class: 'slider-label' }, 'Fidelity'),
        el('input', { type: 'range', class: 'slider', id: 'faceFidelity', min: '0', max: '1', step: '0.05', value: String(State.faceFidelity) }),
        el('span', { class: 'slider-value', id: 'faceFidelityVal' }, State.faceFidelity.toFixed(2))));
      p.querySelector('#faceFidelity')?.addEventListener('input', e => { State.faceFidelity = parseFloat(e.target.value); $('#faceFidelityVal').textContent = State.faceFidelity.toFixed(2); });
      p.appendChild(el('div', { class: 'hint', style: { marginTop: 'var(--sp-2)', lineHeight: '1.5' } }, 'Higher restoration may reconstruct more facial detail but can alter identity.'));
    } else {
      p.appendChild(el('div', { class: 'face-info', style: { marginTop: 'var(--sp-2)' } },
        el('span', { class: 'badge badge-neutral' }, 'No faces'),
        el('span', { class: 'hint' }, fi.source ? `via ${fi.source}` : 'no detector available')));
    }
  },
});

// ===== RIGHT PANEL =====
Object.assign(App, {
  _buildRightPanel() {
    const panel = el('aside', { class: 'panel panel-right' });
    // INFO
    const infoSec = el('div', { class: 'panel-section' });
    infoSec.appendChild(el('div', { class: 'panel-title' }, 'Image Information'));
    const ic = el('div', { class: 'result-card', id: 'infoCard' });
    this._renderInfoCard(ic); infoSec.appendChild(ic); panel.appendChild(infoSec);
    // ROUTER
    const routerSec = el('div', { class: 'panel-section' });
    routerSec.appendChild(el('div', { class: 'panel-title' }, el('span', {}, 'AI Router'), el('span', { class: 'badge badge-info' }, 'Auto')));
    const rp = el('div', { class: 'router-panel', id: 'routerPanel' });
    this._renderRouterPanel(rp); routerSec.appendChild(rp); panel.appendChild(routerSec);
    // RESULT
    const rs = el('div', { class: 'panel-section hidden', id: 'resultSection' });
    rs.appendChild(el('div', { class: 'panel-title' }, 'Enhancement Result'));
    const rc = el('div', { class: 'result-card', id: 'resultCard' }); rs.appendChild(rc);
    const ra = el('div', { class: 'btn-row mt-3', id: 'resultActions' }); rs.appendChild(ra);
    panel.appendChild(rs);
    // QUALITY
    const qs = el('div', { class: 'panel-section hidden', id: 'qualitySection' });
    qs.appendChild(el('div', { class: 'panel-title' }, 'Quality Analysis'));
    const qc = el('div', { id: 'qualityContent' }); qs.appendChild(qc);
    this._renderQualityPanel(qc); panel.appendChild(qs);
    // CANDIDATES
    const cs = el('div', { class: 'panel-section hidden', id: 'candidateSection' });
    cs.appendChild(el('div', { class: 'panel-title' }, 'Candidates'));
    const cl = el('div', { class: 'candidate-list', id: 'candidateList' }); cs.appendChild(cl);
    panel.appendChild(cs);
    return panel;
  },

  _renderInfoCard(card) {
    card.innerHTML = '';
    const a = State.originalAnalysis;
    if (!a) { card.innerHTML = '<div style="color:var(--text-muted);font-size:var(--font-size-sm);text-align:center;padding:var(--sp-2) 0">No image loaded</div>'; return; }
    for (const [label, value] of [
      ['Dimensions', `${a.width} × ${a.height}`], ['Megapixels', formatMP(a.width, a.height)],
      ['Aspect Ratio', a.aspect_ratio.toFixed(2)], ['Type', a.image_type],
      ['Resolution', a.resolution_class], ['Degradation', a.degradation], ['Contrast', a.contrast.toFixed(1)],
    ]) { card.appendChild(el('div', { class: 'result-stat' }, el('span', { class: 'stat-label' }, label), el('span', { class: 'stat-value' }, value))); }
  },

  _renderRouterPanel(p) {
    p.innerHTML = '';
    const a = State.originalAnalysis;
    if (!a) { p.innerHTML = '<div style="color:var(--text-muted);font-size:var(--font-size-sm);text-align:center;padding:var(--sp-2) 0">Load an image to analyze</div>'; return; }
    let rec = 'Real-ESRGAN x4plus', reason = 'General-purpose photo enhancement';
    if (a.image_type === 'document_or_banner') { rec = 'SwinIR'; reason = 'Document-type image detected'; }
    else if (a.degradation === 'soft_or_blurry') { rec = 'Restoration pipeline'; reason = 'Image appears blurry or soft'; }
    else if (a.resolution_class === 'very_low' || a.resolution_class === 'low') { rec = 'Real-ESRGAN x4plus'; reason = 'Low resolution photograph'; }
    for (const [label, value] of [
      ['Detected', a.image_type.charAt(0).toUpperCase() + a.image_type.slice(1)],
      ['Recommended', rec], ['Confidence', a.resolution_class === 'high' ? 'Medium' : 'High'], ['Reason', reason],
    ]) { p.appendChild(el('div', { class: 'router-row' }, el('span', { class: 'r-label' }, label), el('span', { class: 'r-value' }, value))); }
    const conf = a.resolution_class === 'high' ? 60 : 85;
    p.appendChild(el('div', { class: 'confidence-bar' }, el('div', { class: 'confidence-fill', style: { width: conf + '%' } })));
  },

  _renderQualityPanel(c) {
    c.innerHTML = '';
    const q = State.enhancedMeta?.quality;
    if (!q) {
      c.innerHTML = `<div style="text-align:center;padding:var(--sp-3) 0"><div style="color:var(--text-muted);font-size:var(--font-size-sm);margin-bottom:var(--sp-2)">Quality evaluation unavailable</div><div style="color:var(--text-dim);font-size:var(--font-size-xs)">Enable evaluation during enhancement to see scores</div></div>`;
      return;
    }
    const metrics = [
      { label: 'Fidelity', value: q.fidelity ?? q.psnr_score, good: 80 },
      { label: 'Detail', value: q.detail ?? q.detail_score, good: 70 },
      { label: 'Artifacts', value: q.artifacts ?? q.artifact_score, good: 20, invert: true },
      { label: 'Face Preservation', value: q.face_preservation ?? q.face_score, good: 80 },
    ];
    for (const m of metrics) {
      if (m.value == null) continue;
      const pct = clamp(m.value, 0, 100);
      const isGood = m.invert ? m.value <= m.good : m.value >= m.good;
      const cls = isGood ? 'good' : (m.invert ? 'bad' : 'medium');
      c.appendChild(el('div', { class: 'quality-bar-row' },
        el('span', { class: 'quality-label' }, m.label),
        el('div', { class: 'quality-track' }, el('div', { class: `quality-fill ${cls}`, style: { width: pct + '%' } })),
        el('span', { class: 'quality-score' }, Math.round(m.value))));
    }
  },

  _updateResultPanel() {
    const sec = $('#resultSection'); if (!sec || !State.enhancedMeta) return;
    sec.classList.remove('hidden');
    const card = $('#resultCard'); const m = State.enhancedMeta; card.innerHTML = '';
    for (const [label, value] of [
      ['Original', m.originalDims], ['Enhanced', m.dimensions], ['Model', m.model || m.pipeline], ['Runtime', m.runtime],
      ['Device', m.device || '—'], ['Scale', State.scale + '×'],
    ]) { card.appendChild(el('div', { class: 'result-stat' }, el('span', { class: 'stat-label' }, label), el('span', { class: 'stat-value' }, value))); }
    if (m.usedFallback) {
      const warn = el('div', { class: 'fallback-warning' });
      warn.innerHTML = `<div class="fallback-icon">⚠</div><div><div class="fallback-title">Fallback Enhancement Used</div><div class="fallback-reason">${m.fallbackReason || 'Model unavailable'}</div></div>`;
      card.appendChild(warn);
    }
    const act = $('#resultActions'); act.innerHTML = '';
    act.appendChild(el('button', { class: 'btn btn-primary btn-sm', onclick: () => this._downloadResult(), html: `${ICONS.download} Download` }));
    act.appendChild(el('button', { class: 'btn btn-secondary btn-sm', onclick: () => this._navigate('compare'), html: `${ICONS.compare} Compare` }));
    act.appendChild(el('button', { class: 'btn btn-secondary btn-sm', onclick: () => this._runEnhancement(), html: `${ICONS.refresh} Again` }));
    act.appendChild(el('button', { class: 'btn btn-ghost btn-sm', onclick: () => this._saveToHistory(), html: `${ICONS.save} Save` }));
    const qs = $('#qualitySection');
    if (qs) { qs.classList.remove('hidden'); this._renderQualityPanel($('#qualityContent')); }
  },

  // ===== ENHANCEMENT =====
  async _runEnhancement() {
    if (!State.originalFile) { this._showToast('No image selected', 'warning'); return; }
    if (State.isProcessing) return;
    State.isProcessing = true;
    const ov = $('#processingOverlay'), lbl = $('#processingLabel'), sub = $('#processingSub'), prog = $('#progressFill'), btn = $('#enhanceBtn');
    if (ov) ov.classList.remove('hidden');
    if (lbl) lbl.textContent = 'Analyzing Image…';
    if (sub) sub.textContent = State.originalFile.name;
    if (prog) { prog.classList.add('indeterminate'); prog.style.width = ''; }
    if (btn) { btn.disabled = true; btn.innerHTML = '<div class="spinner" style="width:16px;height:16px;border-width:2px"></div> Processing…'; }
    this._updateStatus('busy', 'Analyzing…', State.model === 'auto' ? 'Auto' : State.model);
    const start = Date.now();
    try {
      const apiMode = State.mode === 'best' ? 'auto' : State.mode;
      const apiFid = State.mode === 'fidelity' ? 0.9 : State.mode === 'detail' ? 0.5 : State.faceFidelity || State.fidelity;
      if (lbl) lbl.textContent = 'Running Enhancement…';
      if (sub) sub.textContent = `${State.scale}× upscale · ${State.model === 'auto' ? 'Auto' : State.model}`;
      this._updateStatus('busy', 'Processing…', State.model === 'auto' ? 'Auto' : State.model);
      const result = await API.enhanceImage(State.originalFile, { mode: apiMode, scale: State.scale, fidelity: apiFid, evaluate: true });
      const elapsed = Date.now() - start;
      if (State.enhancedUrl) URL.revokeObjectURL(State.enhancedUrl);
      State.enhancedUrl = result.url; State.enhancedBlob = result.blob;
      State.enhancedMeta = {
        pipeline: result.pipeline, model: result.model || result.pipeline, imageType: result.imageType,
        runtime: result.runtime ? formatDuration(result.runtime * 1000) : formatDuration(elapsed),
        device: result.device || '—',
        usedFallback: result.usedFallback || false,
        fallbackReason: result.fallbackReason || null,
        originalDims: result.originalSize || (State.originalAnalysis ? `${State.originalAnalysis.width} × ${State.originalAnalysis.height}` : '—'),
        dimensions: result.enhancedSize || (State.originalAnalysis ? `${State.originalAnalysis.width * State.scale} × ${State.originalAnalysis.height * State.scale}` : '—'),
        mp: State.originalAnalysis ? formatMP(State.originalAnalysis.width * State.scale, State.originalAnalysis.height * State.scale) : '—',
        quality: result.quality,
      };
      State.isProcessing = false;
      if (ov) ov.classList.add('hidden');
      if (btn) { btn.disabled = false; btn.innerHTML = `${ICONS.sparkles} Enhance Image`; }
      this._updateStatus('complete', 'Complete', result.model || result.pipeline);
      State.viewMode = 'single'; State.showOriginal = false;
      this._navigate('enhance');
      if (result.usedFallback) {
        this._showToast(`Enhancement used fallback: ${result.fallbackReason || 'model unavailable'}`, 'warning');
      } else {
        this._showToast(`Enhanced with ${result.model || result.pipeline} in ${result.runtime ? result.runtime.toFixed(1) + 's' : formatDuration(elapsed)}`, 'success');
      }
    } catch (err) {
      State.isProcessing = false;
      if (ov) ov.classList.add('hidden');
      if (btn) { btn.disabled = false; btn.innerHTML = `${ICONS.sparkles} Enhance Image`; }
      this._updateStatus('error', 'Error', '—');
      this._showError(err.message || 'Enhancement failed', err.stack || '');
    }
  },

  _downloadResult() {
    if (!State.enhancedUrl) return;
    const ext = State.advanced.outputFormat === 'jpg' ? 'jpg' : State.advanced.outputFormat === 'webp' ? 'webp' : 'png';
    const a = el('a', { href: State.enhancedUrl, download: `enhanced_${Date.now()}.${ext}` });
    document.body.appendChild(a); a.click(); a.remove();
  },

  _saveToHistory() {
    if (!State.enhancedUrl || !State.originalAnalysis) return;
    History.add({
      id: Date.now().toString(), date: Date.now(),
      originalName: State.originalFile?.name || 'image',
      originalDims: `${State.originalAnalysis.width} × ${State.originalAnalysis.height}`,
      enhancedDims: State.enhancedMeta?.dimensions || '—',
      model: State.enhancedMeta?.pipeline || 'unknown', scale: State.scale,
      runtime: State.enhancedMeta?.runtime || '—',
      originalUrl: State.originalUrl, enhancedUrl: State.enhancedUrl,
    });
    this._showToast('Saved to history', 'success');
  },
});

// ===== COMPARE / HISTORY / BENCHMARKS / SETTINGS =====
Object.assign(App, {
  _renderComparePage(body) {
    if (!State.originalUrl || !State.enhancedUrl) {
      body.innerHTML = `<div class="page"><div class="empty-state"><div class="empty-state-icon">${ICONS.compare}</div><div class="empty-state-title">No images to compare</div><div class="empty-state-text">Enhance an image first, then come back here to compare original and enhanced side by side.</div><button class="btn btn-primary mt-3" onclick="App._navigate('enhance')">Go to Enhance</button></div></div>`;
      return;
    }
    const ca = el('div', { class: 'canvas-area', style: { flex: 1 } });
    const tb = el('div', { class: 'tab-bar' });
    const modes = [{ id: 'side-by-side', label: 'Side by Side' }, { id: 'split', label: 'Split' }, { id: 'overlay', label: 'Overlay' }, { id: 'difference', label: 'Difference' }];
    const activeMode = ['side-by-side','split','overlay','difference'].includes(State.viewMode) ? State.viewMode : 'side-by-side';
    for (const m of modes) {
      const t = el('button', { class: `tab-item ${activeMode === m.id ? 'active' : ''}`, onclick: () => { State.viewMode = m.id; this._navigate('compare'); } }, m.label);
      tb.appendChild(t);
    }
    ca.appendChild(tb);
    const toolbar = el('div', { class: 'canvas-toolbar' });
    toolbar.innerHTML = `
      <button class="tb-btn" id="cmpZoomOut">${ICONS.zoomOut}</button>
      <div style="display:flex;align-items:center;padding:0 6px;"><span style="font-size:var(--font-size-sm);color:var(--text-secondary);min-width:42px;text-align:center;font-variant-numeric:tabular-nums;">100%</span></div>
      <button class="tb-btn" id="cmpZoomIn">${ICONS.zoomIn}</button><div class="tb-divider"></div>
      <button class="tb-btn" id="cmpFit">${ICONS.fit}</button><button class="tb-btn" id="cmpActual">${ICONS.actualSize}</button>
      <div class="spacer"></div>
      <button class="btn btn-secondary btn-sm" id="cmpDownload">${ICONS.download} Download Enhanced</button>`;
    ca.appendChild(toolbar);
    const vp = el('div', { class: 'canvas-viewport' }); vp.id = 'cmpViewport';
    ca.appendChild(vp); body.appendChild(ca);
    if (activeMode === 'overlay') this._renderOverlay(vp);
    else if (activeMode === 'split') this._renderSplit(vp);
    else if (activeMode === 'difference') this._renderDifference(vp);
    else this._renderSideBySide(vp);
    $('#cmpDownload')?.addEventListener('click', () => this._downloadResult());
  },

  _renderHistoryPage(body) {
    const page = el('div', { class: 'page' });
    page.innerHTML = `<div class="page-header"><div class="page-title">History</div><div class="page-subtitle">Your processed images</div></div>`;
    if (State.history.length === 0) {
      page.innerHTML += `<div class="empty-state"><div class="empty-state-icon">${ICONS.history}</div><div class="empty-state-title">No history yet</div><div class="empty-state-text">Your processed images will appear here.</div><button class="btn btn-primary mt-3" onclick="App._navigate('enhance')">Go to Enhance</button></div>`;
      body.appendChild(page); return;
    }
    const headerRow = el('div', { class: 'flex items-center justify-between mt-4', style: { marginBottom: 'var(--sp-4)' } });
    headerRow.innerHTML = `<div class="flex gap-2"><button class="tb-btn active">${ICONS.grid}</button><button class="tb-btn">${ICONS.list}</button></div><button class="btn btn-danger btn-sm" id="clearHist">${ICONS.trash} Clear All</button>`;
    page.appendChild(headerRow);
    const grid = el('div', { class: 'history-grid' });
    for (const item of State.history) {
      const card = el('div', { class: 'history-card' });
      card.innerHTML = `<div class="history-thumb"><img src="${item.enhancedUrl || item.originalUrl}" alt="${item.originalName}"></div><div class="history-info"><div class="history-name">${item.originalName}</div><div class="history-meta">${item.originalDims} → ${item.enhancedDims} · ${item.model} · ${formatDate(item.date)}</div></div>`;
      const actions = el('div', { class: 'flex', style: { gap: '2px', padding: '8px 12px', borderTop: '1px solid var(--border-subtle)' } });
      actions.appendChild(el('button', { class: 'tb-btn', 'data-tooltip': 'Open', onclick: () => { State.originalUrl = item.originalUrl; State.enhancedUrl = item.enhancedUrl; this._navigate('compare'); }, html: ICONS.image }));
      actions.appendChild(el('button', { class: 'tb-btn', 'data-tooltip': 'Download', onclick: () => { const a = el('a', { href: item.enhancedUrl, download: item.originalName }); document.body.appendChild(a); a.click(); a.remove(); }, html: ICONS.download }));
      actions.appendChild(el('button', { class: 'tb-btn', 'data-tooltip': 'Delete', onclick: () => { History.remove(item.id); this._navigate('history'); }, html: ICONS.trash }));
      card.appendChild(actions); grid.appendChild(card);
    }
    page.appendChild(grid);
    $('#clearHist')?.addEventListener('click', () => { if (confirm('Clear all history?')) { History.clear(); this._navigate('history'); } });
    body.appendChild(page);
  },

  _renderBenchmarksPage(body) {
    const page = el('div', { class: 'page' });
    page.innerHTML = `<div class="page-header"><div class="page-title">Benchmarks</div><div class="page-subtitle">Compare model performance across image types</div></div>
      <div class="empty-state"><div class="empty-state-icon">${ICONS.chart}</div><div class="empty-state-title">No benchmark results yet</div><div class="empty-state-text">Run your first benchmark to compare models on quality, runtime, and memory usage.</div><button class="btn btn-primary mt-3" onclick="App._showToast('Benchmark runner is not yet available on the backend', 'info')">Run Benchmark</button></div>`;
    body.appendChild(page);
  },

  _renderSettingsPage(body) {
    const page = el('div', { class: 'page' });
    const caps = State.capabilities;
    page.innerHTML = `<div class="page-header"><div class="page-title">Settings</div><div class="page-subtitle">Configure hardware, models, and processing defaults</div></div>`;
    // Hardware
    const hw = el('div', { class: 'settings-group' });
    const device = caps?.device?.device || 'cpu';
    const dd = { cuda: 'CUDA (NVIDIA GPU)', mps: 'Apple MPS', cpu: 'CPU' }[device] || device.toUpperCase();
    const vram = caps?.device?.vram_gb;
    hw.innerHTML = `<div class="settings-group-title">Hardware</div>
      <div class="setting-row"><div><div class="setting-label">Device</div><div class="setting-hint">${dd}</div></div><div class="setting-control"><span class="badge badge-info">${device.toUpperCase()}</span></div></div>
      <div class="setting-row"><div><div class="setting-label">VRAM</div><div class="setting-hint">${vram ? vram + ' GB' : 'N/A'}</div></div></div>
      <div class="setting-row"><div><div class="setting-label">Precision</div><div class="setting-hint">FP32 (default)</div></div></div>`;
    page.appendChild(hw);
    // Models
    const mg = el('div', { class: 'settings-group' });
    mg.innerHTML = `<div class="settings-group-title">Models</div>`;
    if (caps) {
      mg.innerHTML += `<div class="setting-row"><div><div class="setting-label">Models Directory</div><div class="setting-hint text-mono" style="font-size:var(--font-size-xs)">${caps.models_dir}</div></div></div>`;
      for (const m of caps.models) {
        mg.innerHTML += `<div class="setting-row"><div><div class="setting-label">${m.family} ${m.scale}×</div><div class="setting-hint text-mono" style="font-size:var(--font-size-xs)">${m.weight_path}</div></div><div class="setting-control"><span class="${m.installed ? 'badge badge-success' : 'badge badge-neutral'}">${m.installed ? 'Installed' : 'Missing'}</span></div></div>`;
      }
    }
    page.appendChild(mg);
    // Processing
    const proc = el('div', { class: 'settings-group' });
    proc.innerHTML = `<div class="settings-group-title">Processing Defaults</div>
      <div class="setting-row"><div><div class="setting-label">Default Scale</div><div class="setting-hint">Used when no scale is selected</div></div><div class="setting-control"><span class="badge badge-neutral">4×</span></div></div>
      <div class="setting-row"><div><div class="setting-label">Default Mode</div><div class="setting-hint">Auto routing by default</div></div><div class="setting-control"><span class="badge badge-info">Auto</span></div></div>
      <div class="setting-row"><div><div class="setting-label">Tile Size</div><div class="setting-hint">0 = automatic</div></div><div class="setting-control"><span class="badge badge-neutral">Auto</span></div></div>`;
    page.appendChild(proc);
    // Storage
    const storage = el('div', { class: 'settings-group' });
    storage.innerHTML = `<div class="settings-group-title">Storage</div>
      <div class="setting-row"><div><div class="setting-label">Output Format</div><div class="setting-hint">PNG for lossless quality</div></div><div class="setting-control"><span class="badge badge-neutral">PNG</span></div></div>
      <div class="setting-row"><div><div class="setting-label">History</div><div class="setting-hint">${State.history.length} items in local storage</div></div><div class="setting-control"><button class="btn btn-secondary btn-sm" id="clearHistSet">${ICONS.trash} Clear</button></div></div>`;
    page.appendChild(storage);
    body.appendChild(page);
    $('#clearHistSet')?.addEventListener('click', () => { if (confirm('Clear all history?')) { History.clear(); this._navigate('settings'); } });
  },

  // ===== CAPABILITIES & STATUS =====
  async _loadCapabilities() {
    try {
      State.capabilities = await API.getCapabilities();
      const d = State.capabilities.device;
      const dn = { cuda: 'CUDA', mps: 'MPS', cpu: 'CPU' }[d.device] || d.device.toUpperCase();
      $('#deviceName').textContent = dn; $('#statusDevice').textContent = dn;
      $('#deviceBadge .dot')?.classList.remove('idle');
    } catch {
      $('#deviceName').textContent = 'Offline';
      const dot = $('#deviceBadge .dot');
      if (dot) { dot.classList.remove('idle'); dot.classList.add('error'); }
    }
  },

  _updateStatus(state, label, model) {
    const dot = $('#statusDot'), sl = $('#statusLabel'), sm = $('#statusModel'), ss = $('#statusScale'), hs = $('#headerStatus'), bd = $('#deviceBadge .dot');
    if (dot) dot.className = `status-dot ${state}`;
    if (bd) bd.className = `dot ${state === 'busy' ? 'busy' : state === 'error' ? 'error' : ''}`;
    if (sl) sl.textContent = label;
    if (hs) hs.textContent = label;
    if (sm) sm.textContent = model || '—';
    if (ss) ss.textContent = State.scale ? State.scale + '×' : '—';
  },

  // ===== TOAST =====
  _showToast(msg, type = 'info') {
    const colors = { success: 'var(--success)', warning: 'var(--warning)', error: 'var(--error)', info: 'var(--info)' };
    const t = el('div', { style: { position: 'fixed', bottom: '48px', left: '50%', transform: 'translateX(-50%)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', padding: '10px 20px', borderRadius: 'var(--radius)', border: '1px solid ' + (colors[type] || colors.info), boxShadow: 'var(--shadow-lg)', zIndex: '300', fontSize: 'var(--font-size-base)', opacity: '0', transition: 'opacity 200ms ease', pointerEvents: 'none' } }, msg);
    document.body.appendChild(t);
    requestAnimationFrame(() => t.style.opacity = '1');
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 200); }, 3000);
  },

  // ===== ERROR =====
  _showError(message, detail = '') {
    $('#processingOverlay')?.classList.add('hidden');
    let title = 'Enhancement Failed', suggestion = '';
    const ml = message.toLowerCase();
    if (ml.includes('not installed') || ml.includes('model')) { title = 'MODEL NOT AVAILABLE'; suggestion = 'The selected model is not installed. Try choosing a different model or use Auto mode.'; }
    else if (message.includes('413') || ml.includes('too large')) { title = 'IMAGE TOO LARGE'; suggestion = 'The image exceeds the maximum upload size (50 MB) or pixel limit (50 MP).'; }
    else if (message.includes('400') || ml.includes('not a recognized')) { title = 'INVALID IMAGE'; suggestion = 'The file could not be decoded. Make sure it is a valid JPG, PNG, WEBP, or TIFF.'; }
    const box = el('div', { class: 'error-box', style: { position: 'absolute', bottom: 'var(--sp-4)', left: 'var(--sp-4)', right: 'var(--sp-4)', zIndex: 30 } });
    box.innerHTML = `<div class="error-title">${ICONS.alertTriangle} ${title}</div><div style="font-size:var(--font-size-sm);color:var(--text-secondary);margin-bottom:8px">${message}</div>${suggestion ? `<div style="font-size:var(--font-size-sm);color:var(--text-muted);margin-bottom:8px">${suggestion}</div>` : ''}${detail ? `<details class="error-detail"><summary>Technical details</summary><pre>${detail}</pre></details>` : ''}<button class="btn btn-secondary btn-sm mt-3" onclick="this.parentElement.remove()">Dismiss</button>`;
    const ca = $('.canvas-area'); if (ca) ca.appendChild(box); else this._showToast(message, 'error');
  },

  // ===== SHORTCUTS =====
  _showShortcuts() {
    const ov = el('div', { class: 'modal-overlay', onclick: e => { if (e.target === ov) ov.remove(); } });
    const m = el('div', { class: 'modal' });
    m.innerHTML = `<div class="modal-header"><div class="modal-title">Keyboard Shortcuts</div><button class="icon-btn" onclick="this.closest('.modal-overlay').remove()">${ICONS.close}</button></div>
      <div class="modal-body">
        <div class="shortcut-row"><span class="shortcut-label">Show Original</span><span class="kbd">O</span></div>
        <div class="shortcut-row"><span class="shortcut-label">Show Enhanced</span><span class="kbd">E</span></div>
        <div class="shortcut-row"><span class="shortcut-label">Before/After Toggle</span><span class="kbd">Space</span></div>
        <div class="shortcut-row"><span class="shortcut-label">100% View</span><span class="kbd">1</span></div>
        <div class="shortcut-row"><span class="shortcut-label">Fit to Screen</span><span class="kbd">F</span></div>
        <div class="shortcut-row"><span class="shortcut-label">Zoom In</span><span class="kbd">+</span></div>
        <div class="shortcut-row"><span class="shortcut-label">Zoom Out</span><span class="kbd">−</span></div>
        <div class="shortcut-row"><span class="shortcut-label">Reset View</span><span class="kbd">R</span></div>
        <div class="shortcut-row"><span class="shortcut-label">Toggle Compare</span><span class="kbd">C</span></div>
        <div class="shortcut-row"><span class="shortcut-label">Open Image</span><span><span class="kbd">Ctrl</span> <span class="kbd">O</span></span></div>
        <div class="shortcut-row"><span class="shortcut-label">Save / Download</span><span><span class="kbd">Ctrl</span> <span class="kbd">S</span></span></div>
      </div>`;
    ov.appendChild(m); document.body.appendChild(ov);
  },

  // ===== GLOBAL EVENTS =====
  _bindGlobalEvents() {
    let dc = 0;
    window.addEventListener('dragenter', e => { e.preventDefault(); dc++; if (State.page === 'enhance' && !State.originalUrl) $('#dropZone')?.classList.add('dragover'); });
    window.addEventListener('dragleave', () => { dc = Math.max(0, dc - 1); if (dc === 0) $('#dropZone')?.classList.remove('dragover'); });
    window.addEventListener('dragover', e => e.preventDefault());
    window.addEventListener('drop', e => { e.preventDefault(); dc = 0; $('#dropZone')?.classList.remove('dragover'); if (e.dataTransfer.files[0]?.type.startsWith('image/')) this._handleFile(e.dataTransfer.files[0]); });
    window.addEventListener('paste', e => { const items = e.clipboardData?.items; if (!items) return; for (const item of items) { if (item.type.startsWith('image/')) { const f = item.getAsFile(); if (f) this._handleFile(f); return; } } });
    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
      if (e.ctrlKey || e.metaKey) { switch (e.key.toLowerCase()) { case 'o': e.preventDefault(); this._createFileInput().click(); break; case 's': e.preventDefault(); this._downloadResult(); break; } return; }
      switch (e.key) {
        case 'o': case 'O': State.showOriginal = !State.showOriginal; if (State.page === 'enhance') this._navigate('enhance'); break;
        case 'e': case 'E': State.showOriginal = false; if (State.page === 'enhance') this._navigate('enhance'); break;
        case ' ': e.preventDefault(); if (State.page === 'enhance' && State.enhancedUrl) { State.viewMode = State.viewMode === 'single' ? 'side-by-side' : 'single'; this._navigate('enhance'); } break;
        case '1': this.viewer?.actualSize(); break;
        case 'f': case 'F': this.viewer?.fit(); break;
        case '+': case '=': this.viewer?.zoomIn(); break;
        case '-': case '_': this.viewer?.zoomOut(); break;
        case 'r': case 'R': this.viewer?.reset(); break;
        case 'c': case 'C': if (State.page === 'enhance' && State.enhancedUrl) { State.viewMode = State.viewMode === 'side-by-side' ? 'single' : 'side-by-side'; this._navigate('enhance'); } break;
      }
    });
  },
});

if (typeof window !== 'undefined') window.App = App;
