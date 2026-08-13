# Image Upscale

A modular AI image restoration and upscaling engine. The goal is to route each image through the best available restoration pipeline rather than forcing every image through one model.

## Architecture

```text
Upload
  -> Analyzer
  -> Model Router
  -> Restoration Pipeline
       - Real-ESRGAN (fast/general)
       - Face restoration adapter
       - Diffusion restoration adapter
       - HYPIR/SUPIR adapters (optional / license-gated)
  -> Quality Evaluator
  -> Output
```

## Current design

- FastAPI service
- Pluggable model adapters
- Explicit model routing
- Authenticity/fidelity controls
- Tiled inference support
- CPU-safe analysis path
- Docker-ready GPU worker architecture
- No model weights committed to the repository

## Important licensing note

Some advanced restoration projects have restrictions that matter for a commercial product. In particular, the upstream SUPIR and HYPIR repositories currently state non-commercial-use restrictions. They are therefore implemented as optional adapters and are **not** treated as commercially cleared dependencies. Obtain appropriate permission before enabling them in a commercial deployment.

Real-ESRGAN is the initial default engine. DiffBIR can be enabled where its upstream license and dependency licenses are acceptable for the intended deployment.

## Quick start

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.app:app --reload
```

Open `http://localhost:8000`.

## GPU deployment

Use the provided Docker configuration as the starting point for an NVIDIA GPU worker. Model weights should be downloaded into a persistent model volume and never baked into the application image.

## Roadmap

1. Real-ESRGAN production inference
2. Image degradation analyzer
3. Face-aware routing
4. Quality/fidelity evaluator
5. DiffBIR adapter
6. HYPIR/SUPIR adapters behind explicit licensing flags
7. Batch jobs
8. GPU worker queue
9. Model benchmarking harness
10. Learned routing based on benchmark results
