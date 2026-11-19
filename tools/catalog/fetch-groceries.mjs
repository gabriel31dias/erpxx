/** Brazilian-prefix public food records. Cache + keyset pagination, no per-keystroke remote calls. */
import {mkdir,readFile,writeFile} from 'node:fs/promises';
const dir=new URL('../../data/catalog/sources/',import.meta.url);await mkdir(dir,{recursive:true});
const cols='code,product_name,brands,quantity,packaging,packaging_tags,categories_tags,countries_tags,image_url,image_small_url,product_quantity,last_modified_t';
let cursor='';let total=0;
for(let page=1;page<=15;page++){
 const file=new URL(`grocery-br-${String(page).padStart(2,'0')}.json`,dir);
 let d;
 try{d=JSON.parse(await readFile(file,'utf8'));if(!d.ok||d.truncated)throw Error('bad cache');}catch{
  const sql=`select ${cols} from [all] where code >= '789' and code < '791' ${cursor?`and code > '${cursor.replaceAll("'","''")}'`:''} order by code limit 5000`;
  const u=new URL('https://mirabelle.openfoodfacts.org/products.json');for(const [k,v] of Object.entries({sql,_shape:'objects',_size:'max',_timelimit:'10000'}))u.searchParams.set(k,v);
  const r=await fetch(u,{headers:{'User-Agent':'LojaFlowCatalog/1.0 (https://backoffice.bluevisionsolucoes.com.br; public grocery reference import)'},signal:AbortSignal.timeout(60000)});
  if(!r.ok)throw Error('HTTP '+r.status);d=await r.json();if(!d.ok||d.truncated)throw Error(JSON.stringify({error:d.error,truncated:d.truncated}));await writeFile(file,JSON.stringify(d));
 }
 if(d.rows.length&&d.rows[0].code<=cursor)throw Error('Non-advancing cursor');
 total+=d.rows.length;console.log(page,d.rows.length,total);
 if(d.rows.length<5000){console.log('Collection complete',total);break;}
 cursor=String(d.rows.at(-1).code);
 if(page===15)throw Error('Incomplete collection: pagination ceiling');
}
