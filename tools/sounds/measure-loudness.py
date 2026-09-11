# ITU-R BS.1770-4 integrated loudness (K-weighting + gating), pure python.
import wave, struct, math, glob, os, re, sys
def biquad(x, b, a):
    y=[0.0]*len(x); x1=x2=y1=y2=0.0
    b0,b1,b2=b; a1,a2=a[1],a[2]
    for i,v in enumerate(x):
        o=b0*v+b1*x1+b2*x2-a1*y1-a2*y2
        x2=x1; x1=v; y2=y1; y1=o; y[i]=o
    return y
def kcoeffs(fs):
    db=3.999843853973347; f0=1681.974450955533; Q=0.7071752369554196
    K=math.tan(math.pi*f0/fs); Vh=10**(db/20); Vb=Vh**0.4996667741545416
    a0=1+K/Q+K*K
    b1=[(Vh+Vb*K/Q+K*K)/a0, 2*(K*K-Vh)/a0, (Vh-Vb*K/Q+K*K)/a0]
    a1=[1.0, 2*(K*K-1)/a0, (1-K/Q+K*K)/a0]
    f0=38.13547087602444; Q=0.5003270373238773
    K=math.tan(math.pi*f0/fs); d=1+K/Q+K*K
    b2=[1.0,-2.0,1.0]; a2=[1.0, 2*(K*K-1)/d, (1-K/Q+K*K)/d]
    return (b1,a1),(b2,a2)
def lufs(path):
    w=wave.open(path,'rb'); n=w.getnframes(); ch=w.getnchannels(); sw=w.getsampwidth(); fs=w.getframerate()
    raw=w.readframes(n); w.close()
    if sw!=2: return None
    d=[v/32768.0 for v in struct.unpack('<%dh'%(len(raw)//2), raw)]
    if ch==2: d=[(d[i]+d[i+1])/2 for i in range(0,len(d)-1,2)]
    (b1,a1),(b2,a2)=kcoeffs(fs)
    y=biquad(biquad(d,b1,a1),b2,a2)
    bl=int(0.4*fs); hop=int(0.1*fs)
    blocks=[y] if len(y)<bl else [y[s:s+bl] for s in range(0,len(y)-bl+1,hop)]
    lk=lambda bk:(-0.691+10*math.log10(sum(v*v for v in bk)/len(bk)) if sum(v*v for v in bk)>0 else -99)
    keep=[b for b in blocks if lk(b)>-70]
    if not keep: return None
    integ=lambda bs:(-0.691+10*math.log10(sum(sum(v*v for v in b)/len(b) for b in bs)/len(bs)))
    g=integ(keep)-10
    k2=[b for b in keep if lk(b)>g]
    return integ(k2 if k2 else keep)
src=''
for f in glob.glob('src/client/*.ts')+glob.glob('src/client/*.tsx')+['src/ui.tsx']:
    src+=open(f).read()
vols={}
pat1=re.compile(r"sounds/([a-z-]+)\.wav'[^\n]{0,140}?volume:\s*(?:volumeInitial\(\s*)?([0-9.]+)")
pat2=re.compile(r"emetteur\('assets/sounds/([a-z-]+)\.wav',\s*([0-9.]+)")
pat3=re.compile(r"cue\('([a-z-]+)\.wav',\s*([0-9.]+)")
for pat in (pat1,pat2,pat3):
    for m in pat.finditer(src):
        vols.setdefault(m.group(1),set()).add(float(m.group(2)))
rows=[]
for p in sorted(glob.glob('assets/sounds/*.wav')):
    f=os.path.basename(p)[:-4]; L=lufs(p)
    if L is None: continue
    vs=sorted(vols.get(f,set())) or [None]
    for v in vs:
        rows.append((f,L,v,(L+20*math.log10(v)) if v else None))
rows.sort(key=lambda r:(r[3] if r[3] is not None else 99), reverse=True)
print(f"{'file':16} {'LUFS':>7} {'vol':>5} {'in game':>9}")
for f,L,v,e in rows:
    print(f"{f:16} {L:7.1f} {('%.2f'%v) if v else '  ?':>5} {('%.1f'%e) if e is not None else '    ?':>9}")
