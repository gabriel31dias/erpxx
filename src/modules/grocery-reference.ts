import { catalogText, referenceImage, validGtin, volumeOf } from './beverage-reference';

/** Package content, not a selling unit: 5 kg rice is sold as one retail package (UN). */
export function weightOf(quantity: string, name = '') {
  const text = `${quantity} ${name}`.replace(/(\d),(\d)/g, '$1.$2');
  const match = text.match(/\b(\d+(?:\.\d+)?)\s*(kg|kgs|g|gr|gramas?|quilogramas?)\b/i);
  const grams = match ? Math.round(Number(match[1]) * (/^(kg|kgs|quilograma)/i.test(match[2]) ? 1000 : 1)) : null;
  return grams && grams <= 100000 ? grams : null;
}

export function normalizeGrocery(raw: any) {
  const barcode = String(raw.code || '').trim();
  const originalName = String(raw.product_name_pt || raw.product_name || '').trim().replace(/\s+/g,' ');
  const brand = String(raw.brands || '').split(',')[0].trim();
  if(!validGtin(barcode)||originalName.length<2||!brand||/[<>]/.test(originalName))return null;
  const imageUrl=referenceImage(raw,barcode);if(!imageUrl)return null;
  const text=catalogText(originalName);
  const tags=new Set(String(raw.categories_tags||'').split(',').map((t:string)=>t.trim()));
  const tag=(...names:string[])=>names.some(name=>tags.has('en:'+name));
  if(tag('pet-food','pet-foods','dog-food','cat-food','food-supplements','dietary-supplements') || /\b(racao|cachorros?|gatos?|pet food|dog food|cat food|detergente|desinfetante|sabao|sabonete|shampoo|amaciante|agua sanitaria|creme dental|cotonetes?|algodao|escova|papel higienico|absorvente|fralda|esponja|alcool etilico|acetona|tinta|whey|creatina)\b/.test(text))return null;
  if(tag('sodas','beers','wines','hard-liquors','spirits','waters','fruit-juices','energy-drinks','sports-drinks','iced-teas','coconut-waters','fruit-nectars'))return null;
  // A declared food category wins over incidental words such as 'chocolate ao leite'.
  if (/\b(refrigerante|cerveja|whisky|vodka|energetico|isotonico|suco|nectar|refresco|kombucha|ice tea|cha pronto)\b/.test(text)) return null;
  const rules = [
    { category: 'Bebidas vegetais', tags: ['plant-milks','plant-based-milks','soy-milks','almond-milks','oat-milks','rice-milks','plant-based-milk-alternatives'], pattern: /\bbebida a base de (?:soja|arroz|amendoa|aveia)|^silk\b/ },
    { category: 'Sopas e refeições prontas', tags: ['soups','dehydrated-soups'], pattern: /\b(sopa|sopinha|sopao)\b/ },
    { category: 'Alimentos infantis', tags: ['baby-foods','baby-milks','infant-formulas'], pattern: /\b(papinha|formula infantil|composto infantil|cereal infantil|farinha lactea|mucilon)\b/ },
    { category: 'Leite em pó e compostos lácteos', tags: ['milk-powders','powdered-milks','whole-milk-powder','skimmed-milk-powder'], pattern: /\bleite (?:em )?po\b|\bcomposto lacteo\b/ },
    { category: 'Leite condensado e creme de leite', tags: ['condensed-milks','creams'], pattern: /\b(leite condensado|creme de leite|mistura lactea condensada)\b/ },
    { category: 'Iogurtes e sobremesas lácteas', tags: ['yogurts','dairy-desserts','fermented-milks'], pattern: /\b(iogurte|yogurt|yoghurt|leite fermentado|sobremesa lactea|petit suisse)\b/ },
    { category: 'Leites e bebidas lácteas', tags: ['milks','dairy-drinks','chocolate-milks'], pattern: /^(leite|bebida lactea)\b|\bmilk\b/ },
    { category: 'Manteigas e margarinas', tags: ['butters','margarines'], pattern: /\b(manteiga|margarina)\b/ },
    { category: 'Queijos e requeijão', tags: ['cheeses','cream-cheeses'], pattern: /\b(queijo|queijos|requeijao|mussarela|mucarela|parmesao|ricota|cottage|cheddar)\b/ },
    { category: 'Sorvetes e gelados', tags: ['ice-creams','frozen-desserts'], pattern: /\b(sorvete|picole|gelado|ice cream|icecream|acai)\b/ },
    { category: 'Achocolatados e cacau', tags: ['cocoa-and-chocolate-powders','chocolate-powders'], pattern: /\b(achocolatado|cacau em po|chocolate em po)\b/ },
    { category: 'Ingredientes para confeitaria', tags: ['cake-mixes','baking-powders','baker-yeast','dessert-mixes'], pattern: /\b(fermento|gelatina|mistura (?:para|p) bolo|mistura para pao|pudim em po)\b/ },
    { category: 'Geleias, pastas e cremes', tags: ['sweet-spreads','jams','peanut-butters','chocolate-spreads'], pattern: /\b(geleia|pasta de amendoim|creme de avela|doce de leite)\b/ },
    { category: 'Biscoitos e bolachas', tags: ['biscuits','cookies','crackers','wafers'], pattern: /\b(biscoito|biscoitos|bolacha|bolachas|wafer|cookies?|cream cracker|rosquinhas?)\b/ },
    { category: 'Chocolates e doces', tags: ['chocolates','candies','confectioneries','chocolate-candies'], pattern: /\b(chocolates?|bombom|bombons|bala|balas|pirulito|chiclete|pacoca|goiabada|mariola|rapadura|doce)\b/ },
    { category: 'Pães, bolos e torradas', tags: ['breads','cakes','toasts','bakery-products'], pattern: /\b(pao|paes|bolo|bolinho|torrada|panetone|panettone|chocotone|chocottone|bisnaguinha)\b/ },
    { category: 'Salgadinhos, pipoca e amendoim', tags: ['salty-snacks','crisps','popcorn','peanuts'], pattern: /\b(salgadinho|snack|chips|batata frita|batata palha|pipoca|amendoim|doritos|cheetos|ruffles|lays)\b/ },
    { category: 'Cereais, aveia e granolas', tags: ['breakfast-cereals','oat-flakes','granolas'], pattern: /\b(aveia|granola|cereal matinal|sucrilhos|cereais matinais|flocos de arroz)\b/ },
    { category: 'Congelados e pratos prontos', tags: ['frozen-ready-made-meals','pizzas','ready-made-meals'], pattern: /\b(pizza|lasanha|nuggets|hamburguer|hamburger|escondidinho|prato pronto)\b/ },
    { category: 'Frios e embutidos', tags: ['hams','sausages','cold-cuts'], pattern: /\b(presunto|mortadela|salsicha|linguica|salame|peito de peru|bacon|calabresa)\b/ },
    { category: 'Atum e sardinha', tags: ['canned-fishes'], pattern: /\b(atum|sardinha|sardinhas)\b/ },
    { category: 'Conservas e enlatados', tags: ['canned-foods','canned-vegetables','pickles'], pattern: /\b(conserva|ervilha em lata|milho verde|seleta|palmito|azeitona|pepino em conserva)\b/ },
    { category: 'Molhos e condimentos', tags: ['sauces','tomato-sauces','mayonnaises','mustards','ketchups'], pattern: /\b(molho|extrato de tomate|polpa de tomate|ketchup|catchup|maionese|mostarda)\b/ },
    { category: 'Cafés', tags: ['coffees','ground-coffees','instant-coffees','coffee-beans'], pattern: /\b(cafe|coffee|cappuccino|capuccino)\b/ },
    { category: 'Chás e infusões', tags: ['teas','herbal-teas','herbal-infusions'], pattern: /\b(cha|camomila|erva mate|erva doce)\b/ },
    { category: 'Óleos, azeites e vinagres', tags: ['vegetable-oils','olive-oils','vinegars'], pattern: /\b(oleo|azeite|vinagre)\b/ },
    { category: 'Açúcares e adoçantes', tags: ['sugars','sweeteners','honeys'], pattern: /\b(acucar|adocante|mel)\b/ },
    { category: 'Sal e temperos', tags: ['salts','spices','seasonings'], pattern: /\b(sal|tempero|caldo|pimenta|oregano|cominho|canela|colorau|sazon)\b/ },
    { category: 'Farinhas, farofas e amidos', tags: ['flours','cassava-flours','cornmeal','starches'], pattern: /\b(farinha|farofa|fuba|polvilho|tapioca|amido)\b/ },
    { category: 'Massas e macarrão', tags: ['pastas','noodles','instant-noodles'], pattern: /\b(macarrao|massa|espaguete|spaghetti|penne|parafuso|talharim|miojo)\b/ },
    { category: 'Arroz', tags: ['rice','rices'], pattern: /\barroz\b/ },
    { category: 'Feijão e leguminosas', tags: ['beans','lentils','chickpeas','dried-legumes'], pattern: /\b(feijao|lentilha|grao de bico|ervilha|soja em graos)\b/ },
    { category: 'Castanhas, grãos e sementes', tags: ['seeds','nuts'], pattern: /\b(chia|linhaca|semente|castanha|nozes|amendoa)\b/ },
    { category: 'Ovos', tags: ['eggs'], pattern: /\bovos?\b/ },
    { category: 'Carnes, aves e pescados', tags: ['meats','fishes','poultry'], pattern: /\b(frango|carne|peixe|file|costela|pernil|lombo|tilapia|salmao)\b/ },
    { category: 'Hortifruti embalado', tags: ['fresh-fruits','fresh-vegetables'], pattern: /\b(alface|batata|cebola|cenoura|banana|maca|laranja|tomate|brocolis|mandioca)\b/ },
  ];
  const declaredRule = rules.find(r => tag(...r.tags));
  if (!declaredRule && /\b(coca cola|fanta|sprite|schweppes|pepsi|del valle|red bull|monster|gatorade|powerade|energy)\b/.test(text)) return null;
  const rule = declaredRule || rules.find(r => r.pattern.test(text));
  if (!rule) return null;
  const category = rule.category;
  const rawQuantity=String(raw.quantity||'').trim();
  const {volumeMl,packCount}=volumeOf(rawQuantity,originalName);
  if(category==='Hortifruti embalado' && volumeMl) return null;
  const weightGrams=weightOf(rawQuantity,originalName);
  const quantityLabel=/\d+\s*(?:kg|g|gr|gramas?|ml|cl|l|litros?)\b/i.test(rawQuantity)?rawQuantity:weightGrams?`${weightGrams>=1000?weightGrams/1000+' kg':weightGrams+' g'}`:volumeMl?`${volumeMl} ml`:null;
  const pkg=catalogText(`${raw.packaging||''} ${raw.packaging_tags||''} ${originalName}`);
  const packaging=/\b(lata|latas|can|cans)\b/.test(pkg)?'Lata':/\b(pote|potes|jar|jars|tub|tubs)\b/.test(pkg)?'Pote':/\b(sache|saches|sachet|sachets)\b/.test(pkg)?'Sachê':/\b(caixa|caixinha|carton|cartons|tetra)\b/.test(pkg)?'Caixa':/\b(garrafa|bottle|bottles)\b/.test(pkg)?'Garrafa':/\b(pacote|packet|packets|bag|bags)\b/.test(pkg)?'Pacote':null;
  const name=[originalName,!catalogText(originalName).includes(catalogText(brand))?brand:'',quantityLabel&&!/\d+\s*(?:kg|g|gr|ml|cl|l)\b/i.test(originalName)?quantityLabel:'',packaging&&!catalogText(originalName).includes(catalogText(packaging))?packaging:''].filter(Boolean).join(' · ');
  return {barcode,name,brand,manufacturerGroup:null,category,packaging,quantityLabel,volumeMl,weightGrams,packCount,kind:'GROCERY',active:true,
    market:String(raw.countries_tags||'').includes('en:brazil')||/^(789|790)/.test(barcode)?'Brasil':'Internacional',
    imageUrl,imageLicense:'CC BY-SA 3.0',imageAttribution:'Open Food Facts — colaboradores',sourceUrl:`https://world.openfoodfacts.org/product/${barcode}`,sourceName:'Open Food Facts',
    sourceUpdatedAt:raw.last_modified_t?new Date(Number(raw.last_modified_t)*1000).toISOString():null,
    searchText:catalogText(`${name} ${brand} ${barcode} ${category} ${packaging||''} ${quantityLabel||''} ${weightGrams?weightGrams+'g '+weightGrams/1000+'kg':''} ${volumeMl?volumeMl+'ml '+volumeMl/1000+'l':''}`)};
}
