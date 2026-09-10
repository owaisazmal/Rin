"""Store screenshots for Rin: caption block over a generic phone frame, exported per store size.

Usage: python3 compose.py slides.json
Every path in the spec (sources and output folders) is resolved relative to the spec file.
spec: {"out": {"play": dir, "appstore": dir}, "slides": [ {name, theme, eyebrow, headline, sub?, icon?, src: {play: path, appstore: path}, bars: {play: "android"|"ios-17promax"|"ios-16pro", appstore: ...}} ]}
"""
import json, os, subprocess, sys, tempfile
from PIL import Image

# repo root: this file lives in assets/store/tools
R = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
FONT = R + '/node_modules/@expo-google-fonts/josefin-sans'
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
SIZES = {'play': (1080, 1920), 'appstore': (1320, 2868)}

# status bar / home indicator to cut, per capture source, in source pixels
BARS = {
    'ios-17promax': (186, 102),   # 1320 x 2868, 3x: 62pt status area, 34pt home indicator
    'ios-16pro': (180, 100),      # 1206 x 2622, 3x
    'android': (90, 70),          # 1080 x 2400 emulator: status bar, gesture pill
}
THEME = {
    'dark': dict(bg='#242424', ink='#FFFFE3', accent='#8fa5ba', soft='#CBCBCB',
                 blobs='radial-gradient(90% 60% at 12% 4%, rgba(109,129,150,.30), transparent 70%), radial-gradient(95% 60% at 92% 62%, rgba(74,74,74,.95), transparent 70%)',
                 bezel='#0f0f0f', edge='rgba(255,255,227,.14)', shadow='rgba(0,0,0,.6)'),
    'light': dict(bg='#FFFFE3', ink='#4A4A4A', accent='#57697c', soft='#5f6b78',
                  blobs='radial-gradient(90% 60% at 88% 4%, rgba(203,203,203,.65), transparent 70%), radial-gradient(95% 60% at 8% 66%, rgba(109,129,150,.18), transparent 70%)',
                  bezel='#1c1c1c', edge='rgba(74,74,74,.18)', shadow='rgba(74,74,74,.28)'),
}

def cut_bars(src, kind, out):
    im = Image.open(src).convert('RGB')
    top, bottom = BARS[kind]
    im = im.crop((0, top, im.width, im.height - bottom))
    im.save(out)
    return im.size

def render(html, w, h, out):
    page = out + '.html'
    open(page, 'w').write(html)
    raw = out + '.raw.png'
    subprocess.run([CHROME, '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
                    '--allow-file-access-from-files', '--force-device-scale-factor=1', '--virtual-time-budget=5000',
                    f'--window-size={w},{h}', f'--screenshot={raw}', 'file://' + page], check=True, capture_output=True)
    im = Image.open(raw).convert('RGB')
    assert im.size == (w, h), (im.size, (w, h))
    im.save(out, optimize=True)
    os.remove(raw); os.remove(page)

def slide_html(s, store, screen_path, screen_size, W, H):
    t = THEME[s['theme']]
    u = W / 1080                     # design unit: everything scales with width
    fw = 860 * u                     # frame width incl. bezel
    bez = 16 * u
    inner = fw - 2 * bez
    sh = screen_size[1] * inner / screen_size[0]
    top = (s.get('frame_top', 585)) * u
    icon = ''
    if s.get('icon'):
        icon = f'<img class=icon src="file://{R}/assets/logo/mark-{s["theme"]}.svg">'
    sub = f'<div class=sub>{s["sub"]}</div>' if s.get('sub') else ''
    return f'''<!doctype html><html><head><style>
@font-face{{font-family:JB;src:url("file://{FONT}/700Bold/JosefinSans_700Bold.ttf")}}
@font-face{{font-family:JR;src:url("file://{FONT}/400Regular/JosefinSans_400Regular.ttf")}}
html,body{{margin:0;width:{W}px;height:{H}px;overflow:hidden;background:{t['bg']}}}
.w{{position:absolute;inset:0;background:{t['blobs']}}}
.cap{{position:absolute;left:{60*u}px;right:{60*u}px;top:{s.get('cap_top', 150)*u}px;text-align:center}}
.icon{{display:block;width:{68*u}px;height:{68*u}px;margin:0 auto {26*u}px}}
.eye{{font:700 {28*u}px JB;letter-spacing:{9*u}px;color:{t['accent']};margin-bottom:{24*u}px;padding-left:{9*u}px}}
.head{{font:700 {s.get('head_px', 72)*u}px/1.12 JB;color:{t['ink']};letter-spacing:{0.5*u}px}}
.sub{{font:400 {33*u}px/1.4 JR;color:{t['soft']};margin-top:{20*u}px}}
.frame{{position:absolute;left:{(W-fw)/2}px;top:{top}px;width:{fw}px;height:{sh+2*bez}px;border-radius:{104*u}px;background:{t['bezel']};box-shadow:0 {36*u}px {90*u}px {t['shadow']}, inset 0 0 0 {2*u}px {t['edge']}}}
.screen{{position:absolute;left:{bez}px;top:{bez}px;width:{inner}px;height:{sh}px;border-radius:{88*u}px;overflow:hidden;background:#000}}
.screen img{{display:block;width:100%;height:100%}}
</style></head><body><div class=w></div>
<div class=cap>{icon}<div class=eye>{s['eyebrow']}</div><div class=head>{s['headline']}</div>{sub}</div>
<div class=frame><div class=screen><img src="file://{screen_path}"></div></div>
</body></html>'''

def main(spec_path):
    spec = json.load(open(spec_path))
    base = os.path.dirname(os.path.abspath(spec_path))
    rel = lambda path: os.path.normpath(os.path.join(base, path))
    work = tempfile.mkdtemp(prefix='rin-store-')
    for store, (W, H) in SIZES.items():
        outdir = rel(spec['out'][store]); os.makedirs(outdir, exist_ok=True)
        for i, s in enumerate(spec['slides'], 1):
            src = rel(s['src'][store]); kind = s['bars'][store]
            screen = os.path.join(work, f'{store}-{s["name"]}.png')
            size = cut_bars(src, kind, screen)
            out = os.path.join(outdir, f'{i:02d}-{s["name"]}.png')
            render(slide_html(s, store, screen, size, W, H), W, H, out)
            print(store, out, Image.open(out).size, os.path.getsize(out) // 1024, 'KB')

if __name__ == '__main__':
    main(sys.argv[1])
