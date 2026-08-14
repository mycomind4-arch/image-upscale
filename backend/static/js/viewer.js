/**
 * ImageViewer — zoomable, pannable image canvas viewer
 * Handles large images efficiently using CSS transforms on a single <img>.
 */
class ImageViewer {
  constructor(containerEl) {
    this.container = containerEl;
    this.img = null;
    this.zoom = 1;
    this.minZoom = 0.05;
    this.maxZoom = 32;
    this.panX = 0;
    this.panY = 0;
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.naturalWidth = 0;
    this.naturalHeight = 0;
    this.fitMode = true;
    this.onZoomChange = null;

    this._bindEvents();
  }

  load(src) {
    return new Promise((resolve, reject) => {
      const img = document.createElement('img');
      img.className = 'canvas-img';
      img.draggable = false;
      img.onload = () => {
        // Remove old image
        const old = this.container.querySelector('.canvas-img');
        if (old) old.remove();
        this.img = img;
        this.container.appendChild(img);
        this.naturalWidth = img.naturalWidth;
        this.naturalHeight = img.naturalHeight;
        this.fit();
        resolve(img);
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = src;
    });
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

  zoomIn() { this.setZoom(this.zoom * 1.5); }
  zoomOut() { this.setZoom(this.zoom / 1.5); }
  reset() { this.fit(); }

  getZoomPercent() {
    return Math.round(this.zoom * 100);
  }

  _applyTransform() {
    if (!this.img) return;
    this.img.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
  }

  _notifyZoom() {
    if (this.onZoomChange) this.onZoomChange(this.getZoomPercent());
  }

  _bindEvents() {
    const el = this.container;

    el.addEventListener('wheel', (e) => {
      if (!this.img) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.85 : 1.15;
      this.setZoom(this.zoom * delta);
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

    el.addEventListener('dblclick', () => {
      if (!this.img) return;
      if (this.fitMode) this.actualSize();
      else this.fit();
    });
  }
}

// Export
if (typeof window !== 'undefined') window.ImageViewer = ImageViewer;
