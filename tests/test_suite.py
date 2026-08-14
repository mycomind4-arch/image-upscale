"""
Image Upscale Lab — Automated Test Suite
Tests analyzer, model registry, model selection, scale validation,
image validation, API responses, quality evaluation, error handling.
"""
import pytest
import requests
import io
from PIL import Image, ImageDraw

BASE_URL = "http://127.0.0.1:8771"

@pytest.fixture
def small_jpg():
    img = Image.new('RGB', (100, 100), (100, 150, 200))
    draw = ImageDraw.Draw(img)
    draw.ellipse([20, 20, 80, 80], outline=(255, 0, 0), width=3)
    buf = io.BytesIO()
    img.save(buf, 'JPEG', quality=85)
    buf.seek(0)
    return ('test.jpg', buf, 'image/jpeg')

@pytest.fixture
def small_png():
    img = Image.new('RGB', (100, 100), (100, 150, 200))
    buf = io.BytesIO()
    img.save(buf, 'PNG')
    buf.seek(0)
    return ('test.png', buf, 'image/png')

@pytest.fixture
def tiny_png():
    img = Image.new('RGB', (16, 16), (200, 100, 50))
    buf = io.BytesIO()
    img.save(buf, 'PNG')
    buf.seek(0)
    return ('tiny.png', buf, 'image/png')

@pytest.fixture
def grayscale_png():
    img = Image.new('L', (200, 200), 128)
    buf = io.BytesIO()
    img.save(buf, 'PNG')
    buf.seek(0)
    return ('gray.png', buf, 'image/png')

class TestAnalyzer:
    def test_analyze_jpg(self, small_jpg):
        r = requests.post(f"{BASE_URL}/analyze", files={'file': small_jpg})
        assert r.status_code == 200
        d = r.json()
        assert d['width'] == 100
        assert d['height'] == 100
        assert 'aspect_ratio' in d
        assert 'image_type' in d
        assert 'faces' in d

    def test_analyze_png(self, small_png):
        r = requests.post(f"{BASE_URL}/analyze", files={'file': small_png})
        assert r.status_code == 200
        d = r.json()
        assert d['width'] == 100

    def test_analyze_tiny(self, tiny_png):
        r = requests.post(f"{BASE_URL}/analyze", files={'file': tiny_png})
        assert r.status_code == 200
        d = r.json()
        assert d['width'] == 16

    def test_analyze_grayscale(self, grayscale_png):
        r = requests.post(f"{BASE_URL}/analyze", files={'file': grayscale_png})
        assert r.status_code == 200
        d = r.json()
        assert d['width'] == 200

    def test_analyze_invalid_file(self):
        r = requests.post(f"{BASE_URL}/analyze",
                         files={'file': ('test.txt', io.BytesIO(b'not an image'), 'text/plain')})
        assert r.status_code == 415

class TestModelRegistry:
    def test_capabilities(self):
        r = requests.get(f"{BASE_URL}/capabilities")
        assert r.status_code == 200
        d = r.json()
        assert 'models' in d
        assert 'device' in d
        assert len(d['models']) > 0

    def test_available_models(self):
        r = requests.get(f"{BASE_URL}/capabilities")
        d = r.json()
        available = [m for m in d['models'] if m['status'] == 'available']
        assert len(available) >= 1
        for m in available:
            assert 'id' in m
            assert 'supported_scales' in m
            assert 'family' in m

    def test_model_status_honest(self):
        r = requests.get(f"{BASE_URL}/capabilities")
        d = r.json()
        for m in d['models']:
            assert m['status'] in ('available', 'not_installed', 'unsupported', 'coming_soon')

class TestRouter:
    def test_route_auto(self, small_jpg):
        r = requests.post(f"{BASE_URL}/route", files={'file': small_jpg},
                         params={'mode': 'auto', 'scale': 4})
        assert r.status_code == 200
        d = r.json()
        assert 'recommended_model' in d
        assert 'reason' in d
        assert 'confidence' in d
        assert 'alternatives' in d

    def test_route_returns_available_model(self, small_jpg):
        r = requests.post(f"{BASE_URL}/route", files={'file': small_jpg},
                         params={'mode': 'auto', 'scale': 4})
        d = r.json()
        caps = requests.get(f"{BASE_URL}/capabilities").json()
        available_ids = {m['id'] for m in caps['models'] if m['status'] == 'available'}
        assert d['recommended_model'] in available_ids

