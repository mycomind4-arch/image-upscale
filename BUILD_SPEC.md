# Image Restoration Engine — Integration Specification

## Objective

Build a single image-restoration application that dynamically selects the best restoration strategy for each input instead of blindly applying one upscaler.

## Model stack

### Commercial-safe baseline

1. Real-ESRGAN — default general/photo upscaling engine.
2. GFPGAN / CodeFormer — optional face restoration stage.
3. DiffBIR — optional blind restoration engine after confirming all upstream dependency licenses for the intended deployment.

### License-gated research engines

4. HYPIR — high-quality diffusion restoration adapter. The upstream repository currently states non-commercial-use restrictions. Keep disabled unless commercial permission is obtained.
5. SUPIR — photo-realistic diffusion restoration adapter. The upstream repository currently states non-commercial-use restrictions. Keep disabled unless commercial permission is obtained.

Do not copy model weights into this repository. Download them at deployment time into a model volume.

## Architecture

```text
Browser
  |
  v
FastAPI API
  |
  +--> image analyzer
  |       |
  |       +--> dimensions
  |       +--> brightness / contrast
  |       +--> blur estimate
  |       +--> compression estimate
  |       +--> face detection
  |       +--> photo / artwork / document classifier
  |
  +--> model router
  |       |
  |       +--> fast/general -> Real-ESRGAN
  |       +--> portrait     -> face restoration + Real-ESRGAN
  |       +--> degraded     -> DiffBIR
  |       +--> premium      -> HYPIR/SUPIR when licensed
  |
  +--> quality evaluator
  |       |
  |       +--> perceptual quality
  |       +--> artifact detection
  |       +--> fidelity score
  |       +--> hallucination/reconstruction warning
  |
  v
Output + metadata
```

## Important product behavior

The default mode should be **Auto**. The user should not need to know which model is being used.

Expose three user-facing controls:

- Scale: 2x / 4x / 8x
- Fidelity: Authentic / Balanced / Detail
- Mode: Auto / Fast / Photo / Restoration

Advanced users can optionally select an exact engine.

## Fidelity principle

The system must distinguish between:

- information recovered from the source
- information reconstructed by a generative model

The output metadata should report the selected engine and whether generative reconstruction was used.

## Model adapter contract

Every engine should implement the same interface:

- `name`
- `supports(image_type)`
- `estimate_cost(image, scale)`
- `estimate_quality(image, settings)`
- `run(input_path, output_path, scale, fidelity)`
- `health()`

This allows new models to be added without changing the API or router.

## Benchmark system

Create a benchmark directory containing representative images for:

- low-resolution portraits
- old photographs
- JPEG-compressed photographs
- low-light photographs
- landscapes
- product photographs
- text/document images
- artwork
- anime/illustration

For every image, compare each enabled pipeline and record:

- PSNR where ground truth exists
- SSIM where ground truth exists
- LPIPS where appropriate
- face identity similarity for portraits
- runtime
- VRAM usage
- output resolution
- human quality rating
- hallucination/artifact flags

The router should eventually be trained from these benchmark results.

## Deployment

Use a CPU API container and separate NVIDIA GPU worker containers. Never make the web process perform long-running GPU inference directly in production.

Suggested production flow:

```text
Next.js frontend
      |
      v
FastAPI API
      |
      v
Redis job queue
      |
      +--> fast GPU worker
      +--> restoration GPU worker
      +--> premium GPU worker
      |
      v
Object storage
```

## Security requirements

- Validate MIME type and actual image decoding.
- Reject oversized uploads before decoding.
- Apply maximum pixel count to prevent decompression bombs.
- Generate random job IDs.
- Store uploads outside the web root.
- Never execute user-supplied filenames as shell commands.
- Avoid shell interpolation in model adapters; use argument arrays where possible.
- Add authentication and per-user quotas before public deployment.
- Automatically expire source images and intermediate files.
- Strip sensitive metadata from public outputs unless the user explicitly requests preservation.

## UI requirements

The first screen should be a premium drag-and-drop image workspace with:

- original preview
- enhanced preview
- synchronized zoom
- before/after slider
- 100% pixel view
- detected image characteristics
- selected pipeline
- fidelity indicator
- processing time
- output resolution
- download button

The product should feel like an image restoration workstation, not a generic file uploader.

## Initial implementation order

1. FastAPI service and upload validation.
2. Real-ESRGAN adapter.
3. Analyzer.
4. Router.
5. Before/after viewer.
6. Face restoration adapter.
7. DiffBIR adapter.
8. Benchmark harness.
9. Quality evaluator.
10. GPU queue architecture.
11. Optional license-gated HYPIR/SUPIR adapters.
12. Learned routing.
