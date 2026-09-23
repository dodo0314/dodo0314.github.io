"""Generate the app's simple geometric monogram; run only when changing the icon."""
from pathlib import Path
from PIL import Image, ImageDraw

target = Path(__file__).resolve().parent.parent / 'public' / 'icons'
target.mkdir(parents=True, exist_ok=True)
image = Image.new('RGB', (1024, 1024), '#375E4D')
draw = ImageDraw.Draw(image)
cream = '#F6F4EF'
width = 58
for x in [298, 512, 726]:
    draw.line((x, 465, x, 690), fill=cream, width=width)
    draw.ellipse((x-width/2, 690-width/2, x+width/2, 690+width/2), fill=cream)
for x in [298, 512]:
    draw.arc((x, 350, x+214, 580), 180, 360, fill=cream, width=width)
for size, name in [(180, 'apple-touch-icon.png'), (192, 'icon-192.png'), (512, 'icon-512.png')]:
    image.resize((size, size), Image.Resampling.LANCZOS).save(target / name)
image.resize((64, 64), Image.Resampling.LANCZOS).save(target.parent / 'favicon.ico', sizes=[(16, 16), (32, 32), (64, 64)])
