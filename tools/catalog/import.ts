/** Explicit local import: only public reference tables, never tenant products. */
try { process.loadEnvFile(); } catch {}
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { join } from 'path';
const db = new PrismaClient();
async function main() {
 const root=join(__dirname,'../../data/catalog');
 for(const [model,file,keys] of [['BeverageReference','products.json',['barcode']],['FiscalCodeReference','fiscal-codes.json',['kind','code']]] as const) {
  const data=JSON.parse(readFileSync(join(root,file),'utf8'));
  // Bounded batches + upsert preserve references when a researched source is refreshed.
  for(let i=0;i<data.length;i+=300) {
   const batch=data.slice(i,i+300);
   const columns=Object.keys(batch[0]);
   const params:any[]=[];
   const values=batch.map((row:any)=>'('+columns.map(c=>{params.push(row[c]);return '$'+params.length+(c==='sourceUpdatedAt'?'::timestamptz':'');}).join(',')+')').join(',');
   const quote=(c:string)=>'"'+c+'"';
   await db.$executeRawUnsafe(`INSERT INTO "${model}" (${columns.map(quote).join(',')}) VALUES ${values} ON CONFLICT (${keys.map(quote).join(',')}) DO UPDATE SET ${columns.filter(c=>!(keys as readonly string[]).includes(c)).map(c=>`${quote(c)}=EXCLUDED.${quote(c)}`).join(',')}`, ...params);
  }
  if(model==='BeverageReference') {
    // Keep historical references for credits/FKs; remove outdated/non-food rows from suggestions.
    const retired=await db.$executeRawUnsafe('UPDATE "BeverageReference" SET "active" = FALSE WHERE "active" = TRUE AND "barcode" NOT IN (SELECT jsonb_array_elements_text($1::jsonb))',JSON.stringify(data.map((p:any)=>p.barcode)));
    console.log('References retired:',retired);
  }
  console.log(model,data.length,'imported');
 }
}
main().finally(()=>db.$disconnect()).catch(e=>{console.error(e);process.exitCode=1;});
