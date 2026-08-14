/**
 * ImageViewer — zoomable, pannable image canvas viewer
 * Uses <img> with CSS transforms for images under 50MP.
 * For larger images, uses canvas with downssampled preview.
 */
class ImageViewer {
  constructor(containerEl) {
    this.container = containerEl;
    this.img = null;
    this.canvas = null;
    this.zoom = 1;
    this.minZoom = 0.02;
    this.maxZoom = 40;
    this.panX = 0;
    this.panY = 0;
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.naturalWidth = 0;
    this.naturalHeight = 0;
    this.fitMode = true;
    this.useCanvas = false;
    this.onZoomChange = null;
    this._rotation = 0;
    this._bound = false;
    this._bindEvents();
  }

  load(src) {
    return new Promise((resolve, reject) => {
      // Determine if we need canvas mode for large images
      const tempImg = new Image();
      tempImg.onload = () => {
        // Remove old elements
        this._clear();
        this.naturalWidth = tempImg.naturalWidth;
        this.naturalHeight = tempImg.naturalHeight;
        const pixels = this.naturalWidth * this.naturalHeight;
        // Use canvas for images > 25MP to avoid DOM/memory issues
        this.useCanvas = pixels > 25_000_000;

        if (this.useCanvas) {
          this._setupCanvas(tempImg);
        } else {
          this._setupImg(tempImg);
        }
        this.fit();
        resolve(tempImg);
      };
      tempImg.onerror = () => reject(new Error('Failed to load image'));
      tempImg.src = src;
    });
  }

  _setupImg(img) {
    img.className = 'canvas-img';
    img.draggable = false;
    this.img = img;
    this.container.appendChild(img);
  }

  _setupCanvas(srcImg) {
    // Create a downsampled preview on canvas
    const canvas = document.createElement('canvas');
    const maxDim = 4096;
    const ratio = Math.min(maxDim / this.naturalWidth, maxDim / this.naturalHeight, 1);
    canvas.width = Math.round(this.naturalWidth * ratio);
    canvas.height = Math.round(this.naturalHeight * ratio);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(srcImg, 0, 0, canvas.width, canvas.height);
    canvas.className = 'canvas-img';
    canvas.draggable = false;
    this.canvas = canvas;
    // Store the display ratio for zoom calculations
    this._canvasRatio = ratio;
    this.container.appendChild(canvas);
    // Use canvas as our "img" reference
    this.img = canvas;
  }

  _clear() {
    const old = this.container.querySelector('.canvas-img');
    if (old) old.remove();
    this.img = null;
    this.canvas = null;
  }

  fit() {
    if (!this.img) return;
    this.fitMode = true;
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this._applyTransform();
    this._notifyZoom();
  }

  actualSize() {
    if (!this.img || !this.naturalWidth) return;
    this.fitMode = false;
    const containerRect = this.container.getBoundingClientRect();
    const scaleX = this.naturalWidth / containerRect.width;
    const scaleY = this.naturalHeight / containerRect.height;
    this.zoom = Math.max(scaleX, scaleY, 1);
    this.panX = 0;
    this.panY = 0;
    this._applyTransform();
    this._notifyZoom();
  }

  setZoom(z) {
    this.fitMode = false;
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, z));
    this._applyTransform();
    this._notifyZoom();
  }

  zoomIn() { this.setZoom(this.zoom * 1.4); }
  zoomOut() { this.setZoom(this.zoom / 1.4); }
  reset() { this._rotation = 0; this.fit(); }
  rotate() { this._rotation = (this._rotation + 90) % 360; this._applyTransform(); }

  getZoomPercent() {
    return Math.round(this.zoom * 100);
  }

  _applyTransform() {
    if (!this.img) return;
    const rot = this._rotation ? ` rotate(${this._rotation}deg)` : '';
    this.img.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})${rot}`;
  }

  _notifyZoom() {
    if (this.onZoomChange) this.onZoomChange(this.getZoomPercent());
  }

  _bindEvents() {
    if (this._bound) return;
    this._bound = true;
    const el = this.container;

    el.addEventListener('wheel', (e) => {
      if (!this.img) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.85 : 1.18;
      // Zoom toward cursor
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;
      const oldZoom = this.zoom;
      this.setZoom(this.zoom * delta);
      const ratio = this.zoom / oldZoom;
      this.panX = cx - (cx - this.panX) * ratio;
      this.panY = cy - (cy - this.panY) * ratio;
      this._applyTransform();
    }, { passive: false });

    el.addEventListener('mousedown', (e) => {
      if (!this.img) return;
      this.isDragging = true;
      this.dragStartX = e.clientX - this.panX;
      this.dragStartY = e.clientY - this.panY;
      this.img.classList.add('dragging');
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      this.panX = e.clientX - this.dragStartX;
      this.panY = e.clientY - this.dragStartY;
      this._applyTransform();
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
      if (this.img) this.img.classList.remove('dragging');
    });

    // Touch support
    let touchStartX = 0, touchStartY = 0, touchStartDist = 0;
    el.addEventListener('touchstart', (e) => {
      if (!this.img) return;
      if (e.touches.length === 1) {
        this.isDragging = true;
        this.dragStartX = e.touches[0].clientX - this.panX;
        this.dragStartY = e.touches[0].clientY - this.panY;
      } else if (e.touches.length === 2) {
        this.isDragging = false;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        touchStartDist = Math.hypot(dx, dy);
      }
    }, { passive: true });

    el.addEventListener('touchmove', (e) => {
      if (!this.img) return;
      if (e.touches.length === 1 && this.isDragging) {
        e.preventDefault();
        this.panX = e.touches[0].clientX - this.dragStartX;
        this.panY = e.touches[0].clientY - this.dragStartY;
        this._applyTransform();
      } else if (e.touches.length === 2) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        const ratio = dist / touchStartDist;
        this.setZoom(this.zoom * ratio);
        touchStartDist = dist;
      }
    }, { passive: false });

    el.addEventListener('touchend', () => { this.isDragging = false; });

    el.addEventListener('dblclick', () => {
      if (!this.img) return;
      if (this.fitMode) this.actualSize();
      else this.fit();
    });
  }
}

if (typeof window !== 'undefined') window.ImageViewer = ImageViewer;
