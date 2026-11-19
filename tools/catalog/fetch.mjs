/** Public, read-only bulk research. Reuses responses; never called by autocomplete. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const dir = new URL('../../data/catalog/sources/', import.meta.url);
await mkdir(dir, { recursive: true });
const groups = {
  soda: ['Coca-Cola','Coca Cola','COCA-COLA','Coca-cola','Pepsi','PEPSI','Fanta','Sprite','Guaraná Antarctica','Guarana Antarctica','Antarctica','Kuat','Schweppes','Sukita','H2OH!','H2OH','Itubaína','FYS','Soda Antarctica','Dolly'],
  beer: ['Brahma','BRAHMA','Skol','SKOL','Original','Bohemia','Spaten','Budweiser','Stella Artois','Corona','Corona Extra','Beck\'s','Becks','Colorado','Patagonia','Heineken','HEINEKEN','Amstel','Eisenbahn','Devassa','Kaiser','Schin','Baden Baden','Baden-Baden','Lagunitas','Itaipava','ITAIPAVA','Crystal','Petra','Black Princess','Cacildis','Lokal','Guinness','Paulaner','Erdinger','Hoegaarden','Leffe','Sol','Blue Moon','Praya'],
  soft: ['Red Bull','RedBull','Monster','Monster Energy','TNT','Fusion','Burn','Baly','Crystal','Bonafont','Minalba','Indaiá','Indaia','Lindoya','São Lourenço','Prata','Perrier','S.Pellegrino','San Pellegrino','Água Petra','AMA','Del Valle','Del valle','del Valle','Maguary','Do Bem','do bem','Natural One','Natural one','Aurora','Su Fresh','SuFresh','Tial','Suvalan','Sococo','Kero Coco','KeroCoco','Kero coco','Obrigado','Ducoco','Powerade','Gatorade','Lipton','Leão','Matte Leão','Fuze Tea','Arizona','Yakult'],
  spirits: ['Johnnie Walker','Jack Daniel\'s','Jack Daniels','Chivas Regal','Chivas','Ballantine\'s','Ballantines','White Horse','Teacher\'s','Jameson','Jim Beam','Smirnoff','Absolut','Absolut Vodka','Grey Goose','Tanqueray','Gordon\'s','Beefeater','Bombay Sapphire','Bacardi','Bacardí','Montilla','Havana Club','51','Cachaça 51','Pitú','Pitu','Ypióca','Ypioca','Velho Barreiro','Sagatiba','Salinas','Campari','Aperol','Cinzano','Martini','Amarula','Baileys','Jägermeister','Jagermeister','Licor 43','José Cuervo','Jose Cuervo','Patrón','Patron','Don Julio','Captain Morgan','Malibu','Cointreau','Dreher','Domecq','São Francisco','Jurupinga','Mike\'s','Skol Beats','Beats'],
  wine: ['Concha y Toro','Casillero del Diablo','Santa Helena','Aurora','Salton','Chandon','Freixenet','Miolo','Garibaldi','Almadén','Almaden','Gato Negro','Santa Rita','Trapiche','Luigi Bosca','Norton','Don Simon','Don Simón','Sangue de Boi','Pérgola','Pergola','Campo Largo','Quinta do Morgado','Cella','JP. Chenet','J.P. Chenet','Marques de Casa Concha','Mateus','Porto Ferreira','Sandeman'],
};
const cols = 'code,product_name,brands,quantity,packaging,packaging_tags,categories_tags,countries_tags,image_url,image_small_url,product_quantity,last_modified_t';
for (const [group, names] of Object.entries(groups)) {
  const file = new URL(`brands-${group}.json`, dir);
  try { const cache = JSON.parse(await readFile(file,'utf8')); if(cache.ok) { console.log(group,'cached',cache.rows.length); continue; } } catch {}
  const variants = [...new Set(names.flatMap(s=>[s,s.toUpperCase(),s.toLowerCase()]))];
  const sql = `select ${cols} from [all] where brands in (${variants.map(s=>"'"+s.replaceAll("'","''")+"'").join(',')}) limit 20000`;
  const url = new URL('https://mirabelle.openfoodfacts.org/products.json');
  url.searchParams.set('sql',sql);url.searchParams.set('_shape','objects');url.searchParams.set('_size','max');url.searchParams.set('_timelimit','10000');
  const r=await fetch(url,{headers:{'User-Agent':'LojaFlowCatalog/1.0 (beverage reference research)'},signal:AbortSignal.timeout(90000)});
  const body=await r.text(); if(!r.ok) throw new Error(group+': '+r.status+' '+body.slice(0,150));
  const data=JSON.parse(body); if(!data.ok||data.truncated) throw new Error(group+' incomplete: '+JSON.stringify({ok:data.ok,truncated:data.truncated,error:data.error}));
  await writeFile(file,body);console.log(group,data.rows.length);
}
// Brazil prefix catches uncategorized SKUs and combined brands absent from exact brand indexes.
const file=new URL('brazil-drinks.json',dir);
try { await readFile(file); console.log('Brazil cached'); } catch {
 const sql=`select ${cols} from [all] where code >= '789' and code < '790' and (product_name like '%cerveja%' or product_name like '%refrigerante%' or product_name like '%cachaça%' or product_name like '%vodka%' or product_name like '%whisky%' or product_name like '%energético%' or product_name like '%agua mineral%' or product_name like '%água mineral%') limit 10000`;
 const url=new URL('https://mirabelle.openfoodfacts.org/products.json');for(const [k,v] of Object.entries({sql,_shape:'objects',_size:'max',_timelimit:'10000'}))url.searchParams.set(k,v);
 const r=await fetch(url,{signal:AbortSignal.timeout(90000)});const d=await r.json(); if(!d.ok||d.truncated)throw Error('Brazil incomplete');await writeFile(file,JSON.stringify(d));console.log('Brazil',d.rows.length);
}

// Additional primary sources needed to reproduce the normalized tables.
const beverageSql=`select ${cols} from [all] where code >= '789' and code < '790' and categories_tags like '%en:beverages%' limit 5000`;
const mirror=new URL('https://mirabelle.openfoodfacts.org/products.json');
for(const [k,v] of Object.entries({sql:beverageSql,_shape:'objects',_size:'max',_timelimit:'10000'}))mirror.searchParams.set(k,v);
const off=new URL('https://world.openfoodfacts.org/api/v2/search');
for(const [k,v] of Object.entries({countries_tags:'en:brazil',categories_tags:'en:beverages',page_size:'100',fields:'code,product_name,product_name_pt,brands,quantity,categories_tags,packaging_tags,image_front_url,product_quantity,product_quantity_unit,countries_tags'}))off.searchParams.set(k,v);
for(const [filename,url] of [
 ['mirabelle-1.json',mirror.href],['off-initial.json',off.href],
 ['ncm-initial.json','https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json'],
 ['confaz-cest.html','https://www.confaz.fazenda.gov.br/legislacao/convenios/2018/CV142_18'],
 ['cfop.html','https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/facilitacao/anexo-ecf-cfop']
]) {
 const file=new URL(filename,dir);
 try{await readFile(file);console.log(filename,'cached');continue;}catch{}
 const r=await fetch(url,{headers:{'User-Agent':'LojaFlowCatalog/1.0 (https://backoffice.bluevisionsolucoes.com.br; beverage reference import)'},signal:AbortSignal.timeout(90000)});
 if(!r.ok)throw Error(filename+': '+r.status);
 const body=await r.text();if(filename.endsWith('.json')){const data=JSON.parse(body);if(data.error||data.truncated)throw Error(filename+' incomplete');}
 await writeFile(file,body);console.log(filename,'downloaded');
}
