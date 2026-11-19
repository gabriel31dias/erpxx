import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { normalizeBeverage, catalogText } from '../../src/modules/beverage-reference';
const root = join(__dirname, '../../data/catalog');
const source = join(root, 'sources');
const rows = new Map<string, NonNullable<ReturnType<typeof normalizeBeverage>>>();
const inputs = readdirSync(source).filter(f => /^brands-|^mirabelle-1|^brazil-drinks|^off-initial/.test(f));
let read = 0;
for (const file of inputs) for (const raw of (JSON.parse(readFileSync(join(source, file), 'utf8')).rows || JSON.parse(readFileSync(join(source, file), 'utf8')).products)) {
  read++;
  const p = normalizeBeverage(raw);
  if (!p) continue;
  const before = rows.get(p.barcode);
  if (!before || (p.packaging && !before.packaging) || (Boolean(p.packaging) === Boolean(before.packaging) && p.name.length > before.name.length)) rows.set(p.barcode, p);
}
const products = [...rows.values()].sort((a,b) => a.barcode.localeCompare(b.barcode));
const ncmRaw = JSON.parse(readFileSync(join(source, 'ncm-initial.json'), 'utf8'));
const clean = (s: string) => s.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/^[- ]+/, '').trim();
const hierarchy = new Map<string,string>();
const codes: any[] = [];
for (const row of ncmRaw.Nomenclaturas) {
 const code = row.Codigo.replace(/\D/g,'');
 hierarchy.set(code, clean(row.Descricao));
 if (code.length !== 8) continue;
 const ancestors = [code.slice(0,4),code.slice(0,5),code.slice(0,6),code.slice(0,7)].filter(k=>hierarchy.has(k));
 const description = [...ancestors.map(k=>hierarchy.get(k)),clean(row.Descricao)].filter((v,i,a)=>a.indexOf(v)===i).join(' › ');
 codes.push({kind:'NCM',code,description,searchText:catalogText(`${code} ${description}`),sourceUrl:'https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json',sourceVersion:ncmRaw.Data_Ultima_Atualizacao_NCM});
}
const cfopSource='https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/facilitacao/anexo-ecf-cfop';
for(const [code,description] of [['5102','Venda de mercadoria adquirida ou recebida de terceiros — operação interna'],['5405','Venda de mercadoria adquirida ou recebida de terceiros em operação com mercadoria sujeita ao regime de substituição tributária, na condição de contribuinte substituído'],['6102','Venda de mercadoria adquirida ou recebida de terceiros — operação interestadual']]) codes.push({kind:'CFOP',code,description,searchText:catalogText(`${code} ${description}`),sourceUrl:cfopSource,sourceVersion:'Consulta em 17/11/2026'});
mkdirSync(root,{recursive:true});
writeFileSync(join(root,'beverages.json'),JSON.stringify(products,null,2)+'\n');
writeFileSync(join(root,'fiscal-codes.json'),JSON.stringify(codes,null,2)+'\n');
const counts=(key:string)=>Object.fromEntries([...new Set(products.map(p=>(p as any)[key]||'Não informada'))].sort().map(k=>[k,products.filter(p=>((p as any)[key]||'Não informada')===k).length]));
const manifest={researchedAt:new Date().toISOString(),inputRows:read,products:products.length,withImages:products.length,brands:new Set(products.map(p=>catalogText(p.brand))).size,markets:counts('market'),categories:counts('category'),packaging:counts('packaging'),fiscalCodes:codes.length,license:{database:'ODbL 1.0',contents:'Database Contents License',images:'CC BY-SA 3.0'},sources:[{name:'Open Food Facts / Mirabelle',url:'https://mirabelle.openfoodfacts.org/products',files:inputs},{name:'NCM Receita Federal / Siscomex',url:'https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json',version:ncmRaw.Data_Ultima_Atualizacao_NCM},{name:'Portfólio HEINEKEN Brasil',url:'https://www.heinekenbrasil.com.br/nossas-marcas'},{name:'Portfólio Coca-Cola FEMSA',url:'https://coca-cola-femsa.com.br/?r=nosso-portfolio'},{name:'Portfólio Ambev BEES',url:'https://support.mybees.com.br/hc/pt-br/articles/35689320681495-Quais-s%C3%A3o-os-produtos-que-a-Ambev-vende'}]};
writeFileSync(join(root,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify(manifest,null,2));
