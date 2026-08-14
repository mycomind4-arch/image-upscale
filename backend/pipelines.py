import os
import logging
from PIL import Image, ImageFilter

logger = logging.getLogger(__name__)


def _fallback(image, scale):
    out = image.resize((image.width * scale, image.height * scale), Image.Resampling.LANCZOS)
    return out.filter(ImageFilter.UnsharpMask(radius=1.2, percent=110, threshold=3))


def _fallback_face(image, scale):
    """Face-optimized fallback: stronger sharpening + bilateral smoothing for skin."""
    out = image.resize((image.width * scale, image.height * scale), Image.Resampling.LANCZOS)
    # Stronger sharpening for facial features
    out = out.filter(ImageFilter.UnsharpMask(radius=0.8, percent=140, threshold=2))
    # Light smoothing to reduce noise in flat regions (simulates skin smoothing)
    out = out.filter(ImageFilter.GaussianBlur(0.4))
    # Final mild sharpen to counteract blur on edges
    out = out.filter(ImageFilter.UnsharpMask(radius=0.6, percent=80, threshold=4))
    return out


def _realesrgan(image, scale):
    try:
        from realesrgan import RealESRGAN
        import torch
        device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        model = RealESRGAN(device, scale=4)
        model.load_weights(os.getenv('REALESRGAN_WEIGHTS', 'weights/RealESRGAN_x4plus.pth'), download=True)
        out = model.predict(image)
        return out if scale == 4 else out.resize((image.width * scale, image.height * scale), Image.Resampling.LANCZOS)
    except Exception:
        return _fallback(image, scale)


def _spandrel(image, scale):
    try:
        import torch
        from spandrel import ImageModelDescriptor, ModelLoader
        weights = os.getenv('SPANDREL_WEIGHTS')
        if not weights or not os.path.exists(weights):
            return _realesrgan(image, scale)
        model = ModelLoader().load_from_file(weights)
        if not isinstance(model, ImageModelDescriptor):
            return _realesrgan(image, scale)
        device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        model = model.to(device).eval()
        tensor = model.tensor_from_pil_image(image).to(device)
        with torch.inference_mode():
            output = model(tensor)
        return model.image_from_tensor(output)
    except Exception:
        return _realesrgan(image, scale)


def _codeformer(image, scale, fidelity=0.75):
    """Face restoration via CodeFormer.

    CodeFormer is a transformer-based face restoration model that uses a
    discrete codebook prior. It detects faces, restores each face independently,
    then blends the result back into the full image.

    Requires:
        - torch
        - facexlib (face detection)
        - CodeFormer weights (CODEFORMER_WEIGHTS env or ~/.image-upscale/models/codeformer.pth)

    Falls back to _fallback_face if any dependency is missing.
    """
    try:
        import torch
        from facexlib.utils.face_restoration_helper import FaceRestoreHelper

        device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

        # Load CodeFormer model
        weights_path = os.getenv('CODEFORMER_WEIGHTS')
        if not weights_path:
            from pathlib import Path
            weights_path = str(Path.home() / '.image-upscale' / 'models' / 'codeformer.pth')
        if not os.path.exists(weights_path):
            logger.info('CodeFormer weights not found, using face fallback')
            return _fallback_face(image, scale)

        # Upscale first with general pipeline for the background
        bg = _realesrgan(image, scale)

        # Load model architecture
        from basicsr.archs.codeformer_arch import CodeFormer
        net = CodeFormer(dim_embd=512, n_head=8, n_layers=9, codebook_size=1024,
                         latent_size=256, connect_list=['32', '64', '128', '256'],
                         fix_modules=['quantize', 'generator']).to(device)
        checkpoint = torch.load(weights_path, map_location=device)
        if 'params_ema' in checkpoint:
            net.load_state_dict(checkpoint['params_ema'])
        else:
            net.load_state_dict(checkpoint['params'])
        net.eval()

        # Face restoration helper handles detection, cropping, alignment
        face_helper = FaceRestoreHelper(
            upscale=1,  # we already upscaled the background
            face_size=512,
            det_model='retinaface_resnet50',
            save_ext='png',
            device=device,
        )
        face_helper.read_image(bg)
        face_helper.get_face_landmarks5(only_center_face=False, eye_dist_threshold=5)
        face_helper.align_warp_face()

        # Restore each face
        for idx, cropped_face in enumerate(face_helper.cropped_faces):
            cropped_face_t = net.image_to_tensor(cropped_face).unsqueeze(0).to(device) / 255.0
            with torch.inference_mode():
                # fidelity_weight controls how much to trust the codebook vs input
                # 0 = max restoration (hallucinate), 1 = min (preserve input)
                output = net(cropped_face_t, w=fidelity)[0]
            restored = net.tensor_to_image(output)
            face_helper.add_restored_face(restored)

        # Paste faces back into the upscaled background
        face_helper.get_inverse_affine(None)
        for idx in range(len(face_helper.cropped_faces)):
            face_helper.paste_to_input_image(
                face_helper.restored_faces[idx],
                face_helper.inverse_affine_matrices[idx]
            )

        return face_helper.output_image or bg

    except ImportError as e:
        logger.info(f'CodeFormer dependencies not available: {e.name}')
        return _fallback_face(image, scale)
    except Exception as e:
        logger.warning(f'CodeFormer failed: {e}')
        return _fallback_face(image, scale)


def run_pipeline(image, pipeline, scale=4, fidelity=0.75):
    if pipeline.backend == 'realesrgan':
        result = _realesrgan(image, scale)
    elif pipeline.backend == 'spandrel':
        result = _spandrel(image, scale)
    elif pipeline.backend == 'codeformer':
        result = _codeformer(image, scale, fidelity=fidelity)
    elif pipeline.backend == 'diffbir':
        # DiffBIR not yet implemented — use face fallback for restoration
        result = _fallback_face(image, scale) if _has_faces(image) else _fallback(image, scale)
    else:
        result = _fallback(image, scale)

    # Blend with source based on fidelity (except codeformer which handles its own)
    if pipeline.backend != 'codeformer' and 0 <= fidelity < 1:
        source = image.resize(result.size, Image.Resampling.LANCZOS)
        result = Image.blend(source, result, fidelity)

    return result


def _has_faces(image: Image.Image) -> bool:
    """Quick check for face presence without full detection."""
    try:
        from backend.analyzer import _detect_faces
        return _detect_faces(image)['count'] > 0
    except Exception:
        return False
