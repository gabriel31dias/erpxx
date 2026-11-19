import {readFileSync,writeFileSync} from 'node:fs';
const root=new URL('../../data/catalog/',import.meta.url);
const html=readFileSync(new URL('sources/confaz-cest.html',root),'utf8');
const clean=s=>s.replace(/<(strike|del|s)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
const codes=new Map();
for(const [row] of html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)){
 const cells=[...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>clean(m[1]));
 const i=cells.findIndex(c=>/^0[23]\.\d{3}\.\d{2}$/.test(c));
 if(i<0||!cells[i+2])continue;
 // Entirely struck-through cells become empty; the last active revision wins.
 const code=cells[i].replaceAll('.','');
 codes.set(code,{kind:'CEST',code,description:cells[i+2],searchText:clean(`${code} ${cells[i+1]} ${cells[i+2]}`).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9.]+/g,' '),sourceUrl:'https://www.confaz.fazenda.gov.br/legislacao/convenios/2018/CV142_18',sourceVersion:'Convênio ICMS 142/18 consolidado — consulta em 17/11/2026'});
}
const file=new URL('fiscal-codes.json',root);const fiscal=JSON.parse(readFileSync(file));
writeFileSync(file,JSON.stringify([...fiscal.filter(x=>x.kind!=='CEST'),...codes.values()],null,2)+'\n');
console.log('CEST bebidas:',codes.size);console.log([...codes.values()].filter(x=>['0301002','0302103','0302203','0301300'].includes(x.code)));

const manifestFile=new URL('manifest.json',root);
const manifest=JSON.parse(readFileSync(manifestFile));
manifest.fiscalCodes=fiscal.filter(x=>x.kind!=='CEST').length+codes.size;
manifest.license.databaseUrl='https://opendatacommons.org/licenses/odbl/1-0/';
manifest.license.imagesUrl='https://creativecommons.org/licenses/by-sa/3.0/';
manifest.imageVerification={method:'URL da foto frontal associada ao mesmo GTIN na fonte; não são imagens geradas ou fotos genéricas da marca.',httpAndVisualSample:['7894900010015','7894900700015','7894900530001','7896045506064','78935495'],sampleCheckedAt:'2026-11-17',note:'A coleção não foi revisada visualmente por inteiro. Fotos comunitárias variam de qualidade e dependem da disponibilidade da fonte.'};
writeFileSync(manifestFile,JSON.stringify(manifest,null,2)+'\n');
