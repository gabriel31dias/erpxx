# Catálogo de referência para o cadastro de bebidas

> Histórico da primeira entrega. A cobertura atual inclui alimentos; consulte [catalogo-mercearia.md](catalogo-mercearia.md).

Implementado: digitar no nome do produto → ver sugestões com foto e variante → selecionar → preencher nome, marca, GTIN, unidade, descrição e foto → informar custo/preço/estoque → salvar.

A consulta usa uma tabela local do ERP. Não chama serviços externos a cada tecla. O cadastro manual continua disponível. Produtos já existentes na empresa oferecem um link para abrir o cadastro; a busca não revela cadastros de outras empresas.

## Pesquisa e cobertura inicial

A pesquisa de 17/11/2026 está salva em `data/catalog/beverages.json` e no banco em `BeverageReference`. São 14.692 GTINs com URL da foto frontal correspondente, 317 marcas e 18 categorias. Há 890 referências associadas ao Brasil pela fonte ou pelo prefixo de cadastro 789, priorizadas na busca, e 13.802 referências internacionais. Prefixo GS1 não determina origem fiscal nem país de fabricação.

Inclui refrigerantes, cervejas, águas, sucos, água de coco, energéticos, isotônicos, chás/kombuchas, vinhos, espumantes, vodkas, whiskies, gins, runs/cachaças, tequilas, licores/aperitivos e outras bebidas. A lista não é uma cobertura completa de todos os produtos vendidos em bares brasileiros. Variantes internacionais são identificadas; não significam disponibilidade no Brasil.

Cada referência preserva GTIN validado, marca, nome, embalagem/volume quando informados, mercado, URL da imagem, fonte, licença e data de atualização da fonte. Não se deduz lata apenas por ter 350 ml. Dados ausentes ficam explícitos. GTINs inválidos, registros sem foto frontal do mesmo código e alimentos reconhecidos como molhos/doces/leite em pó são excluídos. Não são geradas imagens de embalagens.

As fotos vêm do Open Food Facts, podem ser fotos de celular e dependem da disponibilidade da origem. Foram conferidos por HTTP e visualmente os GTINs 7894900010015, 7894900700015, 7894900530001, 7896045506064 e 78935495; a coleção inteira não recebeu revisão visual. A prévia avisa se uma foto falhar e permite o envio de uma imagem própria.

## Dados fiscais

A tabela `FiscalCodeReference` armazena a NCM oficial vigente disponibilizada pelo Siscomex, referências CEST dos segmentos de bebidas do Convênio ICMS 142/18 e três operações comuns de CFOP. Total inicial: 10.589 referências.

A seleção comercial não altera os campos fiscais. A tela apresenta candidatos NCM por categoria e CEST quando a embalagem está identificada e permite aplicá-los explicitamente. Classificação de sucos, por exemplo, varia conforme composição e não recebe um código genérico. Cerveja sem álcool tem candidato separado de cerveja alcoólica.

CFOP 5102/5405/6102 é escolhido conforme operação/ICMS-ST, não pela marca. Origem, CSOSN/CST, alíquotas e pesos não são inferidos de código de barras ou foto. A nota do fornecedor e as regras da empresa continuam sendo a referência para confirmar a classificação do SKU.

## Fontes e licenças

- Open Food Facts: https://world.openfoodfacts.org/ e https://mirabelle.openfoodfacts.org/products
- Reutilização/licenças: https://openfoodfacts.github.io/openfoodfacts-server/api/tutorials/license-be-on-the-legal-side/
- NCM Receita Federal/Siscomex: https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json
- CEST CONFAZ: https://www.confaz.fazenda.gov.br/legislacao/convenios/2018/CV142_18
- CFOP Receita Federal: https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/facilitacao/anexo-ecf-cfop
- Os portfólios oficiais usados para pesquisar famílias de marcas constam em `data/catalog/manifest.json`.

Base derivada do Open Food Facts: ODbL 1.0; conteúdos individuais: Database Contents License; fotos: CC BY-SA 3.0. As URLs por produto permitem encontrar a imagem original e seus colaboradores. Atribuição/licença são exibidas na escolha, na prévia e no detalhe público do cardápio quando a imagem é da referência. Não há alteração do arquivo original da foto.

A base pública derivada está disponível em `/api/product-catalog/export`, com fontes/condições em `/api/product-catalog/sources`. O export não inclui preços, estoques, empresas nem cadastros privados.

## Reprodução e atualização

```sh
node tools/catalog/fetch.mjs
npx ts-node --transpile-only tools/catalog/prepare.ts
node tools/catalog/cest.mjs
npx prisma db push
npx ts-node --transpile-only tools/catalog/prepare-groceries.ts
npx ts-node --transpile-only tools/catalog/import.ts
```

`fetch.mjs` reutiliza respostas em `data/catalog/sources/`; remova somente a resposta da fonte que deseja atualizar antes de executá-lo. As fontes brutas não são versionadas, mas os JSON normalizados e o manifesto são. Confira alterações de schema antes de aplicar em produção. A importação faz upsert apenas nas duas tabelas de referência; não cria produtos, não altera preços e não modifica fotos de produtos já salvos.

Expansões seguintes: revisar embalagens ainda ausentes, obter catálogos oficiais adicionais para variantes brasileiras e melhorar a qualidade das fotos com fontes cuja licença permita reutilização. Não há atualização automática sem revisão nesta entrega.

## Validação

`npm test` inclui testes de GTIN, vínculo exato da foto, normalização, busca com acentos e volume, prioridade do Brasil, isolamento de empresas, duplicidade, referência fiscal, persistência de foto/preço e atribuição pública. O fluxo também foi verificado no Chromium em desktop e celular, com uma imagem real da origem.
