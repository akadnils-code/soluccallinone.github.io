import numpy as np, soundfile as sf, json
SR=44100
total=json.load(open('timeline.json'))['total']+1.0
n=int(total*SR); L=np.zeros(n,np.float32); R=np.zeros(n,np.float32)
bpm=84; beat=60/bpm; bar=4*beat
fm=lambda m:440*2**((m-69)/12)
prog=[[57,60,64,67,71],[53,57,60,64,67],[48,52,55,59,64],[55,59,62,66,69]]  # Am9, Fmaj7, Cmaj7, G6
bass=[45,41,48,43]
rng=np.random.default_rng(7)
def add(buf,start,sig):
    i=int(start*SR); j=min(n,i+len(sig))
    if i<n: buf[i:j]+=sig[:j-i]
def env(dur,a,r):
    k=int(dur*SR); t=np.arange(k)/SR
    e=np.minimum(1,t/a)*np.minimum(1,(dur-t)/r); return np.clip(e,0,1)
nb=int(total/bar)+2
for b in range(nb):
    ch=prog[b%4]; t0=b*bar; dur=bar+1.2
    t=np.arange(int(dur*SR))/SR; e=env(dur,0.9,1.6)
    for m in ch:
        for det,pan in((-0.12,0.3),(0.1,0.7)):
            f=fm(m)*(1+det/100*3)
            s=(np.sin(2*np.pi*f*t)+0.3*np.sin(2*np.pi*2*f*t+1)+0.12*np.sin(2*np.pi*3*f*t))*e*0.028
            add(L,t0,s*(1-pan)); add(R,t0,s*pan)
    # basse douce
    f=fm(bass[b%4]); tb=np.arange(int((bar+0.4)*SR))/SR
    s=np.sin(2*np.pi*f*tb)*env(bar+0.4,0.15,0.6)*0.07; add(L,t0,s); add(R,t0,s)
    # arpège (pluck) en croches
    arp=[ch[1],ch[2],ch[3],ch[4],ch[3],ch[2],ch[4],ch[3]]
    for k,m in enumerate(arp):
        ts=t0+k*beat/2+(0.0 if k%2==0 else 0.004*rng.standard_normal())
        d=1.4; tt=np.arange(int(d*SR))/SR; f=fm(m+12)
        s=(np.sin(2*np.pi*f*tt)+0.25*np.sin(2*np.pi*2*f*tt))*np.exp(-tt*4.2)*0.032*(0.75+0.25*(k%4==0))
        p=0.35+0.3*np.sin(k+b); add(L,ts,s*(1-p)); add(R,ts,s*p)
# fondu + normalisation douce
fade=np.minimum(1,np.arange(n)/(3*SR))*np.minimum(1,(n-np.arange(n))/(4*SR))
L*=fade; R*=fade
m=max(abs(L).max(),abs(R).max()); L*=0.8/m; R*=0.8/m
sf.write('audio/music.wav',np.stack([L,R],1),SR)
print('musique ok',round(total,1),'s')
