import * as assert from 'assert';
import {readFileSync} from 'fs';
import {join} from 'path';
import {normalizeGrocery,weightOf} from '../src/modules/grocery-reference';

export async function checkGroceryCatalog({check,api,outra,db}:any){
 console.log('\nAlimentos de mercearia');
 const data=JSON.parse(readFileSync(join(__dirname,'../data/catalog/products.json'),'utf8'));
 const rice=data.find((p:any)=>p.barcode==='7896006711155');
 const coffee=data.find((p:any)=>p.barcode==='7896089011357');
 const bean=data.find((p:any)=>p.barcode==='7891100794905');
 await db.beverageReference.createMany({data:[rice,coffee,bean]});
 const raw={code:rice.barcode,product_name:'Arroz Tipo 1 Camil 5kg',brands:'Camil',quantity:'5kg',categories_tags:'en:rice',image_url:rice.imageUrl,countries_tags:'en:brazil'};
 await check('alimentos preservam marca, foto do GTIN e peso da embalagem sem virar venda por quilo',()=>{
  const normalized=normalizeGrocery(raw)!;assert.equal(normalized.kind,'GROCERY');assert.equal(normalized.weightGrams,5000);assert.equal(normalized.volumeMl,null);assert.equal(normalized.imageUrl,rice.imageUrl);
  assert.equal(normalizeGrocery({...raw,image_url:coffee.imageUrl}),null);assert.equal(normalizeGrocery({...raw,image_url:''}),null);
  assert.equal(normalizeGrocery({...raw,product_name:'Cotonetes',categories_tags:'en:herbal-teas'}),null);
  assert.equal(normalizeGrocery({...raw,product_name:'Detergente de coco',categories_tags:'en:coconut-waters'}),null);
  assert.equal(normalizeGrocery({...raw,product_name:'Refrigerante Fanta Laranja',categories_tags:''}),null);
  assert.equal(normalizeGrocery({...raw,product_name:'Chocolate ao leite',categories_tags:'en:chocolates',quantity:'100g'})!.category,'Chocolates e doces');
  assert.equal(normalizeGrocery({...raw,product_name:'Cereal infantil arroz',categories_tags:'',quantity:'200g'})!.category,'Alimentos infantis');
  assert.equal(normalizeGrocery({...raw,product_name:'Bebida à base de arroz',categories_tags:'en:plant-based-milk-alternatives',quantity:'1L'})!.category,'Bebidas vegetais');
  assert.equal(weightOf('1,5 kg'),1500);assert.equal(weightOf('500 g'),500);assert.equal(weightOf('1L'),null);
 });
 await check('busca de mercearia aceita 5 kg/5000g, marcas e filtros de categoria e tipo',async()=>{
  const result=await api('GET','/api/product-catalog?q=arroz%20camil%205%20kg&kind=GROCERY');assert.equal(result.status,200);assert.ok(result.data.rows.some((p:any)=>p.barcode===rice.barcode));
  assert.ok(result.data.rows.every((p:any)=>p.kind==='GROCERY'&&p.weightGrams===5000));
  assert.equal((await api('GET','/api/product-catalog?q=arroz%205000g&category=Arroz')).data.rows[0].barcode,rice.barcode);
  assert.equal((await api('GET','/api/product-catalog?q=caf%C3%A9%20pil%C3%A3o%20500g&kind=GROCERY')).data.rows[0].barcode,coffee.barcode);
  assert.deepEqual((await api('GET','/api/product-catalog?q=arroz&kind=BEVERAGE')).data.rows,[]);
  const summary=(await api('GET','/api/product-catalog/summary')).data;assert.equal(summary.kinds.GROCERY,3);assert.ok(summary.categories.some((p:any)=>p.name==='Arroz'&&p.kind==='GROCERY'));
 });
 await check('cadastro de alimento grava foto e peso, mantém preço escolhido e não adivinha NCM ou CFOP',async()=>{
  const detail=(await api('GET','/api/product-catalog/'+rice.barcode)).data;assert.equal(detail.fiscal.ncm,null);assert.equal(detail.fiscal.cest,null);
  const result=await api('POST','/api/products',{name:rice.name,barcode:rice.barcode,brand:rice.brand,catalogBarcode:rice.barcode,imageUrl:rice.imageUrl,unit:'UN',saleType:'UNIT',netWeight:5,costCents:1900,priceCents:2890,cfop:'5405'});
  assert.equal(result.status,201,JSON.stringify(result.data));assert.equal(result.data.priceCents,2890);assert.equal(result.data.unit,'UN');assert.equal(result.data.netWeight,5);assert.equal(result.data.ncm,null);assert.equal(result.data.cfop,'5405');
  const saved=(await api('GET','/api/products/'+result.data.id)).data.product;assert.equal(saved.catalogReference.kind,'GROCERY');assert.equal(saved.catalogReference.weightGrams,5000);assert.equal(saved.imageUrl,rice.imageUrl);
  assert.equal((await outra('GET','/api/product-catalog?q='+rice.barcode)).data.rows[0].existingProductId,null);
  assert.equal((await api('GET','/api/product-catalog?q='+rice.barcode)).data.rows[0].existingProductId,result.data.id);
 });
 await check('referência retirada sai da busca e mantém histórico e foto do cadastro existente',async()=>{
  await db.beverageReference.update({where:{barcode:rice.barcode},data:{active:false}});
  assert.deepEqual((await api('GET','/api/product-catalog?q='+rice.barcode)).data.rows,[]);
  assert.equal((await api('GET','/api/product-catalog/'+rice.barcode)).status,404);
  assert.equal((await api('GET','/api/product-catalog/summary')).data.kinds.GROCERY,2);
  assert.equal((await db.beverageReference.findUnique({where:{barcode:rice.barcode}})).imageUrl,rice.imageUrl);
  await db.beverageReference.update({where:{barcode:rice.barcode},data:{active:true}});
 });
}
