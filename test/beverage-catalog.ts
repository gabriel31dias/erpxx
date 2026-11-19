import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { catalogText, normalizeBeverage, validGtin, volumeOf, ncmCandidate } from '../src/modules/beverage-reference';

export async function checkBeverageCatalog({check,api,outra,caixa,moto1,db,base}:any) {
 console.log('\nCatálogo de bebidas com imagens');
 const products=JSON.parse(readFileSync(join(__dirname,'../data/catalog/products.json'),'utf8'));
 const wanted=['7894900010015','7894900700015','7894900530001','7896045506064'];
 const fixtures=products.filter((p:any)=>wanted.includes(p.barcode));
 const foreign=products.find((p:any)=>p.market==='Internacional'&&p.category==='Refrigerantes'&&p.packaging==='Lata'&&p.volumeMl===350);
 if(foreign)fixtures.push(foreign);
 await db.beverageReference.createMany({data:fixtures});
 const fiscal=JSON.parse(readFileSync(join(__dirname,'../data/catalog/fiscal-codes.json'),'utf8'));
 await db.fiscalCodeReference.createMany({data:fiscal.filter((p:any)=>['22021000','22029100','22030000','0301002','0302203','5102','5405','6102'].includes(p.code))});
 await check('pesquisa importada só contém GTIN válido e imagem do mesmo produto',()=>{
   assert.ok(products.length>10000);
   assert.equal(new Set(products.map((p:any)=>p.barcode)).size,products.length);
   for(const p of products){assert.ok(validGtin(p.barcode));assert.ok(p.imageUrl.startsWith('https://images.openfoodfacts.org/'));assert.ok(p.sourceUrl.endsWith(p.barcode));assert.equal(p.imageLicense,'CC BY-SA 3.0');}
   const base={code:'7894900010015',product_name:'Refrigerante',brands:'Coca-Cola',categories_tags:'en:beverages,en:sodas',quantity:'350ml',image_url:fixtures[0].imageUrl};
   assert.ok(normalizeBeverage(base)?.name.includes('Coca-Cola'));
   assert.equal(normalizeBeverage({...base,image_url:fixtures[1].imageUrl}),null);
   assert.equal(normalizeBeverage({...base,code:'7894900010016'}),null);
   assert.equal(normalizeBeverage({...base,image_url:''}),null);
   assert.equal(normalizeBeverage({...base,product_name:'Molho barbecue',categories_tags:'en:sauces'}),null);
   assert.deepEqual(volumeOf('12 x 350ml'),{volumeMl:350,packCount:12});
   assert.deepEqual(volumeOf('1,5 L'),{volumeMl:1500,packCount:1});
   assert.equal(normalizeBeverage(base)?.packaging,null,'não inventa lata a partir de 350ml');
   assert.equal(ncmCandidate({category:'Cervejas',name:'Heineken 0.0 álcool',volumeMl:350}),'22029100');
   assert.equal(ncmCandidate({category:'Sucos e néctares',name:'Suco de uva',volumeMl:1000}),null);
 });
 await check('busca local aceita marca, volume, acentos e código, prioriza Brasil e não exige criar um produto',async()=>{
   const start=await db.product.count();
   const result=await api('GET','/api/product-catalog?q=coca%20lata%20350');
   assert.equal(result.status,200);assert.ok(result.data.rows.length>=2);
   assert.equal(result.data.rows[0].market,'Brasil');assert.ok(result.data.rows.every((p:any)=>p.packaging==='Lata'&&p.imageUrl));
   assert.equal((await api('GET','/api/product-catalog?q=7894900530001')).data.rows[0].brand,'CRYSTAL');
   const accent=await api('GET','/api/product-catalog?q=a%C3%A7%C3%BAcar%20zero');
   assert.ok(accent.data.rows.some((p:any)=>p.barcode==='7894900700015'));
   assert.deepEqual((await api('GET','/api/product-catalog?q=c')).data.rows,[]);
   assert.equal(await db.product.count(),start);
   assert.equal((await moto1('GET','/api/product-catalog?q=coca')).status,403);
   assert.equal((await fetch(base+'/api/product-catalog?q=coca')).status,401);
 });
 await check('dados fiscais têm fonte oficial, cerveja sem álcool tem candidato próprio e CFOP fica fora da sugestão de SKU',async()=>{
   const result=await api('GET','/api/product-catalog/7896045506064');
   assert.equal(result.status,200);assert.equal(result.data.fiscal.status,'suggestion');
   assert.equal(result.data.fiscal.ncm.code,'22029100');assert.equal(result.data.fiscal.cest.code,'0302203');
   assert.ok(result.data.fiscal.ncm.sourceUrl.includes('siscomex.gov.br'));
   assert.equal(result.data.fiscal.cfop,undefined);
   assert.equal((await api('GET','/api/product-catalog/fiscal?kind=CFOP&q=5405')).data.rows[0].code,'5405');
   assert.equal((await api('GET','/api/product-catalog/fiscal?kind=SQL&q=foo')).status,400);
   assert.equal((await api('GET','/api/product-catalog/9999999999999')).status,404);
 });
 let created:any;
 await check('cadastro grava a foto e a referência, mantém preço da empresa e isola indicação de duplicados',async()=>{
   const p=fixtures.find((p:any)=>p.barcode==='7894900010015');
   const data={name:p.name,barcode:p.barcode,brand:p.brand,priceCents:799,costCents:350,imageUrl:p.imageUrl,catalogBarcode:p.barcode,menuVisible:true};
   assert.equal((await caixa('POST','/api/products',data)).status,403);
   const result=await api('POST','/api/products',data);assert.equal(result.status,201,JSON.stringify(result.data));created=result.data;
   assert.equal(created.imageUrl,p.imageUrl);assert.equal(created.catalogBarcode,p.barcode);assert.equal(created.priceCents,799);assert.equal(created.ncm,null);
   const detail=(await api('GET',`/api/products/${created.id}`)).data.product;
   assert.equal(detail.catalogReference.imageLicense,'CC BY-SA 3.0');
   assert.equal((await api('GET','/api/product-catalog?q='+p.barcode)).data.rows[0].existingProductId,created.id);
   assert.equal((await outra('GET','/api/product-catalog?q='+p.barcode)).data.rows[0].existingProductId,null);
   assert.equal((await api('POST','/api/products',data)).status,400);
   const owner=await db.user.findFirstOrThrow({where:{email:'ana@teste.com'},include:{company:true}});
   const menu=await fetch(base+`/api/public/stores/${owner.company.slug}`);
   const catalog=await menu.json() as any;
   const publicProduct=catalog.products.find((x:any)=>x.id===created.id);
   assert.equal(publicProduct.image_credit.license,'CC BY-SA 3.0');assert.equal(publicProduct.image_url,p.imageUrl);
   const changed=await api('PATCH',`/api/products/${created.id}`,{...data,imageUrl:'https://example.org/my-own-photo.jpg'});
   assert.equal(changed.status,200);
   const publicUpdated=await (await fetch(base+`/api/public/stores/${owner.company.slug}`)).json() as any;
   assert.equal(publicUpdated.products.find((x:any)=>x.id===created.id).image_credit,null);
 });
 await check('exportação aberta contém apenas referências pesquisadas e atribuição das imagens',async()=>{
   const response=await fetch(base+'/api/product-catalog/export');assert.equal(response.status,200);
   assert.ok(response.headers.get('content-disposition')?.includes('catalogo-produtos'));
   const rows=await response.json() as any[];
   assert.equal(rows.length,products.length);assert.ok(rows.every(p=>p.imageUrl&&p.imageAttribution&&!('companyId'in p)&&!('priceCents'in p)));
 });
 // Keep the selected Brazilian records for the browser verification after this suite.
}
