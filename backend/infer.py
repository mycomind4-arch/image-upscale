import argparse
import io
import time
from pathlib import Path
from PIL import Image

from backend.device import get_device_info
from backend.pipelines import run_realesrgan


def main():
    p = argparse.ArgumentParser(description='Verified neural image inference')
    p.add_argument('--input', required=True)
    p.add_argument('--output', required=True)
    p.add_argument('--model', default='RealESRGAN_x4plus')
    p.add_argument('--scale', type=float, default=4)
    p.add_argument('--tile', type=int, default=512)
    args = p.parse_args()

    info = get_device_info()
    image = Image.open(args.input)
    start = time.perf_counter()
    result, metadata = run_realesrgan(image, model_name=args.model, outscale=args.scale, tile=args.tile, device=info['device'])
    elapsed = time.perf_counter() - start
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    result.save(args.output)
    print('Image Upscale Lab')
    print('-----------------')
    print(f"Model:      {metadata['model']}")
    print(f"Device:     {metadata['device']}")
    print(f"Input:      {image.width} x {image.height}")
    print(f"Output:     {result.width} x {result.height}")
    print(f"Tile:       {args.tile}")
    print(f"Inference:  {elapsed:.2f}s")
    print('Status:     SUCCESS')

if __name__ == '__main__':
    main()
