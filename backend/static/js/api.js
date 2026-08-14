/**
 * Image Upscale Lab — Frontend API Layer
 * Clean abstraction over the FastAPI backend.
 */

const API = {
  baseUrl: '',

  async getCapabilities() {
    const res = await fetch(`${this.baseUrl}/capabilities`);
    if (!res.ok) throw new Error('Failed to fetch capabilities');
    return res.json();
  },

  async getHealth() {
    const res = await fetch(`${this.baseUrl}/health`);
    if (!res.ok) throw new Error('Health check failed');
    return res.json();
  },

  async analyzeImage(file) {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${this.baseUrl}/analyze`, { method: 'POST', body: fd });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `Analysis failed (${res.status})`);
    }
    return res.json();
  },

  async enhanceImage(file, params = {}) {
    const { mode = 'auto', scale = 4, fidelity = 0.75, evaluate = false } = params;
    const fd = new FormData();
    fd.append('file', file);
    const qs = new URLSearchParams({
      mode, scale: String(scale), fidelity: String(fidelity),
    });
    if (evaluate) qs.set('evaluate', 'true');
    const res = await fetch(`${this.baseUrl}/enhance?${qs}`, { method: 'POST', body: fd });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `Enhancement failed (${res.status})`);
    }
    const blob = await res.blob();
    const qualityRaw = res.headers.get('X-Quality-Scores');
    return {
      blob,
      url: URL.createObjectURL(blob),
      pipeline: res.headers.get('X-Pipeline') || 'unknown',
      imageType: res.headers.get('X-Analyzer') || 'photo',
      originalSize: res.headers.get('X-Original-Size') || '',
      enhancedSize: res.headers.get('X-Enhanced-Size') || '',
      quality: qualityRaw ? JSON.parse(qualityRaw) : null,
    };
  },

  async evaluateQuality(originalFile, enhancedBlob) {
    const fd = new FormData();
    fd.append('original', originalFile);
    fd.append('enhanced', enhancedBlob, 'enhanced.png');
    const res = await fetch(`${this.baseUrl}/quality`, { method: 'POST', body: fd });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `Quality evaluation failed (${res.status})`);
    }
    return res.json();
  },
};

// Export for ES modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = API;
}
