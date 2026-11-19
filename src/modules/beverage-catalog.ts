import { BadRequestException, Controller, Get, Inject, Module, NotFoundException, Param, Query, StreamableFile } from '@nestjs/common';
import { createReadStream, readFileSync } from 'fs';
import { join } from 'path';
import { PRISMA, Db } from '../common/prisma.service';
import { CurrentUser, Perms, Public, SessionUser } from '../common/auth.guard';
import { catalogText, ncmCandidate } from './beverage-reference';

const root = join(__dirname, '../../data/catalog');
@Controller('api/product-catalog')
@Perms('produto.visualizar')
export class BeverageCatalogController {
  constructor(@Inject(PRISMA) private db: Db) {}

  @Get('summary')
  async summary() {
    const [total, brazil, categories, kinds] = await Promise.all([
      this.db.beverageReference.count({where:{active:true}}), this.db.beverageReference.count({ where: { active:true, market: 'Brasil' } }),
      this.db.beverageReference.groupBy({ where:{active:true}, by: ['category','kind'], _count: { _all: true }, orderBy: { category: 'asc' } }),
      this.db.beverageReference.groupBy({where:{active:true},by:['kind'],_count:{_all:true}}),
    ]);
    return { total, brazil, categories: categories.map(x=>({name:x.category,kind:x.kind,total:x._count._all})), kinds:Object.fromEntries(kinds.map(x=>[x.kind,x._count._all])), imageLicense:'CC BY-SA 3.0',
      sourceUrl:'https://world.openfoodfacts.org', exportUrl:'/api/product-catalog/export', databaseLicense:'ODbL 1.0' };
  }

  // Only the derived public reference database, never tenant products/prices/customers.
  @Get('export') @Public()
  export() {
    return new StreamableFile(createReadStream(join(root, 'products.json')), {
      type: 'application/json; charset=utf-8', disposition: 'attachment; filename="catalogo-produtos-odbl.json"',
    });
  }
  @Get('sources') @Public()
  sources() { return JSON.parse(readFileSync(join(root,'manifest.json'),'utf8')); }

  @Get('fiscal')
  async fiscal(@Query('kind') kind = 'NCM', @Query('q') query = '') {
    if (!['NCM','CEST','CFOP'].includes(kind)) throw new BadRequestException('Tipo fiscal inválido.');
    const input = query.slice(0,120);
    const q = catalogText(/^[\d. -]+$/.test(input) ? input.replace(/\D/g,'') : input);
    const tokens = q.split(/\s+/).filter(Boolean).slice(0,8);
    if (!tokens.length && kind !== 'CFOP') return {rows:[]};
    const rows = await this.db.fiscalCodeReference.findMany({where:{kind,AND:tokens.map(t=>({searchText:{contains:t}}))},orderBy:{code:'asc'},take:20});
    return {rows};
  }

  @Get()
  async search(@CurrentUser() u: SessionUser, @Query('q') query = '', @Query('category') category = '', @Query('market') market = '', @Query('kind') kind = '') {
    const q = catalogText(query.slice(0,120)).replace(/(\d+)\s*litros?\b/g,'$1l').replace(/(\d+)\s*(?:quilos?|quilogramas?|kgs?)\b/g,'$1kg').replace(/(\d+)\s*gramas?\b/g,'$1g');
    if (q.length < 2) return { rows: [] };
    const tokens = q.split(/\s+/).filter(Boolean).slice(0,8);
    const candidates = await this.db.beverageReference.findMany({
      where:{active:true,...(['BEVERAGE','GROCERY'].includes(kind)?{kind}:{}),AND:tokens.map(t=>({searchText:{contains:t}})),...(category?{category:category.slice(0,80)}:{}),...(market==='Brasil'?{market}:{})},
      orderBy:[{market:'asc'},{name:'asc'}],take:160,
    });
    const score=(p: typeof candidates[number])=>(p.barcode===q?10000:0)+(p.market==='Brasil'?1000:0)+(p.packaging?40:0)+((p.volumeMl||p.weightGrams)?20:0)+(catalogText(p.name).startsWith(q)?10:0);
    const rows = candidates.sort((a,b)=>score(b)-score(a)||a.name.localeCompare(b.name,'pt-BR')).slice(0,20);
    const existing = rows.length ? await this.db.product.findMany({where:{companyId:u.companyId,deletedAt:null,barcode:{in:rows.map(x=>x.barcode)}},select:{id:true,barcode:true}}) : [];
    return { rows: rows.map(p=>({...p, searchText:undefined,existingProductId:existing.find(x=>x.barcode===p.barcode)?.id??null})) };
  }

  @Get(':barcode')
  async detail(@Param('barcode') barcode: string) {
    const p = await this.db.beverageReference.findUnique({where:{barcode}});
    if (!p || !p.active) throw new NotFoundException('Referência não encontrada.');
    const code = ncmCandidate(p);
    const ncm = code ? await this.db.fiscalCodeReference.findUnique({where:{kind_code:{kind:'NCM',code}}}) : null;
    // Packaging-specific CEST only when the source explicitly identifies a can or PET.
    const cestCode = p.category==='Cervejas' && p.packaging==='Lata' ? (code==='22029100'?'0302203':'0302103')
      :p.category==='Refrigerantes' && p.packaging==='Lata'?'0301002'
      :p.category==='Refrigerantes' && p.packaging==='Garrafa PET'?'0301001':null;
    const cest = cestCode ? await this.db.fiscalCodeReference.findUnique({where:{kind_code:{kind:'CEST',code:cestCode}}}) : null;
    return {...p,searchText:undefined,fiscal:{ncm,cest,status:'suggestion',note:'Sugestões por tipo de produto e embalagem. Confira a classificação na nota do fornecedor. CFOP, origem e tributação dependem da operação e da empresa.'}};
  }
}
@Module({controllers:[BeverageCatalogController]})
export class BeverageCatalogModule {}
