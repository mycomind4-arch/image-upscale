"""
Benchmark Harness — compare enhancement pipelines across test images.

Usage:
    python -m backend.benchmark --generate-samples --run

Or from Python:
    from backend.benchmark import BenchmarkRunner
    runner = BenchmarkRunner()
    runner.generate_samples()
    results = runner.run_all()
    print(runner.report(results))
"""
import os
import io
import time
import json
import random
from pathlib import Path
from dataclasses import dataclass, asdict
from typing import Optional
import numpy as np
from PIL import Image, ImageFilter

from backend.analyzer import analyze_image
from backend.router import choose_pipeline
from backend.pipelines import run_pipeline
from backend.quality import score_candidate


BENCH_DIR = Path(__file__).parent.parent / 'benchmarks'
SAMPLE_DIR = BENCH_DIR / 'samples'
RESULTS_DIR = BENCH_DIR / 'results'


@dataclass
class BenchResult:
    image: str
    category: str
    pipeline: str
    scale: int
    runtime_ms: float
    original_dims: str
    enhanced_dims: str
    quality: dict
    analysis: dict


class BenchmarkRunner:
    """Run enhancement benchmarks across sample images and pipelines."""

    CATEGORIES = [
        'portrait', 'old_photo', 'jpeg_compressed', 'low_light',
        'landscape', 'product', 'document', 'artwork', 'anime',
    ]

    def generate_samples(self, size=(400, 300)):
        """Generate synthetic test images for each category."""
        SAMPLE_DIR.mkdir(parents=True, exist_ok=True)
        w, h = size

        for cat in self.CATEGORIES:
            img = self._make_sample(cat, w, h)
            path = SAMPLE_DIR / f'{cat}.png'
            img.save(path)
            print(f'  Generated {path.name} ({img.size[0]}x{img.size[1]})')

    def _make_sample(self, category: str, w: int, h: int) -> Image.Image:
        """Create a synthetic image for a given category."""
        rng = np.random.default_rng(hash(category) & 0xFFFFFFFF)

        if category == 'portrait':
            # Skin-tone gradient with a face-like shape
            arr = np.full((h, w, 3), [200, 170, 150], dtype=np.uint8)
            # Add a face oval
            cy, cx = h // 2, w // 2
            for y in range(h):
                for x in range(w):
                    dx = (x - cx) / (w * 0.3)
                    dy = (y - cy) / (h * 0.4)
                    if dx * dx + dy * dy < 1.0:
                        shade = 1.0 - 0.15 * (dx * dx + dy * dy)
                        arr[y, x] = [int(c * shade) for c in [210, 180, 160]]
            arr = self._add_noise(arr, rng, 8)
            return Image.fromarray(arr).filter(ImageFilter.GaussianBlur(0.8))

        elif category == 'old_photo':
            # Sepia-toned, noisy, slightly blurred
            arr = np.full((h, w, 3), [180, 150, 120], dtype=np.uint8)
            arr = self._add_noise(arr, rng, 25)
            arr = self._add_vignette(arr, strength=0.6)
            img = Image.fromarray(arr).filter(ImageFilter.GaussianBlur(1.2))
            return img

        elif category == 'jpeg_compressed':
            # Color image with JPEG compression artifacts
            arr = self._make_gradient(rng, w, h)
            img = Image.fromarray(arr)
            buf = io.BytesIO()
            img.save(buf, format='JPEG', quality=15)  # heavy compression
            buf.seek(0)
            return Image.open(buf).convert('RGB')

        elif category == 'low_light':
            # Dark, noisy image
            arr = np.full((h, w, 3), [20, 25, 30], dtype=np.uint8)
            arr = self._add_noise(arr, rng, 30)
            # Add some dim highlights
            for _ in range(5):
                y, x = rng.integers(0, h), rng.integers(0, w)
                r = rng.integers(10, 30)
                for dy in range(-r, r):
                    for dx in range(-r, r):
                        yy, xx = y + dy, x + dx
                        if 0 <= yy < h and 0 <= xx < w:
                            dist = (dy * dy + dx * dx) / (r * r)
                            if dist < 1.0:
                                factor = 1.0 - dist
                                arr[yy, xx] = np.clip(arr[yy, xx] + 60 * factor, 0, 255).astype(np.uint8)
            return Image.fromarray(arr)

        elif category == 'landscape':
            # Sky-to-ground gradient
            arr = np.zeros((h, w, 3), dtype=np.uint8)
            horizon = h * 2 // 3
            arr[:horizon] = [120, 160, 200]  # sky
            arr[horizon:] = [60, 100, 50]    # ground
            arr = self._add_noise(arr, rng, 10)
            arr = self._add_vignette(arr, strength=0.3)
            return Image.fromarray(arr)

        elif category == 'product':
            # Clean product shot — white background, object in center
            arr = np.full((h, w, 3), [245, 245, 245], dtype=np.uint8)
            cy, cx = h // 2, w // 2
            for y in range(h):
                for x in range(w):
                    dx = (x - cx) / (w * 0.25)
                    dy = (y - cy) / (h * 0.3)
                    d = dx * dx + dy * dy
                    if d < 1.0:
                        arr[y, x] = [60, 80, 120]
                    elif d < 1.1:
                        arr[y, x] = [100, 120, 160]
            arr = self._add_noise(arr, rng, 5)
            return Image.fromarray(arr)

        elif category == 'document':
            # Black text on white background
            arr = np.full((h, w, 3), [250, 250, 250], dtype=np.uint8)
            # Add text-like lines
            for _ in range(20):
                y = rng.integers(20, h - 20)
                x_start = rng.integers(10, w // 2)
                x_end = rng.integers(w // 2, w - 10)
                thickness = rng.integers(2, 4)
                arr[y:y + thickness, x_start:x_end] = [30, 30, 30]
            arr = self._add_noise(arr, rng, 5)
            return Image.fromarray(arr)

        elif category == 'artwork':
            # Colorful abstract pattern
            arr = np.zeros((h, w, 3), dtype=np.uint8)
            for _ in range(15):
                cy, cx = rng.integers(0, h), rng.integers(0, w)
                r = rng.integers(20, 80)
                color = rng.integers(0, 255, size=3)
                for y in range(max(0, cy - r), min(h, cy + r)):
                    for x in range(max(0, cx - r), min(w, cx + r)):
                        dist = np.sqrt((y - cy) ** 2 + (x - cx) ** 2)
                        if dist < r:
                            alpha = 1.0 - dist / r
                            arr[y, x] = np.clip(arr[y, x] * (1 - alpha) + color * alpha, 0, 255).astype(np.uint8)
            arr = self._add_noise(arr, rng, 5)
            return Image.fromarray(arr)

        elif category == 'anime':
            # Flat colors with bold outlines
            arr = np.full((h, w, 3), [255, 220, 180], dtype=np.uint8)
            # Add color blocks
            for _ in range(8):
                y, x = rng.integers(0, h - 60), rng.integers(0, w - 60)
                color = rng.integers(100, 255, size=3)
                arr[y:y + 50, x:x + 50] = color
            # Add outlines
            arr = np.where(arr > 200, arr, np.clip(arr - 50, 0, 255).astype(np.uint8))
            return Image.fromarray(arr)

        else:
            arr = self._add_noise(np.full((h, w, 3), [128, 128, 128], dtype=np.uint8), rng, 10)
            return Image.fromarray(arr)

    def _add_noise(self, arr: np.ndarray, rng, amount: int) -> np.ndarray:
        noise = rng.integers(-amount, amount + 1, size=arr.shape, dtype=np.int16)
        return np.clip(arr.astype(np.int16) + noise, 0, 255).astype(np.uint8)

    def _add_vignette(self, arr: np.ndarray, strength: float = 0.5) -> np.ndarray:
        h, w = arr.shape[:2]
        cy, cx = h / 2, w / 2
        Y, X = np.ogrid[:h, :w]
        dist = np.sqrt(((X - cx) / (w / 2)) ** 2 + ((Y - cy) / (h / 2)) ** 2)
        vignette = 1.0 - strength * np.clip(dist - 0.5, 0, 1)
        return np.clip(arr.astype(np.float32) * vignette[:, :, np.newaxis], 0, 255).astype(np.uint8)

    def _make_gradient(self, rng, w, h) -> np.ndarray:
        arr = np.zeros((h, w, 3), dtype=np.uint8)
        for y in range(h):
            for x in range(w):
                arr[y, x] = [
                    int(128 + 100 * np.sin(x / 30)),
                    int(128 + 100 * np.cos(y / 40)),
                    int(128 + 80 * np.sin((x + y) / 50)),
                ]
        return arr

    def run_all(self, scales=(2, 4), modes=('auto',)) -> list[BenchResult]:
        """Run benchmarks on all sample images."""
        results = []
        if not SAMPLE_DIR.exists():
            self.generate_samples()

        samples = sorted(SAMPLE_DIR.glob('*.png'))
        for sample_path in samples:
            category = sample_path.stem
            print(f'\n--- {category} ---')
            image = Image.open(sample_path).convert('RGB')
            analysis = analyze_image(image)

            for mode in modes:
                pipeline = choose_pipeline(analysis, mode=mode)
                for scale in scales:
                    print(f'  {pipeline.name} {scale}x...', end=' ', flush=True)
                    t0 = time.perf_counter()
                    result = run_pipeline(image, pipeline, scale=scale)
                    elapsed = (time.perf_counter() - t0) * 1000

                    quality = score_candidate(image, result)
                    print(f'{elapsed:.0f}ms | overall={quality["overall"]:.3f}')

                    results.append(BenchResult(
                        image=sample_path.name,
                        category=category,
                        pipeline=pipeline.name,
                        scale=scale,
                        runtime_ms=round(elapsed, 1),
                        original_dims=f'{image.width}x{image.height}',
                        enhanced_dims=f'{result.width}x{result.height}',
                        quality=quality,
                        analysis={
                            'image_type': analysis['image_type'],
                            'resolution_class': analysis['resolution_class'],
                            'degradation': analysis['degradation'],
                            'contrast': round(analysis['contrast'], 2),
                        },
                    ))

        self._save_results(results)
        return results

    def _save_results(self, results: list[BenchResult]):
        RESULTS_DIR.mkdir(parents=True, exist_ok=True)
        path = RESULTS_DIR / 'benchmark_results.json'
        data = [asdict(r) for r in results]
        with open(path, 'w') as f:
            json.dump(data, f, indent=2)
        print(f'\nResults saved to {path}')

    def report(self, results: list[BenchResult]) -> str:
        """Generate a readable summary report."""
        lines = ['Benchmark Results', '=' * 60, '']

        # Group by pipeline
        by_pipeline: dict[str, list] = {}
        for r in results:
            by_pipeline.setdefault(r.pipeline, []).append(r)

        for pipe, pipe_results in by_pipeline.items():
            lines.append(f'Pipeline: {pipe}')
            avg_runtime = sum(r.runtime_ms for r in pipe_results) / len(pipe_results)
            avg_quality = sum(r.quality['overall'] for r in pipe_results) / len(pipe_results)
            avg_sharp = sum(r.quality['sharpness_gain'] for r in pipe_results) / len(pipe_results)
            lines.append(f'  Avg runtime:  {avg_runtime:.0f}ms')
            lines.append(f'  Avg quality:  {avg_quality:.4f}')
            lines.append(f'  Avg sharp:    {avg_sharp:.3f}x')
            lines.append('')

            for r in pipe_results:
                lines.append(f'  {r.image:20s} {r.scale}x  {r.runtime_ms:6.0f}ms  Q={r.quality["overall"]:.3f}')
            lines.append('')

        # Best per category
        lines.append('Best pipeline per category:')
        by_cat: dict[str, BenchResult] = {}
        for r in results:
            if r.scale == 4:  # compare at 4x
                if r.category not in by_cat or r.quality['overall'] > by_cat[r.category].quality['overall']:
                    by_cat[r.category] = r
        for cat, r in sorted(by_cat.items()):
            lines.append(f'  {cat:20s} -> {r.pipeline} (Q={r.quality["overall"]:.3f})')

        return '\n'.join(lines)


def main():
    import argparse
    parser = argparse.ArgumentParser(description='Run enhancement benchmarks')
    parser.add_argument('--generate-samples', action='store_true', help='Generate sample images')
    parser.add_argument('--run', action='store_true', help='Run benchmarks')
    parser.add_argument('--scales', type=int, nargs='+', default=[2, 4], help='Scales to test')
    parser.add_argument('--modes', nargs='+', default=['auto'], help='Modes to test')
    args = parser.parse_args()

    runner = BenchmarkRunner()
    if args.generate_samples:
        print('Generating sample images...')
        runner.generate_samples()
    if args.run or not args.generate_samples:
        results = runner.run_all(scales=tuple(args.scales), modes=tuple(args.modes))
        print()
        print(runner.report(results))


if __name__ == '__main__':
    main()
