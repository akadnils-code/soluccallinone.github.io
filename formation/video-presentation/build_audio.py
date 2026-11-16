# -*- coding: utf-8 -*-
import json, wave, subprocess, os, sys
import numpy as np, soundfile as sf
sys.path.insert(0, '/home/claude/video')
from script_data import B, SECTIONS
from piper import PiperVoice

W = '/home/claude/video/audio/'
os.makedirs(W, exist_ok=True)
D = '/tmp/claude-0/v/vits-piper-fr_FR-tom-medium/'
voice = PiperVoice.load(D + 'fr_FR-tom-medium.onnx', config_path=D + 'fr_FR-tom-medium.onnx.json')
SR = 44100
FPS = 24

TTS = [("All In One", "Ol inne ouane"), ("Amk", "A M K"), ("Waze", "Ouèze"), ("WhatsApp", "Ouatsappe"),
       ("Instagram", "Instagrame"), ("TikTok", "Tik Tok"), ("Facebook", "Faïssebouk"), ("Google Sheets", "Gougueule chîtes"),
       ("Excel", "Èxcel"), ("QR", "Q R"), ("NFC", "N F C"), ("GPS", "G P S"), ("dirhams", "dirrams"), ("hors ligne", "hor ligne")]
SUB = [("S M S", "SMS"), ("C S V", "CSV")]

def tts_text(s):
    for a, b in TTS: s = s.replace(a, b)
    return s
def sub_text(s):
    for a, b in SUB: s = s.replace(a, b)
    return s

def synth(text, path):
    raw = path + '.raw.wav'
    with wave.open(raw, 'wb') as w:
        voice.synthesize_wav(tts_text(text), w)
    # voix plus grave (-8 %), rythme calme (tempo ~1.0), normalisation douce
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', raw, '-af',
                    'asetrate=44100*0.92,aresample=44100,atempo=1.03,highpass=f=70,lowshelf=g=3:f=180,acompressor=threshold=-20dB:ratio=2.5:attack=8:release=120',
                    '-ac', '1', path], check=True)
    os.remove(raw)
    x, sr = sf.read(path)
    return x.astype(np.float32)

GAP_S, GAP_B, TITLE = 0.32, 0.6, 2.4
t = 1.3  # petite attente initiale
tracks = []  # (start, samples)
timeline = {'fps': FPS, 'sections': [], 'beats': []}
last_sec = -1
for bi, b in enumerate(B):
    if b['sec'] != last_sec:
        if b['sec'] > 0:
            timeline['sections'].append({'sec': b['sec'], 'name': SECTIONS[b['sec']], 't0': t, 't1': t + TITLE})
            t += TITLE + 0.15
        else:
            timeline['sections'].append({'sec': 0, 'name': SECTIONS[0], 't0': 0, 't1': 0})
        last_sec = b['sec']
    b0 = t
    sents = []
    for si, s in enumerate(b['say']):
        p = W + f'b{bi:02d}_s{si}.wav'
        x = synth(s, p)
        d = len(x) / SR
        tracks.append((t, x))
        sents.append({'t0': t, 't1': t + d, 'text': sub_text(s)})
        t += d + (GAP_S if si < len(b['say']) - 1 else 0)
    t += 0.35  # respiration en fin de plan
    entry = {k: b[k] for k in ('sec', 'mode', 'screen', 'title', 'pts', 'hl', 'hlrect', 'cards', 'kicker')}
    entry.update({'t0': b0, 't1': t, 'sents': sents})
    timeline['beats'].append(entry)
    t += GAP_B - 0.35 if bi < len(B) - 1 else 0
total = t + 2.2
timeline['total'] = total
# piste voix complète
n = int(total * SR) + SR
voice_track = np.zeros(n, dtype=np.float32)
for st, x in tracks:
    i = int(st * SR); voice_track[i:i + len(x)] += x
peak = np.abs(voice_track).max()
voice_track *= 0.9 / peak
sf.write('/home/claude/video/audio/voice.wav', voice_track, SR)

# enveloppe labiale (ouverture + largeur) à 24 i/s
nf = int(total * FPS) + 1
op, wd = [], []
win = int(0.05 * SR)
rm = []
cen = []
for f in range(nf):
    c = int(f / FPS * SR)
    seg = voice_track[max(0, c - win // 2): c + win // 2]
    if len(seg) < 64: rm.append(0.0); cen.append(0.5); continue
    r = float(np.sqrt((seg ** 2).mean()))
    sp = np.abs(np.fft.rfft(seg * np.hanning(len(seg))))
    fr = np.fft.rfftfreq(len(seg), 1 / SR)
    cc = float((sp * fr).sum() / (sp.sum() + 1e-9))
    rm.append(r); cen.append(cc)
rm = np.array(rm); cen = np.array(cen)
ref = np.percentile(rm[rm > 0.01], 92)
a = np.clip(rm / ref, 0, 1.15) ** 0.8
a[rm < 0.012] = 0
# lissage léger
k = np.array([0.25, 0.5, 0.25])
a = np.convolve(a, k, mode='same')
cn = np.clip((cen - 500) / 2200, 0, 1)  # bas = voyelle arrondie, haut = voyelle étirée
cn = np.convolve(cn, k, mode='same')
timeline['mouth'] = [[round(float(x), 2), round(float(y), 2)] for x, y in zip(a, cn)]
json.dump(timeline, open('/home/claude/video/timeline.json', 'w'), ensure_ascii=False)

# sous-titres .srt
def ts(x):
    h = int(x // 3600); m = int(x % 3600 // 60); s = x % 60
    return f'{h:02d}:{m:02d}:{int(s):02d},{int(round((s - int(s)) * 1000)):03d}'
srt = []; n_ = 1
for b in timeline['beats']:
    for s in b['sents']:
        srt.append(f"{n_}\n{ts(s['t0'])} --> {ts(s['t1'] + 0.15)}\n{s['text']}\n"); n_ += 1
open('/home/claude/video/sous-titres-fr.srt', 'w', encoding='utf-8').write('\n'.join(srt))
print('durée totale', round(total, 1), 's  | phrases', n_ - 1, '| plans', len(B))
