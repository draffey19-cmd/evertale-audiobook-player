"""Deterministic asset conversion; requires Pillow. Never changes the approved source.
RGB source: remove only edge-connected near-black background in derivatives.
Original Purple retains every foreground RGB value; other themes change hue only.
"""
from pathlib import Path
from collections import deque
import colorsys, json, re
from PIL import Image, ImageFilter
ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'assets'
source = Image.open(ASSETS / 'evertale-original.png').convert('RGBA')
image = source.copy()
w, h = image.size
pixels = image.load()
# Preserve genuine alpha from future approved transparent originals.
if source.getchannel('A').getextrema() == (255, 255):
    seen = bytearray(w*h)
    queue = deque([(x,0) for x in range(w)]+[(x,h-1) for x in range(w)]+[(0,y) for y in range(h)]+[(w-1,y) for y in range(h)])
    while queue:
        x,y = queue.popleft()
        if x<0 or y<0 or x>=w or y>=h or seen[y*w+x]: continue
        seen[y*w+x] = 1
        r,g,b,a = pixels[x,y]
        if max(r,g,b)>12: continue
        pixels[x,y] = (r,g,b,0)
        queue.extend(((x-1,y),(x+1,y),(x,y-1),(x,y+1)))
# Trim empty margins, then fit on a square with breathing room, without distortion.
bounds = image.getbbox()
art = image.crop(bounds)
side = max(art.size)
canvas = Image.new('RGBA',(side,side))
canvas.alpha_composite(art,((side-art.width)//2,(side-art.height)//2))
canvas.save(ASSETS/'evertale-transparent.png')
text = (ROOT/'themes.js').read_text(encoding='utf-8')
themes = json.loads(re.search(r'const themes=(.*?);\n const storageKey',text,re.S)[1])
for theme in themes:
    variant = canvas.copy()
    if theme['id'] != 'original-purple':
        output=[]
        for r,g,b,a in canvas.getdata():
            if not a: output.append((r,g,b,a)); continue
            hue,light,saturation = colorsys.rgb_to_hls(r/255,g/255,b/255)
            # Purple body -> base hue; pink page edges -> accent hue.
            weight = max(0,min(1,(hue*360-285)/45))
            target = (theme['hue']*(1-weight)+theme['accentHue']*weight)/360
            nr,ng,nb = colorsys.hls_to_rgb(target,light,saturation)
            output.append((round(nr*255),round(ng*255),round(nb*255),a))
        variant.putdata(output)
    variant.resize((256,256),Image.Resampling.LANCZOS).save(ASSETS/('logo-'+theme['id']+'.png'))
for size in [16,20,24,32,40,48,64,128,256,512]:
    icon=canvas.resize((size,size),Image.Resampling.LANCZOS)
    if size<=48: icon=icon.filter(ImageFilter.UnsharpMask(radius=.5,percent=110,threshold=3))
    icon.save(ASSETS/f'evertale-{size}.png')
# Pillow resizes from the approved purple canvas and embeds all Windows shell sizes.
canvas.save(ASSETS/'evertale.ico',sizes=[(s,s) for s in [16,20,24,32,40,48,64,128,256]])
print('Generated six logos and Windows icons in',ASSETS)
