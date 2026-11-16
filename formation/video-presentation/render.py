import asyncio, sys, os, json
from playwright.async_api import async_playwright
W,N=int(sys.argv[1]),int(sys.argv[2])
FR='/home/claude/video/frames/'; os.makedirs(FR,exist_ok=True)
T=json.load(open('/home/claude/video/timeline.json')); FPS=T['fps']; total=int(T['total']*FPS)
per=(total+N-1)//N; a,b=W*per,min(total,(W+1)*per)
async def main():
    async with async_playwright() as p:
        br=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox','--disable-gpu'])
        pg=await br.new_page(viewport={'width':1920,'height':1080})
        await pg.goto('http://localhost:8124/studio.html'); await pg.wait_for_function('window.__ready===true')
        for f in range(a,b):
            out=f'{FR}{f:06d}.jpg'
            if os.path.exists(out) and os.path.getsize(out)>5000: continue
            await pg.evaluate(f'draw({f/FPS})')
            await pg.evaluate('Promise.all([imgA.decode().catch(()=>0),imgB.decode().catch(()=>0)])')
            await pg.screenshot(path=out,type='jpeg',quality=90)
            if f%200==0: print(W,f,b,flush=True)
        await br.close(); print('worker',W,'done',flush=True)
asyncio.run(main())
