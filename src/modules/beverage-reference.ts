/** Pure normalization shared by the importer and the local search API. */
export const catalogText = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/(\d)[,.](\d)/g, '$1.$2').replace(/[^a-z0-9.]+/g, ' ').trim();
export function validGtin(code: string) {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(code) || /^0+$/.test(code)) return false;
  const digits = code.slice(0, -1).split('').reverse();
  const sum = digits.reduce((n, d, i) => n + Number(d) * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - sum % 10) % 10 === Number(code.slice(-1));
}
export function volumeOf(quantity: string, name = '') {
  const raw = `${quantity} ${name}`.replace(/(\d),(\d)/g, '$1.$2');
  const match = raw.match(/(\d+(?:\.\d+)?)\s*(ml|cl|litros?|litres?|l|fl\.?\s?oz)\b/i);
  const pack = raw.match(/\b(\d+)\s*[x×]\s*\d/i) || raw.match(/\b(\d+)\s*(?:unidades|latas|garrafas|bottles|cans|pack)\b/i) || raw.match(/\bpack\s+(?:de\s+)?(\d+)\b/i);
  const ml = match ? Math.round(Number(match[1]) * (/^ml$/i.test(match[2]) ? 1 : /^cl$/i.test(match[2]) ? 10 : /oz/i.test(match[2]) ? 29.5735 : 1000)) : null;
  return { volumeMl: ml && ml <= 100000 ? ml : null, packCount: pack ? Number(pack[1]) : 1 };
}
function groupFor(text: string) {
  if (/\b(brahma|skol|antarctica|bohemia|spaten|budweiser|stella artois|corona|beck s|becks|colorado|patagonia|goose island|fusion|pepsi|sukita|h2oh|do bem|mike s)\b/.test(text)) return 'Ambev';
  if (/\b(heineken|amstel|eisenbahn|devassa|kaiser|baden baden|lagunitas|blue moon|itubaina|fys|praya)\b/.test(text)) return 'Grupo HEINEKEN';
  if (/\b(itaipava|petra|black princess|cacildis|lokal|tnt|nordka)\b/.test(text)) return 'Grupo Petrópolis';
  if (/\b(coca cola|fanta|sprite|kuat|schweppes|del valle|powerade)\b/.test(text)) return 'Sistema Coca-Cola';
  return null;
}
/** A source photo must belong to this exact GTIN (OFF pads EAN-8 paths). */
export function referenceImage(raw: any, barcode: string): string | null {
  const url = String(raw.image_url || raw.image_front_url || '');
  const match = url.match(/^https:\/\/images\.openfoodfacts\.org\/images\/products\/([\d/]+)\/front_[a-z_-]+\.\d+\.400\.(jpg|png|webp)$/);
  return match && match[1].replace(/\//g, '').replace(/^0+/, '') === barcode.replace(/^0+/, '') ? url : null;
}
export function normalizeBeverage(raw: any) {
  const barcode = String(raw.code || '').trim();
  const originalName = String(raw.product_name || raw.product_name_pt || '').trim().replace(/\s+/g, ' ');
  const brand = String(raw.brands || '').trim().split(',')[0].trim();
  const tags = String(raw.categories_tags || '');
  const text = catalogText(`${originalName} ${brand}`);
  if (!validGtin(barcode) || originalName.length < 2 || !brand || /<|>/.test(originalName)) return null;
  const imageUrl = referenceImage(raw, barcode);
  if (!imageUrl) return null;
  if (/en:(sauces|candies|confectioneries|biscuits|chocolates|milk-powders|powdered-milks|whey-powders|baby-foods|coffee-beans|ground-coffees|instant-coffees|teas|ice-creams|cheeses|meats|sausages|cakes|chocolate-candies)(,|$)/.test(tags)
    || /\b(molho|sauce|chocolate|bombom|capsulas|leite em po|cafe em po|whey protein|sorvete|ice cream|icecream|cheese|fromage|saucisse|sausage|milk|leite|cake)\b/.test(text) || /^cream$/i.test(originalName)) return null;
  const t = `${tags} ${text}`;
  let category: string;
  if (/en:beers\b|\b(cerveja|beer|bier|pilsen|lager|chopp)\b/.test(t)) category = 'Cervejas';
  else if (/en:whisk|\b(whisk[ey]*|bourbon)\b/.test(t)) category = 'Whiskies';
  else if (/en:vodkas|\bvodka\b/.test(t)) category = 'Vodkas';
  else if (/en:gins\b|\bgin\b/.test(t)) category = 'Gins';
  else if (/en:rums\b|\b(rum|cachaca|aguardente)\b/.test(t)) category = 'Runs e cachaças';
  else if (/en:tequilas|\btequila\b/.test(t)) category = 'Tequilas';
  else if (/en:liqueurs|\b(licor|liqueur|aperitivo|vermouth|vermute|campari|aperol|amarula|baileys|jagermeister)\b/.test(t)) category = 'Licores e aperitivos';
  else if (/en:(sparkling-wines|champagnes)|\b(espumante|champagne|cava|prosecco)\b/.test(t)) category = 'Espumantes';
  else if (/en:wines\b|\b(vinho|wine|vin rouge|vin blanc)\b/.test(t)) category = 'Vinhos';
  else if (/en:energy-drinks|\b(energetico|energy|red bull|monster|tnt|fusion|baly)\b/.test(t)) category = 'Energéticos';
  else if (/en:sports-drinks|\b(isotonico|gatorade|powerade)\b/.test(t)) category = 'Isotônicos';
  else if (/en:coconut-waters|\b(agua de coco|coconut water)\b/.test(t)) category = 'Água de coco';
  else if (/en:(waters|spring-waters|mineral-waters)|\b(agua mineral|agua saborizada|agua com gas|agua sem gas|mineral water|sparkling water|bonafont|minalba|perrier)\b/.test(t)) category = 'Águas';
  else if (/en:(sodas|colas|carbonated-drinks)|\b(refrigerante|coca cola|pepsi|fanta|sprite|guarana|kuat|schweppes|sukita|h2oh|itubaina|fys)\b/.test(t)) category = 'Refrigerantes';
  else if (/en:(iced-teas|tea-based-beverages|kombuchas)|\b(cha|tea|kombucha|mate|lipton)\b/.test(t)) category = 'Chás e kombuchas';
  else if (/en:(fruit-juices|juices|fruit-nectars|fruit-based-beverages)|\b(suco|nectar|juice|maguary|del valle|natural one|su fresh|sufresh|suvalan|tial)\b/.test(t)) category = 'Sucos e néctares';
  else if (/en:(ciders|alcoholic-beverages)|\b(sidra|sake|saque|conhaque|brandy|drink|bebida alcoolica)\b/.test(t)) category = 'Outras bebidas alcoólicas';
  else if (/en:beverages\b/.test(tags)) category = 'Outras bebidas';
  else return null;
  const { volumeMl, packCount } = volumeOf(String(raw.quantity || ''), originalName);
  if (/\b\d+(?:[.,]\d+)?\s*(kg|g|gramas)\b/i.test(raw.quantity || '') && !volumeMl) return null;
  const pkg = catalogText(`${raw.packaging || ''} ${raw.packaging_tags || ''} ${originalName}`);
  const packaging = /\b(lata|latas|can|cans|lt)\b/.test(pkg) ? 'Lata'
    : /\bpet\b/.test(pkg) ? 'Garrafa PET'
    : /\b(long neck|longneck)\b/.test(pkg) ? 'Long neck'
    : /\b(glass|vidro)\b/.test(pkg) ? 'Garrafa de vidro'
    : /\b(garrafa|bottle|bottles)\b/.test(pkg) ? 'Garrafa'
    : /\b(tetra|carton|cartons|caixinha)\b/.test(pkg) ? 'Caixinha'
    : /\b(barril|keg)\b/.test(pkg) ? 'Barril' : null;
  const rawQuantity = String(raw.quantity || '').trim();
  const quantityLabel = /\d+\s*(ml|cl|l|litros?|litres?|fl\.?\s?oz)\b/i.test(rawQuantity) ? rawQuantity : volumeMl ? `${packCount > 1 ? packCount + ' × ' : ''}${volumeMl} ml` : null;
  const name = [originalName, !catalogText(originalName).includes(catalogText(brand)) ? brand : '',
    volumeMl && !/\d+\s*(ml|cl|l|litros?|oz)\b/i.test(originalName) ? (packCount > 1 ? `${packCount} × ` : '') + `${volumeMl} ml` : '',
    packaging && !catalogText(originalName).includes(catalogText(packaging)) ? packaging : ''].filter(Boolean).join(' · ');
  const manufacturerGroup = groupFor(catalogText(brand));
  return {
    barcode, name, brand, category, manufacturerGroup, packaging, quantityLabel, volumeMl, packCount, kind: 'BEVERAGE', weightGrams: null, active: true,
    market: String(raw.countries_tags || '').includes('en:brazil') || /^789/.test(barcode) ? 'Brasil' : 'Internacional',
    imageUrl, imageLicense: 'CC BY-SA 3.0', imageAttribution: 'Open Food Facts — colaboradores',
    sourceUrl: `https://world.openfoodfacts.org/product/${barcode}`, sourceName: 'Open Food Facts',
    sourceUpdatedAt: raw.last_modified_t ? new Date(Number(raw.last_modified_t) * 1000).toISOString() : null,
    searchText: catalogText(`${name} ${barcode} ${brand} ${manufacturerGroup || ''} ${category} ${quantityLabel || ''} ${packaging || ''} ${volumeMl || ''}ml ${volumeMl ? volumeMl / 1000 + 'l' : ''}`),
  };
}

/** Only category-based candidates; never a verified SKU fiscal classification. */
export function ncmCandidate(p: { category: string; name: string; volumeMl: number | null; packCount?: number }) {
  const name = catalogText(p.name);
  if (p.category === 'Cervejas') return /\b(sem alcool|alcohol free|non alcoholic|0[. ]0|zero alcool)\b/.test(name) ? '22029100' : '22030000';
  if (/\b(sem alcool|sin alcohol|alcohol free|non alcoholic|0[. ]0)\b/.test(name)) return null;
  if (p.category === 'Refrigerantes') return '22021000';
  if (p.category === 'Águas' && /\b(mineral|perrier)\b/.test(name)) return '22011000';
  if (p.category === 'Vodkas') return '22086000';
  if (p.category === 'Gins') return '22085000';
  if (p.category === 'Runs e cachaças') return '22084000';
  if (p.category === 'Whiskies' && p.volumeMl && p.volumeMl * (p.packCount || 1) <= 2000) return '22083020';
  if (p.category === 'Vinhos' && p.volumeMl && p.volumeMl * (p.packCount || 1) <= 2000) return '22042100';
  return null;
}
