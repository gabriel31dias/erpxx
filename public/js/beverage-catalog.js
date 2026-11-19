import { get } from './api.js';
import { h, select, toast } from './ui.js';
const normalize = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const link = (url, text) => h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, text);
const variant = p => [p.brand, p.quantityLabel || (p.volumeMl ? `${p.volumeMl} ml` : p.weightGrams ? `${p.weightGrams} g` : 'Conteúdo não informado'), p.packaging || 'Embalagem não informada', p.market].filter(Boolean).join(' · ');

/** Search is local to the ERP database. Only an explicit selection fills fields. */
export function beverageCatalog({ f, product, categories, editable }) {
  let selected = product.catalogReference || null;
  let generation = 0, timer, rows = [], active = -1, autoNetWeight = null, autoDescription = null;
  const status = h('div', { class: 'form-text', role: 'status', 'aria-live': 'polite' }, 'Busque por nome, marca, peso, embalagem, volume ou código de barras.');
  const results = h('div', { id: 'beverage-catalog-options', class: 'lf-beverage-results', role: 'listbox', 'aria-label': 'Produtos do catálogo', hidden: true });
  const photo = h('div', { class: 'col-12 lf-product-photo' });
  const fiscal = h('div', { class: 'col-12 lf-catalog-fiscal', hidden: true });
  const category = select([{value:'',label:'Todas as categorias'}]);
  category.className='form-select form-select-sm';
  category.setAttribute('aria-label','Filtrar catálogo por categoria');
  const catalogKind = select([{value:'',label:'Alimentos e bebidas'},{value:'GROCERY',label:'Alimentos de mercearia'},{value:'BEVERAGE',label:'Bebidas'}],{class:'form-select form-select-sm','aria-label':'Tipo de produto no catálogo'});
  let catalogCategories=[];
  const fillCategories=()=>{const previous=category.value;category.replaceChildren(h('option',{value:''},'Todas as categorias'),...catalogCategories.filter(c=>!catalogKind.value||c.kind===catalogKind.value).map(c=>h('option',{value:c.name},`${c.name} (${c.total})`)));if([...category.options].some(o=>o.value===previous))category.value=previous;};
  const brazil = h('input',{type:'checkbox',class:'form-check-input',id:'catalog-only-brazil'});
  const count = h('small',{}, 'Alimentos e bebidas com fotos');
  const intro = h('div', { class: 'col-12' }, h('div', { class: 'lf-catalog-intro' },
    h('div', {}, h('strong', {}, 'Encontre o produto e preencha o cadastro'), h('div', {}, count)),
    h('div', { class:'lf-catalog-filters' },catalogKind,category,h('label',{for:'catalog-only-brazil',class:'d-flex gap-2 align-items-center mb-0'},brazil,'Só mercado brasileiro'))));
  const photoCredit = p => h('small', {}, link(p.sourceUrl,p.imageAttribution), ' · ', link('https://creativecommons.org/licenses/by-sa/3.0/',p.imageLicense));
  const refreshPhoto = () => {
    photo.replaceChildren();
    const url = f.imageUrl.value.trim();
    if (!url) return;
    const image = h('img',{src:url,alt:`Foto de ${f.name.value || 'produto'}`,class:'lf-product-photo-image',referrerpolicy:'no-referrer'});
    const info = h('div',{},h('strong',{},'Foto do produto'),h('div',{class:'form-text'},selected ? variant(selected) : 'Imagem que será usada no cadastro e no cardápio.'));
    image.addEventListener('error',()=>{image.hidden=true;info.append(h('div',{class:'text-danger small'},'A foto não carregou. Você pode enviar uma imagem pelo botão abaixo.'));});
    if(selected && (selected.imageUrl===url || /^https:\/\/images\.openfoodfacts\.org\//.test(url))) info.append(photoCredit(selected));
    photo.append(image,info);
  };
  const close = () => { results.hidden=true; f.name.setAttribute('aria-expanded','false');f.name.removeAttribute('aria-activedescendant');active=-1; };
  const showFiscal = async reference => {
    fiscal.hidden=true; fiscal.replaceChildren();
    if(!reference) return;
    try {
      const p=await get(`/product-catalog/${reference.barcode}`);
      if(selected?.barcode!==p.barcode) return;
      fiscal.hidden=false;
      fiscal.append(h('strong',{},'Referências fiscais do produto'),h('div',{class:'small mb-2'},p.fiscal.note));
      for(const [kind,field] of [['ncm',f.ncm],['cest',f.cest]]) {
        const code=p.fiscal[kind]; if(!code)continue;
        fiscal.append(h('div',{class:'mb-2'},h('button',{type:'button',class:'btn btn-sm btn-outline-primary me-2',disabled:!editable,onclick:()=>{field.value=code.code;toast(`${kind.toUpperCase()} preenchido. Confirme os demais dados da operação.`);}},`Usar ${kind.toUpperCase()} ${code.code}`),h('small',{},code.description,' · ',link(code.sourceUrl,'Fonte oficial'))));
      }
      if(!p.fiscal.ncm) fiscal.append(h('div',{class:'small'},'Sem NCM sugerido para esta variante. Consulte a nota do fornecedor ou busque na tabela oficial abaixo.'));
    } catch { if(selected?.barcode===reference.barcode){fiscal.hidden=false;fiscal.textContent='Não foi possível carregar as referências fiscais. O cadastro manual continua disponível.';} }
  };
  const choose = reference => {
    if(!editable)return;
    ++generation;clearTimeout(timer);close();
    if(reference.existingProductId && reference.existingProductId!==product.id) {
      status.replaceChildren('Este código já está cadastrado na sua empresa. ',h('a',{href:`/produto.html?id=${reference.existingProductId}`},'Abrir produto existente'));
      return;
    }
    selected=reference;
    f.name.value=reference.name;f.barcode.value=reference.barcode;f.brand.value=reference.brand;f.unit.value='UN';f.saleType.value='UNIT';f.imageUrl.value=reference.imageUrl;
    if(!f.netWeight.value.trim() || f.netWeight.value===autoNetWeight){
      autoNetWeight=reference.weightGrams && reference.packCount===1 ? String(reference.weightGrams/1000).replace('.',',') : '';
      f.netWeight.value=autoNetWeight;
    }
    if(!f.description.value.trim() || f.description.value===autoDescription){
      autoDescription=[reference.category,reference.quantityLabel,reference.packaging].filter(Boolean).join(' · ');
      f.description.value=autoDescription;
    }
    const matching=categories.find(c=>normalize(c.name)===normalize(reference.category));
    if(matching&&!f.categoryId.value){f.categoryId.value=matching.id;f.categoryId.dispatchEvent(new Event('change'));}
    status.replaceChildren(h('span',{},'Produto selecionado. Foto, marca e código de barras preenchidos. Informe seu custo e preço de venda. '),link(reference.sourceUrl,'Ver produto na fonte'));
    refreshPhoto();showFiscal(reference);
  };
  const search = async () => {
    const query=f.name.value.trim();const version=++generation;active=-1;
    if(query.length<2){rows=[];close();return;}
    status.textContent='Buscando produtos com foto…';
    try {
      const data=await get('/product-catalog',{q:query,category:category.value,market:brazil.checked?'Brasil':'',kind:catalogKind.value});
      if(version!==generation||!f.name.isConnected)return;
      rows=data.rows;results.replaceChildren();
      if(!rows.length){close();status.textContent='Nenhuma referência com foto encontrada. Você pode preencher o produto manualmente.';return;}
      for(const [index,p] of rows.entries()) {
        const image=h('img',{src:p.imageUrl,alt:p.name,loading:index<6?'eager':'lazy',referrerpolicy:'no-referrer'});
        const loading=h('small',{class:'lf-beverage-photo-status'},'Carregando foto…');
        const imageBox=h('span',{class:'lf-beverage-photo-box'},image,loading);
        image.addEventListener('load',()=>loading.remove());
        const caption=h('span',{class:'lf-beverage-option-copy'},h('strong',{},p.name),h('small',{},variant(p)),h('small',{},`GTIN ${p.barcode}${p.existingProductId?' · Já cadastrado':''}`));
        image.addEventListener('error',()=>{image.hidden=true;loading.textContent='Foto indisponível';caption.append(h('small',{class:'text-danger'},'Você pode enviar uma foto ao cadastrar.'));});
        results.append(h('button',{id:`beverage-option-${index}`,type:'button',role:'option','aria-selected':'false',class:'lf-beverage-option',onclick:()=>choose(p)},imageBox,caption));
      }
      results.hidden=false;f.name.setAttribute('aria-expanded','true');
      status.replaceChildren(`${rows.length} sugestões. Selecione a embalagem correta. Fotos: `,link('https://world.openfoodfacts.org','Open Food Facts'), ' · ',link('https://creativecommons.org/licenses/by-sa/3.0/','CC BY-SA 3.0'));
    } catch(e) {if(version===generation){close();status.textContent='Busca indisponível. Você pode continuar o cadastro manual.';} }
  };
  f.name.setAttribute('autocomplete','off');f.name.setAttribute('role','combobox');f.name.setAttribute('aria-autocomplete','list');f.name.setAttribute('aria-controls',results.id);f.name.setAttribute('aria-expanded','false');
  f.name.placeholder='Ex.: arroz Camil 5 kg, café, biscoito ou Coca-Cola lata 350 ml';
  f.name.addEventListener('input',()=>{++generation;clearTimeout(timer);close();timer=setTimeout(search,300);});
  f.name.addEventListener('keydown',e=>{
    if(e.key==='Escape'){++generation;clearTimeout(timer);close();return;}
    if(results.hidden||!rows.length)return;
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){
      e.preventDefault();active=(active+(e.key==='ArrowDown'?1:-1)+rows.length)%rows.length;
      [...results.children].forEach((el,i)=>el.setAttribute('aria-selected',String(i===active)));
      f.name.setAttribute('aria-activedescendant',`beverage-option-${active}`);results.children[active].scrollIntoView({block:'nearest'});
    } else if(e.key==='Enter') {e.preventDefault();if(active>=0)choose(rows[active]);}
  });
  catalogKind.addEventListener('change',()=>{fillCategories();search();});
  category.addEventListener('change',search);brazil.addEventListener('change',search);
  f.barcode.addEventListener('input',()=>{if(selected&&selected.barcode!==f.barcode.value.trim()){selected=null;fiscal.hidden=true;refreshPhoto();}});
  f.imageUrl.addEventListener('input',refreshPhoto);
  const fiscalSearch = h('div',{class:'col-12'},h('details',{},h('summary',{},'Consultar tabelas oficiais de NCM, CEST e CFOP')));
  const kind=select(['NCM','CEST','CFOP'].map(value=>({value,label:value})));
  kind.className='form-select';
  kind.style.maxWidth='110px';
  kind.setAttribute('aria-label','Tipo de código fiscal');
  const query=h('input',{class:'form-control',placeholder:'Código ou descrição, ex.: cerveja','aria-label':'Buscar código fiscal'});
  const fiscalRows=h('div',{class:'mt-2','aria-live':'polite'});
  let fiscalVersion=0,fiscalTimer;
  const findFiscal=async()=>{
    const version=++fiscalVersion;
    try{
      const data=await get('/product-catalog/fiscal',{kind:kind.value,q:query.value});if(version!==fiscalVersion)return;
      fiscalRows.replaceChildren(...data.rows.map(row=>h('div',{class:'lf-fiscal-row'},h('button',{type:'button',class:'btn btn-sm btn-outline-primary',disabled:!editable,onclick:()=>{f[row.kind.toLowerCase()].value=row.code;toast(`${row.kind} ${row.code} preenchido.`);}},row.code),h('span',{},row.description,' · ',link(row.sourceUrl,'Fonte')))));
      if(!data.rows.length)fiscalRows.textContent=query.value.trim()?'Nenhum código encontrado.':'Digite um código ou descrição.';
    }catch{if(version===fiscalVersion)fiscalRows.textContent='Consulta indisponível no momento.';}
  };
  query.oninput=()=>{++fiscalVersion;clearTimeout(fiscalTimer);fiscalTimer=setTimeout(findFiscal,300);};kind.onchange=findFiscal;
  fiscalSearch.firstChild.append(h('div',{class:'small my-2'},'CFOP descreve a operação: 5102 para revenda interna comum, 5405 para revenda interna como contribuinte substituído do ICMS-ST e 6102 para revenda interestadual comum. Aplique conforme a operação da empresa.'),h('div',{class:'d-flex gap-2'},kind,query),fiscalRows);
  get('/product-catalog/summary').then(summary=>{
    count.textContent=`${summary.total.toLocaleString('pt-BR')} referências com foto · ${(summary.kinds?.GROCERY||0).toLocaleString('pt-BR')} alimentos · ${(summary.kinds?.BEVERAGE||0).toLocaleString('pt-BR')} bebidas · Brasil primeiro na busca`;
    catalogCategories=summary.categories;fillCategories();
    count.append(' · ',h('a',{href:summary.exportUrl},'Baixar catálogo aberto'));
  }).catch(()=>{});
  if(!editable)intro.hidden=true;
  refreshPhoto();if(selected)showFiscal(selected);
  return {intro,results,status,photo,fiscal,fiscalSearch,refreshPhoto,value:()=>selected?.barcode||''};
}