class TestScaleValidation:
    def test_4x_upscale(self, small_jpg):
        r = requests.post(f"{BASE_URL}/enhance", files={'file': small_jpg},
                         params={'mode': 'auto', 'scale': 4})
        assert r.status_code == 200
        assert r.headers.get('X-Scale') == '4'
        assert r.headers.get('X-Enhanced-Size') == '400x400'

    def test_2x_upscale(self, small_jpg):
        r = requests.post(f"{BASE_URL}/enhance", files={'file': small_jpg},
                         params={'mode': 'auto', 'scale': 2})
        assert r.status_code == 200
        assert r.headers.get('X-Scale') == '2'
        assert r.headers.get('X-Enhanced-Size') == '200x200'

class TestImageValidation:
    def test_reject_text_file(self):
        r = requests.post(f"{BASE_URL}/analyze",
                         files={'file': ('test.txt', io.BytesIO(b'hello'), 'text/plain')})
        assert r.status_code == 415

    def test_oversized_rejected(self):
        img = Image.new('RGB', (8000, 8000), (0, 0, 0))
        buf = io.BytesIO()
        img.save(buf, 'PNG')
        buf.seek(0)
        r = requests.post(f"{BASE_URL}/analyze",
                         files={'file': ('big.png', buf, 'image/png')})
        assert r.status_code in (400, 413)

class TestAPIResponses:
    def test_health(self):
        r = requests.get(f"{BASE_URL}/health")
        assert r.status_code == 200
        d = r.json()
        assert d['status'] == 'ok'

    def test_security(self):
        r = requests.get(f"{BASE_URL}/security")
        assert r.status_code == 200
        d = r.json()
        assert 'max_upload_mb' in d
        assert 'allowed_formats' in d

    def test_enhance_returns_png(self, small_jpg):
        r = requests.post(f"{BASE_URL}/enhance", files={'file': small_jpg},
                         params={'mode': 'auto', 'scale': 4})
        assert r.status_code == 200
        assert r.headers.get('content-type') == 'image/png'

    def test_enhance_headers(self, small_jpg):
        r = requests.post(f"{BASE_URL}/enhance", files={'file': small_jpg},
                         params={'mode': 'auto', 'scale': 4, 'evaluate': 'true'})
        assert r.headers.get('X-Model') is not None
        assert r.headers.get('X-Device') is not None
        assert r.headers.get('X-Runtime') is not None
        assert r.headers.get('X-Used-Fallback') is not None
        assert r.headers.get('X-Original-Size') is not None
        assert r.headers.get('X-Enhanced-Size') is not None

class TestQuality:
    def test_quality_evaluation(self, small_jpg):
        r = requests.post(f"{BASE_URL}/enhance", files={'file': small_jpg},
                         params={'mode': 'auto', 'scale': 4})
        assert r.status_code == 200
        enhanced = r.content
        small_jpg[1].seek(0)
        r2 = requests.post(f"{BASE_URL}/quality",
                          files={'original': small_jpg,
                                'enhanced': ('enhanced.png', io.BytesIO(enhanced), 'image/png')})
        assert r2.status_code == 200
        d = r2.json()
        assert 'fidelity' in d
        assert 'sharpness' in d
        assert 'overall' in d
        assert 0 <= d['fidelity'] <= 1
        assert 0 <= d['overall'] <= 1

class TestErrorHandling:
    def test_no_file(self):
        r = requests.post(f"{BASE_URL}/analyze")
        assert r.status_code == 422

    def test_invalid_model(self, small_jpg):
        r = requests.post(f"{BASE_URL}/enhance-model",
                         files={'file': small_jpg},
                         params={'model_id': 'nonexistent-model', 'scale': 4})
        assert r.status_code in (400, 404, 422)
