/**
 * Image Upscale Lab — Main Application
 * Professional AI image restoration workstation
 */

// ============ State ============
const State = {
  page: 'enhance',
  capabilities: null,
  originalFile: null,
  originalUrl: null,
  originalAnalysis: null,
  enhancedUrl: null,
  enhancedMeta: null,
  isProcessing: false,
  viewMode: 'single',     // single | side-by-side | split | overlay | difference
  showOriginal: false,
  // Controls
  mode: 'auto',           // auto | fidelity | balanced | detail | best
  scale: 4,               // 2 | 4 | 8
  model: 'auto',           // auto | specific model id
  fidelity: 0.75,
  // Advanced
  denoise: 0,
  sharpen: 0,
  tileSize: 0,            // 0 = auto
  outputFormat: 'png',
  // History
  history: [],
};

// ============ Helpers ============
function $(sel, parent = document) { return parent.querySelector(sel); }
function $$(sel, parent = document) { return [...parent.querySelectorAll(sel)]; }
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

function formatMP(w, h) {
  const mp = (w * h) / 1_000_000;
  return mp >= 1 ? `${mp.toFixed(1)} MP` : `${Math.round(mp * 1000)} KMP`;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ============ History (localStorage) ============
const History = {
  KEY: 'image-upscale-history',

  load() {
    try { return JSON.parse(localStorage.getItem(this.KEY) || '[]'); }
    catch { return []; }
  },

  save(items) {
    try { localStorage.setItem(this.KEY, JSON.stringify(items)); } catch {}
  },

  add(entry) {
    State.history.unshift(entry);
    this.save(State.history);
  },

  remove(id) {
    State.history = State.history.filter(h => h.id !== id);
    this.save(State.history);
  },

  clear() {
    State.history = [];
    this.save(State.history);
  },
};

// ============ App ============
const App = {
  viewer: null,

  async init() {
    State.history = History.load();
    this._buildShell();
    this._bindGlobalEvents();
    await this._loadCapabilities();
    this._navigate('enhance');
  },

  // ===== Shell =====
  _buildShell() {
    document.body.innerHTML = '';
    const shell = el('div', { class: 'app-shell' });

    // Header
    const header = el('header', { class: 'app-header' });
    header.innerHTML = `
      <div class="brand">
        <div class="brand-mark">${ICONS.enhance}</div>
        Image Upscale
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
        <div class="device-badge" id="deviceBadge">
          <span class="dot idle"></span>
          <span id="deviceName">Detecting…</span>
        </div>
        <span class="status-text" id="headerStatus">Ready</span>
      </div>
      <button class="icon-btn" id="shortcutsBtn" aria-label="Keyboard shortcuts" data-tooltip="Shortcuts">${ICONS.keyboard}</button>
    `;
    shell.appendChild(header);

    // Body
    const body = el('div', { class: 'app-body' });
    body.id = 'appBody';
    shell.appendChild(body);

    // Status bar
    const statusBar = el('footer', { class: 'status-bar' });
    statusBar.id = 'statusBar';
    statusBar.innerHTML = `
      <div class="status-item"><span class="status-dot ready" id="statusDot"></span><span id="statusLabel">Ready</span></div>
      <div class="status-item"><span>Model:</span><span class="status-value" id="statusModel">—</span></div>
      <div class="status-item"><span>Device:</span><span class="status-value" id="statusDevice">—</span></div>
      <div class="status-item"><span>Scale:</span><span class="status-value" id="statusScale">—</span></div>
      <div class="spacer"></div>
      <div class="status-item" id="statusRuntime"></div>
    `;
    shell.appendChild(statusBar);

    document.body.appendChild(shell);

    // Nav clicks
    $$('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => this._navigate(btn.dataset.page));
    });

    // Shortcuts button
    $('#shortcutsBtn').addEventListener('click', () => this._showShortcuts());
  },

  // ===== Navigation =====
  _navigate(page) {
    State.page = page;
    $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === page));
    const body = $('#appBody');
    body.innerHTML = '';

    switch (page) {
      case 'enhance': this._renderEnhancePage(body); break;
      case 'compare': this._renderComparePage(body); break;
      case 'history': this._renderHistoryPage(body); break;
      case 'benchmarks': this._renderBenchmarksPage(body); break;
      case 'settings': this._renderSettingsPage(body); break;
    }
  },

  // ===== Enhance Page =====
  _renderEnhancePage(body) {
    const leftPanel = this._buildLeftPanel();
    const canvasArea = el('div', { class: 'canvas-area' });
    const rightPanel = this._buildRightPanel();

    body.appendChild(leftPanel);
    body.appendChild(canvasArea);
    body.appendChild(rightPanel);

    if (State.originalUrl) {
      this._renderCanvas(canvasArea);
    } else {
      this._renderDropZone(canvasArea);
    }
  },

  // ===== Drop Zone =====
  _renderDropZone(canvasArea) {
    canvasArea.innerHTML = `
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
      </div>
    `;
    const dz = $('#dropZone');
    const fileInput = this._createFileInput();

    dz.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      fileInput.click();
    });
    dz.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
    });

    $('#chooseFileBtn').addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
    $('#pasteBtn').addEventListener('click', (e) => { e.stopPropagation(); this._pasteFromClipboard(); });

    // Drag/drop events
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      dz.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) this._handleFile(file);
    });
  },

  _createFileInput() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', () => {
      if (input.files[0]) this._handleFile(input.files[0]);
      input.remove();
    });
    return input;
  },

  _pasteFromClipboard() {
    navigator.clipboard.read().then(items => {
      for (const item of items) {
        for (const type of item.types) {
          if (type.startsWith('image/')) {
            item.getAsFile().then(file => this._handleFile(file));
            return;
          }
        }
      }
      this._showToast('No image found in clipboard', 'warning');
    }).catch(() => {
      this._showToast('Clipboard access denied', 'error');
    });
  },

  // ===== File Handling =====
  async _handleFile(file) {
    State.originalFile = file;
    if (State.originalUrl) URL.revokeObjectURL(State.originalUrl);
    State.originalUrl = URL.createObjectURL(file);
    State.enhancedUrl = null;
    State.enhancedMeta = null;
    State.originalAnalysis = null;

    // Auto-analyze
    try {
      const analysis = await API.analyzeImage(file);
      State.originalAnalysis = analysis;
    } catch (err) {
      console.warn('Analysis failed:', err.message);
    }

    // Re-render enhance page
    this._navigate('enhance');
  },

  // ===== Canvas (with image) =====
  _renderCanvas(canvasArea) {
    // Toolbar
    const toolbar = el('div', { class: 'canvas-toolbar' });
    toolbar.innerHTML = `
      <button class="tb-btn" id="tbZoomOut" aria-label="Zoom out" data-tooltip="Zoom out (-)">${ICONS.zoomOut}</button>
      <div class="zoom-indicator">
        <span class="zoom-value" id="zoomValue">100%</span>
      </div>
      <button class="tb-btn" id="tbZoomIn" aria-label="Zoom in" data-tooltip="Zoom in (+)">${ICONS.zoomIn}</button>
      <div class="tb-divider"></div>
      <button class="tb-btn" id="tbFit" aria-label="Fit to screen" data-tooltip="Fit (F)">${ICONS.fit}</button>
      <button class="tb-btn" id="tbActual" aria-label="Actual size" data-tooltip="Actual Size (1)">${ICONS.actualSize}</button>
      <div class="tb-divider"></div>
      <button class="tb-btn ${State.viewMode === 'side-by-side' ? 'active' : ''}" id="tbCompare" aria-label="Toggle compare" data-tooltip="Before/After (Space)">${ICONS.compare}</button>
      <button class="tb-btn" id="tbReset" aria-label="Reset view" data-tooltip="Reset (R)">${ICONS.reset}</button>
      <div class="spacer"></div>
      <button class="tb-btn" id="tbNewImage" aria-label="Open new image" data-tooltip="New Image (Ctrl+O)">${ICONS.folder}</button>
    `;
    canvasArea.appendChild(toolbar);

    // Viewport
    const viewport = el('div', { class: 'canvas-viewport' });
    viewport.id = 'canvasViewport';
    canvasArea.appendChild(viewport);

    // Processing overlay placeholder
    const overlay = el('div', { class: 'processing-overlay hidden' });
    overlay.id = 'processingOverlay';
    overlay.innerHTML = `
      <div class="spinner"></div>
      <div class="processing-label" id="processingLabel">Processing…</div>
      <div class="processing-sub" id="processingSub"></div>
      <div class="progress-bar" style="width:200px;margin-top:8px"><div class="progress-bar-fill indeterminate" id="progressFill"></div></div>
    `;
    viewport.appendChild(overlay);

    // Initialize viewer
    this.viewer = new ImageViewer(viewport);
    this.viewer.onZoomChange = (pct) => {
      const zv = $('#zoomValue');
      if (zv) zv.textContent = `${pct}%`;
    };

    // Load image
    if (State.viewMode === 'side-by-side' && State.enhancedUrl) {
      this._renderSideBySide(viewport);
    } else if (State.viewMode === 'split' && State.enhancedUrl) {
      this._renderSplitView(viewport);
    } else {
      const imgSrc = State.showOriginal ? State.originalUrl : (State.enhancedUrl || State.originalUrl);
      this.viewer.load(imgSrc);
    }

    // Info chips
    this._renderCanvasInfo(viewport);

    // Toolbar events
    this._bindCanvasToolbar();

    // If enhanced result exists, show result in right panel
    if (State.enhancedMeta) {
      this._updateResultPanel();
    }
  },

  _renderCanvasInfo(viewport) {
    const info = el('div', { class: 'canvas-info' });
    if (State.originalAnalysis) {
      const a = State.originalAnalysis;
      info.appendChild(el('div', { class: 'info-chip' },
        el('span', { class: 'label' }, 'Original'),
        el('span', { class: 'value' }, `${a.width} × ${a.height}`)
      ));
      info.appendChild(el('div', { class: 'info-chip' },
        el('span', { class: 'value' }, formatMP(a.width, a.height))
      ));
    }
    if (State.enhancedMeta) {
      const m = State.enhancedMeta;
      info.appendChild(el('div', { class: 'info-chip' },
        el('span', { class: 'label' }, 'Enhanced'),
        el('span', { class: 'value' }, m.dimensions)
      ));
      info.appendChild(el('div', { class: 'info-chip' },
        el('span', { class: 'value' }, m.mp)
      ));
    }
    if (State.enhancedMeta) {
      info.appendChild(el('div', { class: 'info-chip' },
        el('span', { class: 'label' }, 'Model'),
        el('span', { class: 'value' }, State.enhancedMeta.pipeline)
      ));
    }
    viewport.appendChild(info);
  },

  _renderSideBySide(viewport) {
    viewport.innerHTML = '';
    const container = el('div', { class: 'compare-container' });
    const left = el('div', { class: 'compare-side compare-side-left' });
    const right = el('div', { class: 'compare-side' });

    left.appendChild(el('div', { class: 'compare-label' }, 'Original'));
    right.appendChild(el('div', { class: 'compare-label' }, 'Enhanced'));

    const leftImg = el('img', { class: 'canvas-img', src: State.originalUrl, draggable: 'false' });
    const rightImg = el('img', { class: 'canvas-img', src: State.enhancedUrl, draggable: 'false' });
    left.appendChild(leftImg);
    right.appendChild(rightImg);

    container.appendChild(left);
    container.appendChild(right);
    viewport.appendChild(container);
  },

  _renderSplitView(viewport) {
    viewport.innerHTML = '';
    const split = el('div', { class: 'split-view' });
    split.innerHTML = `
      <div class="split-image-wrap left">
        <div class="compare-label">Original</div>
        <img class="canvas-img" src="${State.originalUrl}" draggable="false" style="width:100%;height:100%;object-fit:contain">
      </div>
      <div class="split-image-wrap right">
        <div class="compare-label" style="left:auto;right:8px">Enhanced</div>
        <img class="canvas-img" src="${State.enhancedUrl}" draggable="false" style="width:100%;height:100%;object-fit:contain">
      </div>
      <div class="split-divider" id="splitDivider" style="left:50%"></div>
    `;
    viewport.appendChild(split);

    // Drag divider
    const divider = $('#splitDivider');
    const rightWrap = split.querySelector('.split-image-wrap.right');
    let isDragging = false;

    const moveSplit = (clientX) => {
      const rect = split.getBoundingClientRect();
      const pct = ((clientX - rect.left) / rect.width) * 100;
      const clamped = Math.max(0, Math.min(100, pct));
      divider.style.left = `${clamped}%`;
      rightWrap.style.clipPath = `inset(0 0 0 ${clamped}%)`;
    };

    divider.addEventListener('mousedown', (e) => { isDragging = true; e.preventDefault(); });
    window.addEventListener('mousemove', (e) => { if (isDragging) moveSplit(e.clientX); });
    window.addEventListener('mouseup', () => { isDragging = false; });
  },

  _bindCanvasToolbar() {
    $('#tbZoomOut')?.addEventListener('click', () => this.viewer?.zoomOut());
    $('#tbZoomIn')?.addEventListener('click', () => this.viewer?.zoomIn());
    $('#tbFit')?.addEventListener('click', () => this.viewer?.fit());
    $('#tbActual')?.addEventListener('click', () => this.viewer?.actualSize());
    $('#tbReset')?.addEventListener('click', () => {
      State.viewMode = 'single';
      this._navigate('enhance');
    });
    $('#tbCompare')?.addEventListener('click', () => this._toggleCompare());
    $('#tbNewImage')?.addEventListener('click', () => {
      State.originalFile = null;
      State.originalUrl = null;
      State.enhancedUrl = null;
      State.enhancedMeta = null;
      State.originalAnalysis = null;
      this._navigate('enhance');
    });
  },

  _toggleCompare() {
    if (!State.enhancedUrl) {
      this._showToast('Enhance an image first to compare', 'info');
      return;
    }
    if (State.viewMode === 'side-by-side') {
      State.viewMode = 'split';
    } else if (State.viewMode === 'split') {
      State.viewMode = 'single';
    } else {
      State.viewMode = 'side-by-side';
    }
    this._navigate('enhance');
  },

  // ===== Left Panel =====
  _buildLeftPanel() {
    const panel = el('aside', { class: 'panel panel-left' });

    // Mode section
    const modeSection = el('div', { class: 'panel-section' });
    modeSection.appendChild(el('div', { class: 'panel-title' },
      el('span', {}, 'Mode'),
      el('span', { class: 'tooltip-icon', 'data-tooltip': 'Fidelity preserves original info, Detail allows stronger AI reconstruction', html: ICONS.info })
    ));
    const modeSeg = el('div', { class: 'segmented', id: 'modeSeg' });
    const modes = [
      { id: 'auto', label: 'Auto', tooltip: 'Automatic model selection' },
      { id: 'fidelity', label: 'Fidelity', tooltip: 'Preserves original information' },
      { id: 'balanced', label: 'Balanced', tooltip: 'Best general-purpose enhancement' },
      { id: 'detail', label: 'Detail', tooltip: 'Stronger AI reconstruction' },
    ];
    for (const m of modes) {
      const item = el('button', {
        class: `segmented-item ${State.mode === m.id ? 'active' : ''}`,
        'data-tooltip': m.tooltip,
      }, m.label);
      item.addEventListener('click', () => {
        State.mode = m.id;
        $$('#modeSeg .segmented-item').forEach(b => b.classList.toggle('active', b === item));
      });
      modeSeg.appendChild(item);
    }
    modeSection.appendChild(modeSeg);
    panel.appendChild(modeSection);

    // Upscale section
    const scaleSection = el('div', { class: 'panel-section' });
    scaleSection.appendChild(el('div', { class: 'panel-title' }, 'Upscale'));
    const scaleSeg = el('div', { class: 'segmented', id: 'scaleSeg' });
    const scales = [
      { val: 2, label: '2×' },
      { val: 4, label: '4×' },
      { val: 8, label: '8×' },
    ];
    for (const s of scales) {
      const item = el('button', {
        class: `segmented-item ${State.scale === s.val ? 'active' : ''}`,
      }, s.label);
      item.addEventListener('click', () => {
        State.scale = s.val;
        $$('#scaleSeg .segmented-item').forEach(b => b.classList.toggle('active', b === item));
        this._updateDimensionPreview();
      });
      scaleSeg.appendChild(item);
    }
    scaleSection.appendChild(scaleSeg);

    // Dimension preview
    const dimPreview = el('div', { class: 'mt-3', id: 'dimPreview', style: { fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' } });
    scaleSection.appendChild(dimPreview);
    this._updateDimensionPreview(dimPreview);
    panel.appendChild(scaleSection);

    // Model selection
    const modelSection = el('div', { class: 'panel-section' });
    modelSection.appendChild(el('div', { class: 'panel-title' }, 'Model'));
    const modelList = el('div', { id: 'modelList' });
    this._renderModelList(modelList);
    panel.appendChild(modelSection);

    // Advanced controls (collapsible)
    const advSection = el('div', { class: 'panel-section' });
    const advHeader = el('div', { class: 'collapse-header' });
    advHeader.innerHTML = `<span class="collapse-icon">▸</span> Advanced Controls`;
    const advContent = el('div', { class: 'collapse-content' });
    const advInner = el('div', { class: 'collapse-content-inner' });
    advInner.innerHTML = `
      <div class="slider-row mb-3">
        <span class="slider-label">Denoise</span>
        <input type="range" class="slider" id="advDenoise" min="0" max="1" step="0.05" value="0">
        <span class="slider-value" id="advDenoiseVal">0.00</span>
      </div>
      <div class="slider-row mb-3">
        <span class="slider-label">Sharpen</span>
        <input type="range" class="slider" id="advSharpen" min="0" max="1" step="0.05" value="0">
        <span class="slider-value" id="advSharpenVal">0.00</span>
      </div>
      <div class="slider-row mb-3">
        <span class="slider-label">Tile Size</span>
        <input type="range" class="slider" id="advTileSize" min="0" max="1024" step="128" value="0">
        <span class="slider-value" id="advTileSizeVal">Auto</span>
      </div>
      <div class="field-label mb-3">Output Format</div>
      <div class="segmented" id="fmtSeg">
        <button class="segmented-item active" data-fmt="png">PNG</button>
        <button class="segmented-item" data-fmt="jpg">JPG</button>
        <button class="segmented-item" data-fmt="webp">WebP</button>
      </div>
    `;
    advContent.appendChild(advInner);
    advSection.appendChild(advHeader);
    advSection.appendChild(advContent);
    panel.appendChild(advSection);

    // Collapsible behavior
    advHeader.addEventListener('click', () => {
      const icon = advHeader.querySelector('.collapse-icon');
      icon.classList.toggle('open');
      advContent.classList.toggle('open');
    });

    // Advanced slider events
    setTimeout(() => {
      const dn = $('#advDenoise'); if (dn) dn.addEventListener('input', e => {
        State.denoise = parseFloat(e.target.value);
        $('#advDenoiseVal').textContent = State.denoise.toFixed(2);
      });
      const sh = $('#advSharpen'); if (sh) sh.addEventListener('input', e => {
        State.sharpen = parseFloat(e.target.value);
        $('#advSharpenVal').textContent = State.sharpen.toFixed(2);
      });
      const ts = $('#advTileSize'); if (ts) ts.addEventListener('input', e => {
        State.tileSize = parseInt(e.target.value);
        $('#advTileSizeVal').textContent = State.tileSize === 0 ? 'Auto' : State.tileSize;
      });
      $$('#fmtSeg .segmented-item').forEach(b => b.addEventListener('click', () => {
        $$('#fmtSeg .segmented-item').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        State.outputFormat = b.dataset.fmt;
      }));
      // Face fidelity slider
      const ff = $('#faceFidelity'); if (ff) ff.addEventListener('input', e => {
        $('#faceFidelityVal').textContent = parseFloat(e.target.value).toFixed(2);
      });
    }, 0);

    // Face restoration (dynamic based on model + detection)
    const faceSection = el('div', { class: 'panel-section' });
    faceSection.id = 'faceSection';
    faceSection.appendChild(el('div', { class: 'panel-title' },
      el('span', {}, 'Face Restoration'),
      el('span', { class: 'badge badge-info' }, 'CodeFormer')
    ));
    const facePanel = el('div', { class: 'face-panel', id: 'facePanel' });
    this._renderFacePanel(facePanel);
    faceSection.appendChild(facePanel);
    panel.appendChild(faceSection);

    // Enhance button
    const actionSection = el('div', { class: 'panel-section', style: { borderBottom: 'none' } });
    const enhanceBtn = el('button', {
      class: 'btn btn-primary btn-lg btn-block',
      id: 'enhanceBtn',
      onclick: () => this._runEnhancement(),
    }, 'Enhance Image');
    actionSection.appendChild(enhanceBtn);
    panel.appendChild(actionSection);

    return panel;
  },

  _updateDimensionPreview(previewEl) {
    const el = previewEl || $('#dimPreview');
    if (!el) return;
    if (!State.originalAnalysis) {
      el.textContent = '';
      return;
    }
    const a = State.originalAnalysis;
    const nw = a.width * State.scale;
    const nh = a.height * State.scale;
    el.innerHTML = `<span style="color:var(--text-secondary)">${a.width} × ${a.height}</span> → <span style="color:var(--accent-text)">${nw} × ${nh}</span>`;
  },

  _renderModelList(container) {
    container.innerHTML = '';
    const caps = State.capabilities;
    if (!caps) return;

    // Auto option
    const autoItem = el('div', {
      class: `model-item ${State.model === 'auto' ? 'selected' : ''}`,
      onclick: () => { State.model = 'auto'; this._renderModelList(container); },
    });
    autoItem.innerHTML = `<div class="model-info"><div class="model-name">Auto</div><div class="model-meta">AI Router selects best model</div></div>`;
    if (State.model === 'auto') autoItem.classList.add('selected');
    container.appendChild(autoItem);

    for (const m of caps.models) {
      const item = el('div', { class: `model-item ${!m.installed ? 'disabled' : ''} ${State.model === m.id ? 'selected' : ''}` });
      if (m.installed) {
        item.addEventListener('click', () => { State.model = m.id; this._renderModelList(container); });
      }
      const badge = m.installed
        ? '<span class="badge badge-success">Installed</span>'
        : '<span class="badge badge-neutral">Not Installed</span>';
      item.innerHTML = `
        <div class="model-info">
          <div class="model-name">${m.family} ${m.scale}×</div>
          <div class="model-meta">${m.id}</div>
        </div>
        ${badge}
      `;
      container.appendChild(item);
    }
  },


  _renderFacePanel(panel) {
    panel.innerHTML = '';
    const caps = State.capabilities;
    const codeformerModel = caps?.models?.find(m => m.backend === 'codeformer');
    const analysis = State.originalAnalysis;
    const faceInfo = analysis?.faces || { count: 0, source: null };

    // Model status
    if (codeformerModel?.installed) {
      panel.appendChild(el('div', { class: 'face-info' },
        el('span', { class: 'badge badge-success' }, 'Installed'),
        el('span', { style: { fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' } }, 'CodeFormer ready')
      ));
    } else {
      panel.appendChild(el('div', { class: 'face-info' },
        el('span', { class: 'badge badge-neutral' }, 'Not Installed'),
        el('span', { style: { fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' } }, 'Using fallback enhancement')
      ));
    }

    // Face detection results
    if (!analysis) {
      panel.appendChild(el('div', { style: { fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', marginTop: 'var(--sp-2)' } }, 'Load an image to detect faces'));
      return;
    }

    if (faceInfo.count > 0) {
      panel.appendChild(el('div', { class: 'face-info', style: { marginTop: 'var(--sp-2)' } },
        el('span', { class: 'badge badge-success' }, `${faceInfo.count} face${faceInfo.count > 1 ? 's' : ''} detected`),
        el('span', { style: { fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' } }, `via ${faceInfo.source || 'detector'}`)
      ));
      // Fidelity slider for face restoration
      panel.appendChild(el('div', { class: 'slider-row', style: { marginTop: 'var(--sp-3)' } },
        el('span', { class: 'slider-label' }, 'Fidelity'),
        el('input', { type: 'range', class: 'slider', id: 'faceFidelity', min: '0', max: '1', step: '0.05', value: '0.7' }),
        el('span', { class: 'slider-value', id: 'faceFidelityVal' }, '0.70')
      ));
    } else {
      const detector = faceInfo.source ? `via ${faceInfo.source}` : 'no detector available';
      panel.appendChild(el('div', { class: 'face-info', style: { marginTop: 'var(--sp-2)' } },
        el('span', { class: 'badge badge-neutral' }, 'No faces'),
        el('span', { style: { fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' } }, detector)
      ));
    }
  },

  // ===== Right Panel (Inspector) =====
  _buildRightPanel() {
    const panel = el('aside', { class: 'panel panel-right' });

    // Image info
    const infoSection = el('div', { class: 'panel-section' });
    infoSection.appendChild(el('div', { class: 'panel-title' }, 'Image Information'));
    const infoCard = el('div', { class: 'result-card', id: 'infoCard' });
    this._renderInfoCard(infoCard);
    infoSection.appendChild(infoCard);
    panel.appendChild(infoSection);

    // AI Router panel
    const routerSection = el('div', { class: 'panel-section' });
    routerSection.appendChild(el('div', { class: 'panel-title' },
      el('span', {}, 'AI Router'),
      el('span', { class: 'badge badge-info' }, 'Auto')
    ));
    const routerPanel = el('div', { class: 'router-panel', id: 'routerPanel' });
    this._renderRouterPanel(routerPanel);
    routerSection.appendChild(routerPanel);
    panel.appendChild(routerSection);

    // Result panel (hidden until enhancement completes)
    const resultSection = el('div', { class: 'panel-section hidden', id: 'resultSection' });
    resultSection.appendChild(el('div', { class: 'panel-title' }, 'Enhancement Result'));
    const resultCard = el('div', { class: 'result-card', id: 'resultCard' });
    resultSection.appendChild(resultCard);
    const resultActions = el('div', { class: 'btn-row mt-3', id: 'resultActions' });
    resultSection.appendChild(resultActions);
    panel.appendChild(resultSection);

    // Quality panel (hidden unless we have scores)
    const qualitySection = el('div', { class: 'panel-section hidden', id: 'qualitySection' });
    qualitySection.appendChild(el('div', { class: 'panel-title' }, 'Quality Analysis'));
    const qualityContent = el('div', { id: 'qualityContent' });
    qualitySection.appendChild(qualityContent);
    this._renderQualityPanel(qualityContent);
    panel.appendChild(qualitySection);

    return panel;
  },

  _renderInfoCard(card) {
    card.innerHTML = '';
    const a = State.originalAnalysis;
    if (!a) {
      card.innerHTML = '<div style="color:var(--text-muted);font-size:var(--font-size-sm);text-align:center;padding:var(--sp-2) 0">No image loaded</div>';
      return;
    }

    const rows = [
      ['Dimensions', `${a.width} × ${a.height}`],
      ['Megapixels', formatMP(a.width, a.height)],
      ['Aspect Ratio', a.aspect_ratio.toFixed(2)],
      ['Type', a.image_type],
      ['Resolution', a.resolution_class],
      ['Degradation', a.degradation],
      ['Contrast', a.contrast.toFixed(1)],
    ];

    for (const [label, value] of rows) {
      card.appendChild(el('div', { class: 'result-stat' },
        el('span', { class: 'stat-label' }, label),
        el('span', { class: 'stat-value' }, value)
      ));
    }
  },

  _renderRouterPanel(panel) {
    panel.innerHTML = '';
    const a = State.originalAnalysis;
    if (!a) {
      panel.innerHTML = '<div style="color:var(--text-muted);font-size:var(--font-size-sm);text-align:center;padding:var(--sp-2) 0">Load an image to analyze</div>';
      return;
    }

    // Determine recommended model based on analysis
    let recommended = 'Real-ESRGAN x4plus';
    let reason = 'General-purpose photo enhancement';
    if (a.image_type === 'document_or_banner') {
      recommended = 'SwinIR';
      reason = 'Document-type image detected';
    } else if (a.degradation === 'soft_or_blurry') {
      recommended = 'Restoration pipeline';
      reason = 'Image appears blurry or soft';
    } else if (a.resolution_class === 'very_low' || a.resolution_class === 'low') {
      recommended = 'Real-ESRGAN x4plus';
      reason = 'Low resolution photograph';
    }

    const rows = [
      ['Detected', a.image_type.charAt(0).toUpperCase() + a.image_type.slice(1)],
      ['Recommended', recommended],
      ['Confidence', a.resolution_class === 'high' ? 'Medium' : 'High'],
      ['Reason', reason],
    ];

    for (const [label, value] of rows) {
      panel.appendChild(el('div', { class: 'router-row' },
        el('span', { class: 'r-label' }, label),
        el('span', { class: 'r-value' }, value)
      ));
    }

    // Confidence bar
    const conf = a.resolution_class === 'high' ? 60 : 85;
    panel.appendChild(el('div', { class: 'confidence-bar' },
      el('div', { class: 'confidence-fill', style: { width: `${conf}%` } })
    ));
  },

  _renderQualityPanel(container) {
    container.innerHTML = '';
    const q = State.enhancedMeta?.quality;
    if (!q) {
      container.appendChild(el('div', { style: { color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)', textAlign: 'center', padding: 'var(--sp-4) 0' } }, 'Quality evaluation unavailable'));
      return;
    }
    const rows = [
      ['Overall', q.overall.toFixed(3), q.overall > 0.7 ? 'good' : 'warn'],
      ['Fidelity', q.fidelity.toFixed(3)],
      ['Sharpness Gain', q.sharpness_gain.toFixed(2) + 'x'],
      ['Detail Gain', q.detail_gain.toFixed(2) + 'x'],
      ['Artifact Score', q.artifact_score.toFixed(3), q.artifact_score < 0.3 ? 'good' : 'warn'],
      ['Hallucination', q.hallucination.toFixed(2), q.hallucination_warning ? 'bad' : null],
    ];
    for (const [label, value, flag] of rows) {
      const row = el('div', { class: 'result-stat' });
      row.appendChild(el('span', { class: 'stat-label' }, label));
      const valSpan = el('span', { class: 'stat-value' });
      if (flag === 'good') valSpan.style.color = '#4ade80';
      else if (flag === 'warn') valSpan.style.color = '#fbbf24';
      else if (flag === 'bad') valSpan.style.color = '#f87171';
      valSpan.textContent = value;
      row.appendChild(valSpan);
      container.appendChild(row);
    }
    if (q.hallucination_warning) {
      container.appendChild(el('div', { style: { fontSize: 'var(--font-size-xs)', color: '#f87171', marginTop: 'var(--sp-2)', padding: 'var(--sp-2)', background: 'rgba(248,113,113,0.1)', borderRadius: 'var(--radius-sm)' } }, '⚠ Generative reconstruction detected in smooth regions'));
    }
  },

  _updateResultPanel() {
    if (!State.enhancedMeta) return;
    const section = $('#resultSection');
    if (!section) return;
    section.classList.remove('hidden');

    // Show quality panel if scores available
    const qSection = $('#qualitySection');
    if (qSection && State.enhancedMeta?.quality) {
      qSection.classList.remove('hidden');
      const qc = $('#qualityContent');
      if (qc) this._renderQualityPanel(qc);
    }

    const card = $('#resultCard');
    const m = State.enhancedMeta;
    card.innerHTML = '';
    const rows = [
      ['Original', m.originalDims],
      ['Enhanced', m.dimensions],
      ['Scale', `${State.scale}×`],
      ['Model', m.pipeline],
      ['Device', State.capabilities?.device?.device?.toUpperCase() || 'CPU'],
      ['Runtime', m.runtime],
    ];
    for (const [label, value] of rows) {
      card.appendChild(el('div', { class: 'result-stat' },
        el('span', { class: 'stat-label' }, label),
        el('span', { class: 'stat-value' }, value)
      ));
    }

    // Actions
    const actions = $('#resultActions');
    actions.innerHTML = '';
    const dlBtn = el('button', { class: 'btn btn-primary', onclick: () => this._downloadResult() }, `${ICONS.download} Download`);
    const cmpBtn = el('button', { class: 'btn btn-secondary', onclick: () => this._toggleCompare() }, `${ICONS.compare} Compare`);
    const againBtn = el('button', { class: 'btn btn-secondary', onclick: () => this._runEnhancement() }, `${ICONS.refresh} Enhance Again`);
    const saveBtn = el('button', { class: 'btn btn-ghost', onclick: () => this._saveToHistory() }, `${ICONS.save} Save`);
    actions.append(dlBtn, cmpBtn, againBtn, saveBtn);
  },

  // ===== Enhancement =====
  async _runEnhancement() {
    if (!State.originalFile) {
      this._showToast('No image selected', 'warning');
      return;
    }
    if (State.isProcessing) return;

    State.isProcessing = true;
    const overlay = $('#processingOverlay');
    const label = $('#processingLabel');
    const sub = $('#processingSub');
    const progress = $('#progressFill');

    if (overlay) overlay.classList.remove('hidden');
    if (label) label.textContent = 'Analyzing Image…';
    if (sub) sub.textContent = State.originalFile.name;
    if (progress) { progress.classList.add('indeterminate'); progress.style.width = ''; }

    this._updateStatus('busy', 'Analyzing…', State.model === 'auto' ? 'Auto' : State.model);

    const startTime = Date.now();

    try {
      // Map mode to API mode
      const apiMode = State.mode === 'auto' ? 'auto' : State.mode === 'fidelity' ? 'fidelity' : 'auto';
      const apiFidelity = State.mode === 'fidelity' ? 0.9 : State.mode === 'detail' ? 0.5 : State.fidelity;

      if (label) label.textContent = 'Running Enhancement…';
      if (sub) sub.textContent = `${State.scale}× upscale`;
      this._updateStatus('busy', 'Processing…', State.model === 'auto' ? 'Auto' : State.model);

      // Check if face fidelity slider exists and override
      const faceFidEl = $('#faceFidelity');
      const faceFidelity = faceFidEl ? parseFloat(faceFidEl.value) : null;
      const finalFidelity = faceFidelity !== null ? faceFidelity : apiFidelity;

      const result = await API.enhanceImage(State.originalFile, {
        mode: apiMode,
        scale: State.scale,
        fidelity: finalFidelity,
        evaluate: true,
      });

      const elapsed = Date.now() - startTime;

      // Revoke old enhanced URL
      if (State.enhancedUrl) URL.revokeObjectURL(State.enhancedUrl);
      State.enhancedUrl = result.url;
      State.enhancedMeta = {
        pipeline: result.pipeline,
        imageType: result.imageType,
        runtime: formatDuration(elapsed),
        originalDims: State.originalAnalysis ? `${State.originalAnalysis.width} × ${State.originalAnalysis.height}` : '—',
        dimensions: State.originalAnalysis ? `${State.originalAnalysis.width * State.scale} × ${State.originalAnalysis.height * State.scale}` : '—',
        mp: State.originalAnalysis ? formatMP(State.originalAnalysis.width * State.scale, State.originalAnalysis.height * State.scale) : '—',
        quality: result.quality,
      };

      State.isProcessing = false;
      if (overlay) overlay.classList.add('hidden');
      this._updateStatus('complete', 'Complete', result.pipeline);

      // Switch to single view showing enhanced
      State.viewMode = 'single';
      State.showOriginal = false;
      this._navigate('enhance');

      this._showToast('Enhancement complete', 'success');
    } catch (err) {
      State.isProcessing = false;
      if (overlay) overlay.classList.add('hidden');
      this._updateStatus('error', 'Error', '—');
      this._showError(err.message || 'Enhancement failed', err.stack || '');
    }
  },

  _downloadResult() {
    if (!State.enhancedUrl) return;
    const a = el('a', { href: State.enhancedUrl, download: `enhanced_${Date.now()}.png` });
    document.body.appendChild(a);
    a.click();
    a.remove();
  },

  _saveToHistory() {
    if (!State.enhancedUrl || !State.originalAnalysis) return;

    // For history, we store metadata. Storing the actual blob as data URL for thumbnails.
    // For large images, just store the original analysis data.
    const entry = {
      id: Date.now().toString(),
      date: Date.now(),
      originalName: State.originalFile?.name || 'image',
      originalDims: `${State.originalAnalysis.width} × ${State.originalAnalysis.height}`,
      enhancedDims: State.enhancedMeta?.dimensions || '—',
      model: State.enhancedMeta?.pipeline || 'unknown',
      scale: State.scale,
      runtime: State.enhancedMeta?.runtime || '—',
      originalUrl: State.originalUrl,
      enhancedUrl: State.enhancedUrl,
    };

    History.add(entry);
    this._showToast('Saved to history', 'success');
  },

  // ===== Compare Page =====
  _renderComparePage(body) {
    if (!State.originalUrl || !State.enhancedUrl) {
      body.innerHTML = `
        <div class="page">
          <div class="empty-state">
            <div class="empty-state-icon">${ICONS.compare}</div>
            <div class="empty-state-title">No images to compare</div>
            <div class="empty-state-text">Enhance an image first, then come back here to compare original and enhanced side by side.</div>
            <button class="btn btn-primary mt-3" onclick="App._navigate('enhance')">Go to Enhance</button>
          </div>
        </div>
      `;
      return;
    }

    // Compare workspace
    const compareArea = el('div', { class: 'canvas-area', style: { flex: 1 } });

    // Tab bar for modes
    const tabBar = el('div', { class: 'tab-bar' });
    const modes = [
      { id: 'side-by-side', label: 'Side by Side' },
      { id: 'split', label: 'Split' },
      { id: 'overlay', label: 'Overlay' },
    ];
    for (const m of modes) {
      const tab = el('button', {
        class: `tab-item ${State.viewMode === m.id ? 'active' : ''}`,
        onclick: () => {
          State.viewMode = m.id;
          this._navigate('compare');
        },
      }, m.label);
      tabBar.appendChild(tab);
    }
    compareArea.appendChild(tabBar);

    // Toolbar
    const toolbar = el('div', { class: 'canvas-toolbar' });
    toolbar.innerHTML = `
      <button class="tb-btn" id="cmpZoomOut" aria-label="Zoom out">${ICONS.zoomOut}</button>
      <div class="zoom-indicator"><span class="zoom-value" id="cmpZoomValue">100%</span></div>
      <button class="tb-btn" id="cmpZoomIn" aria-label="Zoom in">${ICONS.zoomIn}</button>
      <div class="tb-divider"></div>
      <button class="tb-btn" id="cmpFit" aria-label="Fit">${ICONS.fit}</button>
      <button class="tb-btn" id="cmpActual" aria-label="Actual size">${ICONS.actualSize}</button>
      <div class="spacer"></div>
      <button class="btn btn-secondary" id="cmpDownload">${ICONS.download} Download Enhanced</button>
    `;
    compareArea.appendChild(toolbar);

    // Viewport
    const viewport = el('div', { class: 'canvas-viewport' });
    viewport.id = 'cmpViewport';
    compareArea.appendChild(viewport);
    body.appendChild(compareArea);

    // Render based on mode
    if (State.viewMode === 'overlay') {
      this._renderOverlayView(viewport);
    } else if (State.viewMode === 'split') {
      this._renderSplitViewFull(viewport);
    } else {
      this._renderSideBySideFull(viewport);
    }

    // Bind toolbar
    $('#cmpDownload')?.addEventListener('click', () => this._downloadResult());
    // Note: zoom/pan for compare is simplified — could be wired to ImageViewer
  },

  _renderSideBySideFull(viewport) {
    const container = el('div', { class: 'compare-container' });
    const left = el('div', { class: 'compare-side compare-side-left' });
    const right = el('div', { class: 'compare-side' });

    left.appendChild(el('div', { class: 'compare-label' }, 'Original'));
    right.appendChild(el('div', { class: 'compare-label', style: { left: 'auto', right: '8px' } }, 'Enhanced'));

    left.appendChild(el('img', { class: 'canvas-img', src: State.originalUrl, draggable: 'false' }));
    right.appendChild(el('img', { class: 'canvas-img', src: State.enhancedUrl, draggable: 'false' }));

    container.appendChild(left);
    container.appendChild(right);
    viewport.appendChild(container);
  },

  _renderSplitViewFull(viewport) {
    const split = el('div', { class: 'split-view', style: { flex: 1 } });
    split.innerHTML = `
      <div class="split-image-wrap left">
        <div class="compare-label">Original</div>
        <img class="canvas-img" src="${State.originalUrl}" draggable="false" style="width:100%;height:100%;object-fit:contain">
      </div>
      <div class="split-image-wrap right">
        <div class="compare-label" style="left:auto;right:8px">Enhanced</div>
        <img class="canvas-img" src="${State.enhancedUrl}" draggable="false" style="width:100%;height:100%;object-fit:contain">
      </div>
      <div class="split-divider" id="cmpSplitDivider" style="left:50%"></div>
    `;
    viewport.appendChild(split);

    const divider = $('#cmpSplitDivider');
    const rightWrap = split.querySelector('.split-image-wrap.right');
    let isDragging = false;

    const moveSplit = (clientX) => {
      const rect = split.getBoundingClientRect();
      const pct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
      divider.style.left = `${pct}%`;
      rightWrap.style.clipPath = `inset(0 0 0 ${pct}%)`;
    };

    divider.addEventListener('mousedown', (e) => { isDragging = true; e.preventDefault(); });
    window.addEventListener('mousemove', (e) => { if (isDragging) moveSplit(e.clientX); });
    window.addEventListener('mouseup', () => { isDragging = false; });
  },

  _renderOverlayView(viewport) {
    const container = el('div', { style: { position: 'relative', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' } });
    container.innerHTML = `
      <img class="canvas-img" src="${State.enhancedUrl}" draggable="false" style="opacity:0.5;position:absolute;z-index:1">
      <img class="canvas-img" src="${State.originalUrl}" draggable="false" style="z-index:2">
      <div style="position:absolute;bottom:16px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:12px;background:rgba(18,18,20,0.85);backdrop-filter:blur(12px);border:1px solid var(--border-subtle);border-radius:var(--radius);padding:8px 16px;z-index:5">
        <span style="font-size:var(--font-size-sm);color:var(--text-muted);white-space:nowrap">Original</span>
        <input type="range" class="slider" id="overlaySlider" min="0" max="100" value="50" style="width:200px">
        <span style="font-size:var(--font-size-sm);color:var(--text-muted);white-space:nowrap">Enhanced</span>
      </div>
    `;
    viewport.appendChild(container);

    const slider = $('#overlaySlider');
    const enhancedImg = container.querySelector('img:first-child');
    slider.addEventListener('input', (e) => {
      enhancedImg.style.opacity = parseInt(e.target.value) / 100;
    });
  },

  // ===== History Page =====
  _renderHistoryPage(body) {
    body.innerHTML = '';
    const page = el('div', { class: 'page' });

    // Header
    const header = el('div', { class: 'page-header', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } });
    header.appendChild(el('div', {},
      el('div', { class: 'page-title' }, 'History'),
      el('div', { class: 'page-subtitle' }, 'Your processed images')
    ));
    if (State.history.length > 0) {
      const clearBtn = el('button', { class: 'btn btn-danger', onclick: () => {
        History.clear();
        this._navigate('history');
      } }, `${ICONS.trash} Clear All`);
      header.appendChild(clearBtn);
    }
    page.appendChild(header);

    if (State.history.length === 0) {
      page.appendChild(el('div', { class: 'empty-state' },
        el('div', { class: 'empty-state-icon', html: ICONS.history }),
        el('div', { class: 'empty-state-title' }, 'No history yet'),
        el('div', { class: 'empty-state-text' }, 'Your processed images will appear here.')
      ));
    } else {
      const grid = el('div', { class: 'history-grid' });
      for (const item of State.history) {
        const card = el('div', { class: 'history-card' });
        card.innerHTML = `
          <div class="history-thumb">
            <img src="${item.enhancedUrl || item.originalUrl}" alt="${item.originalName}">
          </div>
          <div class="history-info">
            <div class="title">${item.originalName}</div>
            <div class="meta">${item.enhancedDims} · ${item.model} · ${formatDate(item.date)}</div>
          </div>
        `;
        // Actions
        const actions = el('div', { style: { display: 'flex', gap: '4px', padding: '8px 12px', borderTop: '1px solid var(--border-subtle)' } });
        actions.appendChild(el('button', { class: 'tb-btn', 'data-tooltip': 'Open', onclick: () => {
          State.originalUrl = item.originalUrl;
          State.enhancedUrl = item.enhancedUrl;
          this._navigate('compare');
        }, html: ICONS.image }));
        actions.appendChild(el('button', { class: 'tb-btn', 'data-tooltip': 'Download', onclick: () => {
          const a = el('a', { href: item.enhancedUrl, download: item.originalName });
          document.body.appendChild(a); a.click(); a.remove();
        }, html: ICONS.download }));
        actions.appendChild(el('button', { class: 'tb-btn', 'data-tooltip': 'Delete', onclick: () => {
          History.remove(item.id);
          this._navigate('history');
        }, html: ICONS.trash }));
        card.appendChild(actions);
        grid.appendChild(card);
      }
      page.appendChild(grid);
    }

    body.appendChild(page);
  },

  // ===== Benchmarks Page =====
  _renderBenchmarksPage(body) {
    body.innerHTML = '';
    const page = el('div', { class: 'page' });
    page.innerHTML = `
      <div class="page-header">
        <div class="page-title">Benchmarks</div>
        <div class="page-subtitle">Compare model performance across image types</div>
      </div>
      <div class="empty-state">
        <div class="empty-state-icon">${ICONS.chart}</div>
        <div class="empty-state-title">No benchmark results yet</div>
        <div class="empty-state-text">Run your first benchmark to compare models on quality, runtime, and memory usage.</div>
        <button class="btn btn-primary mt-3" onclick="App._showToast('Benchmark runner is not yet available on the backend', 'info')">Run Benchmark</button>
      </div>
    `;
    body.appendChild(page);
  },

  // ===== Settings Page =====
  _renderSettingsPage(body) {
    body.innerHTML = '';
    const page = el('div', { class: 'page' });
    const caps = State.capabilities;

    page.innerHTML = `
      <div class="page-header">
        <div class="page-title">Settings</div>
        <div class="page-subtitle">Configure hardware, models, and processing defaults</div>
      </div>
    `;

    // Hardware
    const hwGroup = el('div', { class: 'settings-group' });
    hwGroup.appendChild(el('div', { class: 'settings-group-title' }, 'Hardware'));
    const device = caps?.device?.device || 'cpu';
    const deviceDisplay = { cuda: 'CUDA (NVIDIA GPU)', mps: 'Apple MPS', cpu: 'CPU' }[device] || device.toUpperCase();
    const vram = caps?.device?.vram_gb;
    hwGroup.innerHTML += `
      <div class="setting-row"><div><div class="setting-label">Device</div><div class="setting-hint">${deviceDisplay}</div></div></div>
      <div class="setting-row"><div><div class="setting-label">VRAM</div><div class="setting-hint">${vram ? vram + ' GB' : 'N/A'}</div></div></div>
      <div class="setting-row"><div><div class="setting-label">Precision</div><div class="setting-hint">FP32 (default)</div></div></div>
    `;
    page.appendChild(hwGroup);

    // Models
    const modelGroup = el('div', { class: 'settings-group' });
    modelGroup.appendChild(el('div', { class: 'settings-group-title' }, 'Models'));
    if (caps) {
      modelGroup.appendChild(el('div', { class: 'setting-row' },
        el('div', {},
          el('div', { class: 'setting-label' }, 'Models Directory'),
          el('div', { class: 'setting-hint', style: { fontFamily: 'var(--font-mono)' } }, caps.models_dir)
        )
      ));
      for (const m of caps.models) {
        modelGroup.appendChild(el('div', { class: 'setting-row' },
          el('div', {},
            el('div', { class: 'setting-label' }, `${m.family} ${m.scale}×`),
            el('div', { class: 'setting-hint', style: { fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)' } }, m.weight_path)
          ),
          el('div', { class: 'setting-control' },
            el('span', { class: m.installed ? 'badge badge-success' : 'badge badge-neutral' }, m.installed ? 'Installed' : 'Missing')
          )
        ));
      }
    }
    page.appendChild(modelGroup);

    // Processing defaults
    const procGroup = el('div', { class: 'settings-group' });
    procGroup.innerHTML = `
      <div class="settings-group-title">Processing Defaults</div>
      <div class="setting-row">
        <div><div class="setting-label">Default Scale</div><div class="setting-hint">Used when no scale is selected</div></div>
        <div class="setting-control"><div class="segmented" style="width:160px">
          <button class="segmented-item" onclick="this.parentElement.querySelectorAll('.segmented-item').forEach(b=>b.classList.remove('active'));this.classList.add('active')">2×</button>
          <button class="segmented-item active" onclick="this.parentElement.querySelectorAll('.segmented-item').forEach(b=>b.classList.remove('active'));this.classList.add('active')">4×</button>
          <button class="segmented-item" onclick="this.parentElement.querySelectorAll('.segmented-item').forEach(b=>b.classList.remove('active'));this.classList.add('active')">8×</button>
        </div></div>
      </div>
      <div class="setting-row">
        <div><div class="setting-label">Default Mode</div><div class="setting-hint">Auto routing by default</div></div>
        <div class="setting-control"><span class="badge badge-info">Auto</span></div>
      </div>
      <div class="setting-row">
        <div><div class="setting-label">Tile Size</div><div class="setting-hint">0 = automatic</div></div>
        <div class="setting-control"><span class="badge badge-neutral">Auto</span></div>
      </div>
    `;
    page.appendChild(procGroup);

    // Storage
    const storageGroup = el('div', { class: 'settings-group' });
    storageGroup.innerHTML = `
      <div class="settings-group-title">Storage</div>
      <div class="setting-row">
        <div><div class="setting-label">Output Format</div><div class="setting-hint">PNG for lossless quality</div></div>
        <div class="setting-control"><span class="badge badge-neutral">PNG</span></div>
      </div>
      <div class="setting-row">
        <div><div class="setting-label">History</div><div class="setting-hint">${State.history.length} items in local storage</div></div>
        <div class="setting-control"><button class="btn btn-secondary" onclick="History.clear();App._navigate('settings')">Clear History</button></div>
      </div>
    `;
    page.appendChild(storageGroup);

    body.appendChild(page);
  },

  // ===== Capabilities =====
  async _loadCapabilities() {
    try {
      State.capabilities = await API.getCapabilities();
      const d = State.capabilities.device;
      const deviceName = { cuda: 'CUDA', mps: 'MPS', cpu: 'CPU' }[d.device] || d.device.toUpperCase();
      $('#deviceName').textContent = deviceName;
      $('#statusDevice').textContent = deviceName;
      const dot = $('#deviceBadge .dot');
      if (dot) dot.classList.remove('idle');
    } catch (err) {
      $('#deviceName').textContent = 'Offline';
      const dot = $('#deviceBadge .dot');
      if (dot) { dot.classList.remove('idle'); dot.classList.add('error'); }
    }
  },

  // ===== Status =====
  _updateStatus(state, label, model) {
    const dot = $('#statusDot');
    const sl = $('#statusLabel');
    const sm = $('#statusModel');
    const ss = $('#statusScale');
    const headerStatus = $('#headerStatus');
    const badgeDot = $('#deviceBadge .dot');

    if (dot) { dot.className = `status-dot ${state}`; }
    if (badgeDot) { badgeDot.className = `dot ${state === 'busy' ? 'busy' : state === 'error' ? 'error' : ''}`; }
    if (sl) sl.textContent = label;
    if (headerStatus) headerStatus.textContent = label;
    if (sm) sm.textContent = model || '—';
    if (ss) ss.textContent = State.scale ? `${State.scale}×` : '—';
  },

  // ===== Toast =====
  _showToast(msg, type = 'info') {
    const colors = { success: 'var(--success)', warning: 'var(--warning)', error: 'var(--error)', info: 'var(--info)' };
    const toast = el('div', {
      style: {
        position: 'fixed', bottom: '48px', left: '50%', transform: 'translateX(-50%)',
        background: 'var(--bg-elevated)', color: 'var(--text-primary)',
        padding: '10px 20px', borderRadius: 'var(--radius)', border: `1px solid ${colors[type] || colors.info}`,
        boxShadow: 'var(--shadow-lg)', zIndex: '2000', fontSize: 'var(--font-size-base)',
        opacity: '0', transition: 'opacity 200ms ease', pointerEvents: 'none',
      },
    }, msg);
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.style.opacity = '1');
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 200); }, 3000);
  },

  // ===== Error Display =====
  _showError(message, detail = '') {
    // Show error in right panel if on enhance page
    const overlay = $('#processingOverlay');
    if (overlay) overlay.classList.add('hidden');

    const errorBox = el('div', { class: 'error-box mt-4', style: { position: 'absolute', bottom: 'var(--sp-4)', left: 'var(--sp-4)', right: 'var(--sp-4)', zIndex: 30 } });
    errorBox.innerHTML = `
      <div class="error-title">${ICONS.alertTriangle} Enhancement Failed</div>
      <div style="font-size:var(--font-size-sm);color:var(--text-secondary);margin-bottom:8px">${message}</div>
      ${detail ? `<details class="error-detail"><summary>Technical details</summary><pre>${detail}</pre></details>` : ''}
      <button class="btn btn-secondary" onclick="this.parentElement.remove()">Dismiss</button>
    `;
    const canvasArea = $('.canvas-area');
    if (canvasArea) canvasArea.appendChild(errorBox);
    else this._showToast(message, 'error');
  },

  // ===== Keyboard Shortcuts =====
  _showShortcuts() {
    const overlay = el('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === overlay) overlay.remove(); } });
    const modal = el('div', { class: 'modal' });
    modal.innerHTML = `
      <div class="modal-header">
        <div class="modal-title">Keyboard Shortcuts</div>
        <button class="icon-btn" onclick="this.closest('.modal-overlay').remove()">${ICONS.close}</button>
      </div>
      <div class="modal-body">
        <div class="shortcut-row"><span class="shortcut-label">Original</span><span class="kbd">O</span></div>
        <div class="shortcut-row"><span class="shortcut-label">Enhanced</span><span class="kbd">E</span></div>
        <div class="shortcut-row"><span class="shortcut-label">Before/After</span><span class="kbd">Space</span></div>
        <div class="shortcut-row"><span class="shortcut-label">100% view</span><span class="kbd">1</span></div>
        <div class="shortcut-row"><span class="shortcut-label">Fit to screen</span><span class="kbd">F</span></div>
        <div class="shortcut-row"><span class="shortcut-label">Zoom in</span><span class="kbd">+</span></div>
        <div class="shortcut-row"><span class="shortcut-label">Zoom out</span><span class="kbd">−</span></div>
        <div class="shortcut-row"><span class="shortcut-label">Reset view</span><span class="kbd">R</span></div>
        <div class="shortcut-row"><span class="shortcut-label">Open image</span><span><span class="kbd">Ctrl</span> <span class="kbd">O</span></span></div>
        <div class="shortcut-row"><span class="shortcut-label">Save / Download</span><span><span class="kbd">Ctrl</span> <span class="kbd">S</span></span></div>
        <div class="shortcut-row"><span class="shortcut-label">Toggle compare</span><span class="kbd">C</span></div>
      </div>
    `;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  },

  // ===== Global Events =====
  _bindGlobalEvents() {
    // Drag and drop on entire window
    let dragCounter = 0;
    window.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragCounter++;
      if (State.page === 'enhance' && !State.originalUrl) {
        $('#dropZone')?.classList.add('dragover');
      }
    });
    window.addEventListener('dragleave', () => {
      dragCounter = Math.max(0, dragCounter - 1);
      if (dragCounter === 0) $('#dropZone')?.classList.remove('dragover');
    });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      dragCounter = 0;
      $('#dropZone')?.classList.remove('dragover');
      if (e.dataTransfer.files[0]?.type.startsWith('image/')) {
        this._handleFile(e.dataTransfer.files[0]);
      }
    });

    // Clipboard paste
    window.addEventListener('paste', (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) this._handleFile(file);
          return;
        }
      }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;

      // Ctrl/Cmd shortcuts
      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 'o': e.preventDefault(); this._createFileInput().click(); break;
          case 's': e.preventDefault(); this._downloadResult(); break;
        }
        return;
      }

      switch (e.key) {
        case 'o': case 'O': State.showOriginal = !State.showOriginal; if (State.page === 'enhance') this._navigate('enhance'); break;
        case 'e': case 'E': State.showOriginal = false; if (State.page === 'enhance') this._navigate('enhance'); break;
        case ' ': e.preventDefault(); if (State.page === 'enhance') this._toggleCompare(); break;
        case '1': this.viewer?.actualSize(); break;
        case 'f': case 'F': this.viewer?.fit(); break;
        case '+': case '=': this.viewer?.zoomIn(); break;
        case '-': case '_': this.viewer?.zoomOut(); break;
        case 'r': case 'R': this.viewer?.reset(); break;
        case 'c': case 'C': if (State.page === 'enhance') this._toggleCompare(); break;
      }
    });
  },
};

if (typeof window !== 'undefined') window.App = App;
