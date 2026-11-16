import asyncio, json
from playwright.async_api import async_playwright
O='/home/claude/video/shots/'
S={}
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
        ctx=await b.new_context(viewport={'width':412,'height':860},device_scale_factor=2,service_workers='block')
        pg=await ctx.new_page(); pg.set_default_timeout(6000)
        await pg.goto('http://localhost:8123/index.html'); await pg.wait_for_timeout(1000)
        async def bbox(sel,nth=0):
            if not sel: return None
            try:
                l=pg.locator(sel).filter(visible=True).nth(nth); await l.scroll_into_view_if_needed(timeout=1500); bb=await l.bounding_box(); return bb
            except Exception as e: print('  !bbox fail',sel,str(e)[:60]); return None
        async def snap(id,hl=None,nth=0,label=None,scroll=None):
            if scroll is not None:
                await pg.evaluate(f'window.scrollTo(0,{scroll})'); await pg.wait_for_timeout(250)
            bb=await bbox(hl,nth) if hl else None
            if hl: await pg.wait_for_timeout(200)
            await pg.screenshot(path=O+id+'.png')
            S[id]={'file':id+'.png','hl':bb,'label':label}; print('shot',id,bb and [round(v) for v in bb.values()])
        async def tab(t): await pg.click(f'#nav button[data-v="{t}"]'); await pg.wait_for_timeout(450); await pg.evaluate('window.scrollTo(0,0)')
        async def tile(seg,t): await tab('more'); await pg.click(f'[data-sg="{seg}"]'); await pg.wait_for_timeout(150); await pg.click(f'#app .tile[data-v="{t}"]'); await pg.wait_for_timeout(450); await pg.evaluate('window.scrollTo(0,0)')
        async def setrow(r): await tab('set'); await pg.click(f'[data-sc="o:{r}"]'); await pg.wait_for_timeout(400); await pg.evaluate('window.scrollTo(0,0)')
        # load demo
        await setrow('dat'); await snap('set_dat','[data-act="demoon"]',label='Charger la démo')
        await pg.click('[data-act="demoon"]'); await pg.wait_for_timeout(700)
        # --- Accueil
        await tab('home'); await snap('home','#qa10 .qb >> nth=0',label='Raccourcis')
        await snap('home_kpi',"text=Appels (",label='Appels')
        await snap('home_shops','text=Mes boutiques',label='Mes boutiques',scroll=500)
        await snap('home_check','text=À vérifier',label='À vérifier',scroll=900)
        # --- Confirmer
        await tab('calls'); await snap('calls','[data-act="conf"] >> nth=0',label='Confirmé')
        await pg.locator('text=Plus d’options').filter(visible=True).first.click(); await pg.wait_for_timeout(300)
        await snap('calls_more','text=Plus d’options',label='Plus d’options')
        await pg.locator('text=Plus d’options').filter(visible=True).first.click(); await pg.wait_for_timeout(200)
        await pg.click('text=Relances WhatsApp'); await pg.wait_for_timeout(400)
        await snap('calls_wa','text=Envoyer sur WhatsApp',label='Envoyer sur WhatsApp')
        # --- Commandes
        await tab('ord'); await snap('ord','text=Tous les statuts',label='Filtres')
        await snap('ord_cards','text=Historique du colis',label='Historique du colis',scroll=330)
        try:
            await pg.locator('[data-act]:has-text("Historique du colis")').filter(visible=True).first.click(); await pg.wait_for_timeout(500)
            await snap('ord_hist',None); await pg.keyboard.press('Escape')
        except Exception as e: print('hist fail',e)
        await tab('ord'); await pg.click('[data-act="sub"][data-v="add"]'); await pg.wait_for_timeout(300)
        await snap('ord_add','#f-v',label='Formulaire')
        await snap('ord_paste','#f-paste',label='Coller WhatsApp',scroll=560)
        await snap('ord_bulk','text=Liste ou fichier',label='Liste ou fichier',scroll=900)
        # --- Livraison
        await tab('del'); await pg.click('text=Suivi des colis'); await pg.wait_for_timeout(300); await snap('del','text=À valider',label='Compteurs')
        await snap('del_map','text=Carte nationale',label='Carte',scroll=300)
        await snap('del_cards','text=Remis au livreur',label='Remis au livreur',scroll=1000)
        await tab('del'); await pg.click('text=Preuves'); await pg.wait_for_timeout(400)
        await snap('del_proofs','text=Prendre la photo',label='Preuve photo GPS')
        # --- Compte / Gestion
        await tab('more'); await snap('more','#app .tile >> nth=0',label='Gestion')
        await pg.click('[data-sg="1"]'); await pg.wait_for_timeout(250); await snap('more_ops','#app .tile >> nth=0',label='Opérations'); await pg.click('[data-sg="0"]')
        await tile(0,'vend'); await snap('vend','text=Ajouter un vendeur',label='Ajouter un vendeur')
        await tile(0,'fin'); await snap('fin','text=Par vendeur',label='Par vendeur')
        await pg.click('text=Rapport hebdo'); await pg.wait_for_timeout(400); await snap('fin_week',None)
        await tile(0,'auto'); await snap('auto','text=Automatisations actives',label='Automatisations')
        await snap('auto2','text=Clients à prévenir',label='Clients à prévenir',scroll=520)
        await tile(0,'cat'); await snap('cat','text=Ajouter un produit',label='Catalogue')
        await tile(0,'net'); await snap('net','text=Livreurs (',label='Réseau')
        await tile(0,'deals'); await snap('deals','text=Simulateur de marge',label='Simulateur')
        await tile(0,'sim'); await snap('sim','text=Commissions / mois',label='Prévisions')
        await tile(0,'pro'); await snap('pro','text=Reversements',label='Reversements')
        # --- Opérations
        await tile(1,'tools'); await snap('tools','text=Scanner un QR',label='QR & NFC')
        await tile(1,'calc'); await pg.click('#app >> text="7"'); await pg.click('#app >> text="5"'); await pg.click('#app >> text="×"'); await pg.click('#app >> text="4"'); await pg.click('#app >> text="="'); await snap('calc',None)
        await tile(1,'wl'); await snap('wl','text=Nouveau prospect',label='Prospects')
        # --- Paramètres
        await tab('set'); await snap('set_hub','[data-sc="o:p"]',label='Rubriques')
        await setrow('p'); await snap('set_p',None)
        await setrow('a'); await snap('set_a',None)
        await setrow('sec'); await snap('set_sec','#npin',label='Code PIN')
        await setrow('int'); await snap('set_int',None)
        await setrow('lng'); await snap('set_lng','[data-act="lang"]',label='Langue')
        await tab('set'); await pg.click('[data-sc="o:help"]'); await pg.wait_for_timeout(300); await snap('set_help','[data-sc="go:aide"]',label='Mode d’emploi')
        await pg.click('[data-sc="go:aide"]'); await pg.wait_for_timeout(400); await snap('aide',None)
        await tab('set'); await pg.click('[data-sc="o:help"]'); await pg.click('[data-sc="go:ver"]'); await pg.wait_for_timeout(400); await snap('ver',None)
        # ===== DEMO PRATIQUE =====
        await tile(0,'vend'); await pg.click('[data-act="vnew"]'); await pg.wait_for_timeout(300)
        await pg.fill('#v-n','Boutique Lina'); await pg.fill('#v-p','0661234567'); await pg.fill('#v-c','Casablanca'); await pg.keyboard.press('Tab'); await pg.mouse.click(380,60)
        await snap('d1_vendor','[data-act="vadd"]',label='Ajouter')
        await pg.click('[data-act="vadd"]'); await pg.wait_for_timeout(400); await snap('d1_vendor_ok','text=Boutique Lina',label='Vendeur créé')
        await tab('ord'); await pg.click('[data-act="sub"][data-v="add"]'); await pg.wait_for_timeout(300)
        await pg.fill('#f-v','Boutique Lina'); await pg.fill('#f-n','Sara Benali'); await pg.fill('#f-p','0612345678'); await pg.fill('#f-pr','Robe d’été')
        await pg.fill('#f-a','12 rue Ibn Sina, Maarif'); await pg.fill('#f-c','Casablanca'); await pg.keyboard.press('Tab'); await pg.mouse.click(380,60)
        await snap('d2_form',None,scroll=0)
        await snap('d2_add','[data-act="add"]',label='Ajouter',scroll=420)
        await pg.click('[data-act="add"]'); await pg.wait_for_timeout(500)
        await tab('ord'); await pg.click('[data-act="sub"][data-v="list"]'); await pg.wait_for_timeout(400); await snap('d2_list','text=Sara Benali',label='Commande créée')
        await tab('calls'); await pg.click('text=Appels à passer'); await pg.wait_for_timeout(400)
        await snap('d3_call','.card:has-text("Sara Benali") [data-act="conf"]',label='Confirmé')
        await pg.locator('.card:has-text("Sara Benali") [data-act="conf"]').filter(visible=True).first.click(); await pg.wait_for_timeout(600); await snap('d3_done',None)
        await tab('del'); await pg.click('text=Suivi des colis'); await pg.wait_for_timeout(400); await snap('d4_del',None)
        await snap('d4_hand','.card:has-text("Sara Benali") [data-act]:has-text("Remis au livreur")',label='Remis au livreur',scroll=0)
        await pg.locator('.card:has-text("Sara Benali") [data-act]:has-text("Remis au livreur")').filter(visible=True).first.click(); await pg.wait_for_timeout(600); await tab('del'); await pg.click('text=Suivi des colis'); await pg.wait_for_timeout(300); await snap('d4_after','text=En cours de livraison',label='En cours')
        await tile(0,'fin'); await snap('d5_fin',None)
        json.dump(S,open('/home/claude/video/shots.json','w'),indent=1,ensure_ascii=False)
        await b.close()
asyncio.run(main())
