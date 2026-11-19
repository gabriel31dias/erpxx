/** Extends the versioned beverage base; public foods stay separate from tenant products. */
import {readdirSync,readFileSync,writeFileSync} from 'fs';
import {join} from 'path';
import {normalizeGrocery} from '../../src/modules/grocery-reference';
import {catalogText} from '../../src/modules/beverage-reference';
const root=join(__dirname,'../../data/catalog');
const beverageFile=join(root,'beverages.json');
const beverages=JSON.parse(readFileSync(beverageFile,'utf8')).map((p:any)=>({...p,kind:'BEVERAGE',weightGrams:null,active:true}));
const foods=new Map<string,NonNullable<ReturnType<typeof normalizeGrocery>>>();
const files=readdirSync(join(root,'sources')).filter(f=>/^grocery-br-\d+\.json$/.test(f)).sort();
let read=0;
for(const file of files){const data=JSON.parse(readFileSync(join(root,'sources',file),'utf8'));if(!data.ok||data.truncated)throw Error(file+' incomplete');for(const raw of data.rows){read++;const p=normalizeGrocery(raw);if(!p)continue;const before=foods.get(p.barcode);if(!before||(p.packaging&&!before.packaging))foods.set(p.barcode,p);}}
const groceries=[...foods.values()].sort((a,b)=>a.barcode.localeCompare(b.barcode));
const all=new Map<string,any>(beverages.map((p:any)=>[p.barcode,p]));
// Explicit food categories correct old generic drink entries for the same SKU.
for(const p of groceries)all.set(p.barcode,p);
// Explicit non-food contamination in the upstream beverage snapshot is retired, not deleted.
for(const [code,p] of all)if(/\b(cotonetes?|detergente|sabao|sabonete|shampoo|racao|fralda|absorvente|papel higienico)\b/.test(catalogText(p.name)))all.delete(code);
const products=[...all.values()].sort((a,b)=>a.barcode.localeCompare(b.barcode));
writeFileSync(join(root,'groceries.json'),JSON.stringify(groceries,null,2)+'\n');
writeFileSync(join(root,'products.json'),JSON.stringify(products,null,2)+'\n');
const manifest=JSON.parse(readFileSync(join(root,'manifest.json'),'utf8'));
const counts=(key:string)=>Object.fromEntries([...new Set(products.map(p=>p[key]||'Não informada'))].sort().map(k=>[k,products.filter(p=>(p[key]||'Não informada')===k).length]));
manifest.extendedAt=new Date().toISOString();manifest.products=products.length;manifest.withImages=products.length;manifest.brands=new Set(products.map(p=>catalogText(p.brand))).size;manifest.markets=counts('market');manifest.categories=counts('category');manifest.packaging=counts('packaging');manifest.kinds=counts('kind');
manifest.groceries={inputRows:read,products:groceries.length,sourceFiles:files,scope:'Alimentos de mercearia associados ao mercado brasileiro, com marca, GTIN válido e foto frontal vinculada ao mesmo código.',selection:'Cobertura por categorias e marcas. A fonte não fornece ranking de vendas e a coleção não equivale a todos os SKUs comercializados.'};
manifest.groceries.imageSample={checkedAt:'2026-11-17',method:'HTTP 200 e inspeção visual do produto/peso da foto',barcodes:['7896006711155','7891100794905','7896089011357']};
for(const source of [{name:'Open Food Facts / Mirabelle — alimentos brasileiros',url:'https://mirabelle.openfoodfacts.org/products',files},{name:'Camil — portfólio',url:'https://www.camil.com.br/'},{name:'Nestlé — categorias de marcas',url:'https://www.nestle.com.br/marcas'},{name:'Bauducco — portfólio',url:'https://www.bauducco.com.br/'}])if(!manifest.sources.some((s:any)=>s.name===source.name))manifest.sources.push(source);
writeFileSync(join(root,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({products:manifest.products,groceries:groceries.length,beverages:manifest.kinds.BEVERAGE,brands:manifest.brands,markets:manifest.markets,categories:manifest.categories},null,2));
