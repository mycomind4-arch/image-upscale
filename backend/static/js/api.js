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
    const { mode = 'auto', scale = 4, fidelity = 0.75 } = params;
    const fd = new FormData();
    fd.append('file', file);
    const qs = new URLSearchParams({ mode, scale: String(scale), fidelity: String(fidelity) });
    const res = await fetch(`${this.baseUrl}/enhance?${qs}`, { method: 'POST', body: fd });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `Enhancement failed (${res.status})`);
    }
    const blob = await res.blob();
    return {
      blob,
      url: URL.createObjectURL(blob),
      pipeline: res.headers.get('X-Pipeline') || 'unknown',
      imageType: res.headers.get('X-Analyzer') || 'photo',
    };
  },
};

// Export for ES modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = API;
}
