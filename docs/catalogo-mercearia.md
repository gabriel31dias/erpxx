# Alimentos de mercearia no cadastro inteligente

O mesmo cadastro que já sugere bebidas passou a aceitar alimentos. Em **Produtos → Novo produto**, digite nome, marca, peso ou código de barras. Selecione uma sugestão com foto para preencher os dados comerciais. Os filtros permitem escolher alimentos, bebidas e uma categoria específica.

## Cobertura pesquisada

A extensão foi pesquisada em 17/11/2026 no Open Food Facts/Mirabelle. Foram coletados 34.847 registros pelos prefixos de cadastro 789/790, por paginação completa em lotes de 5 mil registros, com respostas locais reutilizáveis. Só entram alimentos reconhecidos com marca, GTIN válido e URL da foto frontal ligada ao mesmo GTIN.

O catálogo combinado contém **25.234 referências com imagem**, das quais **10.625 alimentos de mercearia** e **14.609 bebidas**. São 11.432 referências associadas ao mercado brasileiro e 13.802 internacionais. Alguns registros antes genéricos de bebida foram classificados como alimentos, como cafés e leites. Um registro explicitamente identificado como item de higiene foi retirado das sugestões.

Os alimentos abrangem arroz, feijão/leguminosas, massas, farinhas, açúcar, sal/temperos, café, óleos/azeites/vinagres, biscoitos, pães, doces, laticínios, molhos, conservas, atum/sardinha, congelados, carnes, ovos, hortifruti embalado e outras categorias. Há referências de Camil, Kicaldo, Tio João, União, Pilão, 3 Corações, Dona Benta, Adria, Renata, Marilan, Bauducco, Sadia, Perdigão, Italac, Piracanjuba e outras marcas.

Esta é uma seleção de categorias e marcas, não um ranking de vendas. A fonte não fornece vendas por mercearia, região ou período, e a coleção não representa todos os SKUs comercializados. Os prefixos de cadastro não provam país de fabricação ou origem fiscal.

## Preenchimento e qualidade

- Nome, marca, código de barras, embalagem/conteúdo informado e foto são preservados.
- É possível buscar `arroz Camil 5 kg`, `arroz 5000g` ou `café Pilão 500g`.
- Um pacote fechado de arroz de 5 kg é uma unidade de venda (UN). Seu conteúdo de 5 kg não altera a venda para KG.
- Peso líquido é preenchido quando há peso explícito de uma única embalagem. Um peso já digitado pelo usuário é preservado; ao trocar uma seleção, um peso preenchido automaticamente acompanha o novo produto.
- Custo, preço e estoque pertencem à loja; não são copiados da base pública.
- NCM/CEST de alimentos não são deduzidos por marca ou nome. A consulta oficial existente continua disponível, e CFOP/tributação dependem da operação.
- Categorias declaradas de alimentos têm prioridade sobre palavras de sabor: chocolate “ao leite” não vira leite. Itens reconhecidos de higiene, limpeza, ração e suplementos não entram na seleção de alimentos.
- Registros retirados das sugestões ficam inativos na referência, preservando vínculos e créditos dos produtos que já foram cadastrados.

As fotos são comunitárias e sua qualidade varia. Foram verificadas por HTTP e inspeção visual as fotos de arroz Camil 5 kg (7896006711155), feijão Camil 1 kg (7891100794905) e café Pilão 500 g (7896089011357). A coleção inteira não recebeu revisão visual; a tela permite substituir a foto por uma própria.

## Dados e fontes

- `data/catalog/products.json`: catálogo combinado exportado publicamente em `/api/product-catalog/export`.
- `data/catalog/groceries.json`: alimentos normalizados.
- `data/catalog/beverages.json`: base original de bebidas, mantida para reprodução.
- `data/catalog/manifest.json`: cobertura atual e proveniência, disponível em `/api/product-catalog/sources`.
- `BeverageReference`: tabela global existente, agora com `kind`, `weightGrams` e `active`. Não são criados milhares de produtos no cadastro privado da loja.

Dados e fotos: https://mirabelle.openfoodfacts.org/products e https://world.openfoodfacts.org/. Licenças: base ODbL 1.0; conteúdos individuais Database Contents License; fotos CC BY-SA 3.0. São preservados links por GTIN e atribuição no cadastro/cardápio. A exportação aberta contém somente a referência pública, sem preços, estoques, empresas ou clientes.

Portfólios oficiais consultados para o escopo de marcas/categorias: https://www.camil.com.br/, https://www.nestle.com.br/marcas e https://www.bauducco.com.br/. A identidade e a foto de cada SKU vêm do registro vinculado ao seu código de barras, não de uma foto genérica da marca.

## Atualização

```sh
node tools/catalog/fetch.mjs
node tools/catalog/fetch-groceries.mjs
npx ts-node --transpile-only tools/catalog/prepare.ts
node tools/catalog/cest.mjs
npx ts-node --transpile-only tools/catalog/prepare-groceries.ts
npx prisma db push
npx ts-node --transpile-only tools/catalog/import.ts
```

Os coletores reutilizam fontes brutas em `data/catalog/sources/`. Confira o diff do schema e as contagens antes de importar. A importação faz upsert só nas tabelas de referência e inativa referências que saíram do conjunto, sem apagar seus vínculos históricos. Não altera preços, fotos, pesos ou estoques de produtos privados já cadastrados.

`npm test` cobre normalização de alimento/peso, vínculo da foto, exclusão de não alimentos, filtros, busca em kg/g, gravação do produto, isolamento entre empresas, códigos fiscais e preservação de referências inativas.
