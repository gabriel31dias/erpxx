# LojaFlow

ERP + PDV SaaS multiempresa para lojas varejistas: frente de caixa, estoque, caixa, financeiro,
relatórios e assinatura. Backend em **NestJS + Prisma**, painel administrativo montado sobre o
**starter kit Riho** (`../assets`) e **PDV com tela própria**.

Mesma base do AgendaFlow: multi-tenant com guarda no Prisma, sessão em cookie + header anti-CSRF,
frontend em módulos ES nativos sem bundler, e a mesma camada offline (service worker + IndexedDB).

## Rodando

```bash
npm install
npx prisma db push        # cria as tabelas no Postgres do DATABASE_URL
npm run seed              # dados de demonstração
npm run dev               # http://localhost:3001
npm run cert && npm run dev:https   # https na rede local (necessário p/ o PDV offline)
```

Cardápio digital (app do cliente, em `cardapio/`): `cd cardapio && npm install && npm run dev` → http://localhost:3333/cardapio/<slug>. Em produção o ERP serve o build em `/cardapio/<slug>` e `/garcom` (ver `cardapio/SERVIDOR.md`).

Produção: `npm run build && npm start`. Banco: PostgreSQL (`DATABASE_URL` no `.env`).

### Importação de clientes e fornecedores

Nas telas **Clientes** e **Fornecedores**, clique em **Importar**. O fluxo aceita Excel
(`.xlsx`, primeira aba), XML e CSV, com até 3 MB e 1.000 registros por arquivo. O próprio
diálogo oferece modelos de exemplo nos três formatos. No Excel, mantenha CPF/CNPJ e CEP
como texto para preservar zeros à esquerda.

Revise o mapeamento das colunas e a prévia antes de confirmar. O nome é obrigatório;
o mesmo CPF/CNPJ atualiza um cadastro da empresa, e registros sem documento criam novos
cadastros. Campos vazios preservam os valores existentes. Linhas inválidas são informadas
e ignoradas. A operação exige permissão para gerenciar o cadastro e um plano com importação.
Ao enviar apenas um novo endereço em texto livre, ele substitui o endereço anterior,
incluindo os campos estruturados de rua, CEP e cidade.

### Boot Whats

Em **Administração → Boot Whats**, clique em **Conectar WhatsApp**. No celular, abra
**WhatsApp → Aparelhos conectados → Conectar um aparelho** e leia o QR Code da tela.
Depois ative as mensagens automáticas, escolha os avisos e salve os textos.

- **Compra concluída:** venda com cliente cadastrado e WhatsApp/telefone preenchido;
  pagamentos de maquininha aguardam a aprovação.
- **Pedido recebido:** novo pedido de delivery; no PIX, após confirmar o pagamento.
- **Pedido despachado:** mudança para `delivering`, tanto no ERP quanto no aceite do motoboy.

Os textos aceitam `{cliente}`, `{loja}`, `{numero}`, `{total}`, `{endereco}` e `{itens}`.
O bot começa desligado. Conectar a conta não ativa os envios. Mesa e retirada não recebem
os avisos de delivery. Eventos repetidos usam a mesma entrada na fila; a fila aguarda conexão,
repete falhas temporárias até cinco vezes e mostra o resultado em **Últimos envios**.
Pedidos cancelados antes do envio são descartados. Desativar o bot pausa a fila.

A integração usa [Baileys](https://github.com/WhiskeySockets/Baileys), uma biblioteca
de WhatsApp Web não oficial. A sessão é persistida no PostgreSQL, separada por empresa
e cifrada com `WHATSAPP_SESSION_KEY` (ou `JWT_SECRET` quando não configurada). Mantenha essa
chave estável para reconectar após reiniciar o servidor. **Desconectar** encerra a sessão
e remove as credenciais locais. A tela e as ações exigem `empresa.gerenciar`.

Após atualizar, execute `npm install`, `npx prisma db push`, `npm run build` e `npm run pages`,
e reinicie a aplicação. Requer Node.js 20 ou superior. Execute o ERP em um único processo
(o mesmo requisito dos eventos de pedidos); múltiplas réplicas precisam de coordenação
da sessão de WhatsApp. A suíte usa um transporte simulado e não envia mensagens reais.

### Aprovação de contas

Loja cadastrada pelo `/cadastro.html` nasce **pendente**: não entra até um aprovador da
plataforma liberar. Aprovador não pertence a nenhuma empresa; entra pelo mesmo `/login.html`
e cai em `/aprovacoes.html` (pendentes, aprovadas, recusadas). O teste grátis conta a partir
da aprovação.

```bash
npm run aprovador -- voce@dominio.com "Seu Nome"   # cria (ou redefine a senha) e mostra a senha gerada
APROVADOR_SENHA='...' npm run aprovador -- voce@dominio.com   # senha escolhida
npm run aprovador -- voce@dominio.com --desativar  # bloqueia na hora
```

### Acessos de demonstração (senha `senha1234`)

| E-mail | Perfil | O que enxerga |
|---|---|---|
| proprietaria@bompreco.com.br | Proprietário | tudo, inclusive plano e assinatura |
| gerente@bompreco.com.br | Gerente | operação completa, sem usuários/plano |
| caixa@bompreco.com.br | Caixa | PDV, vendas do dia e o próprio caixa |
| estoque@bompreco.com.br | Estoquista | produtos, estoque, entradas e fornecedores |
| financeiro@bompreco.com.br | Financeiro | contas, fluxo de caixa e relatórios |

## Verificação

```bash
npm test
```

Sobe a API contra um banco descartável (`TEST_DATABASE_URL`, zerado a cada execução) e checa 44 regras: cálculo da venda,
pagamento dividido, troco, snapshot de preço/custo, baixa e devolução de estoque, estoque
insuficiente, **duas vendas simultâneas do último item** (uma passa, a outra recebe 409),
idempotência, cancelamento com estorno, abertura/sangria/suprimento/fechamento de caixa,
isolamento entre empresas, permissões por perfil, limites de plano, CSRF e financeiro.

## O PDV

Tela própria (`/pdv.html`), sem menu lateral, desenhada para teclado e leitor de código de barras:

- **sem caixa aberto o PDV não opera**: entra um passo obrigatório (sem X, sem ESC, sem clique
  fora) pedindo o PDV e o fundo de troco; leitura e atalhos ficam inertes até a abertura. A única
  saída alternativa é *Sair do PDV*;
- o foco vive no campo de leitura e **volta para ele** depois de qualquer ação;
- o leitor se comporta como teclado — a linha termina em Enter e o item entra no cupom;
- item não é linha de planilha: é **linha de cupom** (nome grande, `2 UN × R$ 27,90` em mono,
  total à direita), o que elimina rolagem lateral em 1366×768;
- todo número usa fonte monoespaçada com `tabular-nums`: preço, quantidade e código alinham;
- o **total** fica num display escuro que pisca ao mudar — é o que o operador confere de longe;
- atalhos: `F2` buscar · `F4` cliente · `F6` desconto · `F8` suspender · `F9` recuperar ·
  `F10` finalizar · `DEL` remover item · `ESC` limpar venda. No pagamento, `1..9` escolhem a forma.

O pagamento tem **um campo e um botão**. O campo é o valor recebido naquela forma — em dinheiro,
o que passar do total vira troco na hora. O botão muda de papel: cobre o que falta, diz
*Confirmar venda*; é menor, vira *Avançar* — lança aquela parte e pede a forma do valor restante.
Uma linha no topo diz sempre qual é o passo (`R$ 33,39 em Dinheiro · troco de R$ 16,61` →
`Selecione a forma para os R$ 16,69 restantes` → `Tudo pago. Troco de R$ 12,10`).
Cada pagamento já lançado tem **editar** e **desfazer**: editar troca o valor no lugar, recalcula o
que falta (ou o troco) e reabre a confirmação.

Fechada a venda, aparece o resumo — número, total e **troco em destaque** — com *Imprimir
comprovante* e *Nova venda*. O foco já está em Nova venda, então `F10` (ou Enter) segue para o
próximo cliente e devolve o cursor ao leitor. Sem conexão, o mesmo resumo avisa que a venda ficou
guardada no aparelho e sobe sozinha.

Produto por peso (`saleType = WEIGHT`) pede a quantidade decimal e calcula `0,742 kg × R$ 39,90`.
A integração com balança entra atrás dessa mesma porta (o domínio de vendas não conhece fabricante).

Venda suspensa fica no aparelho (`localStorage`) — nada foi baixado do estoque ainda, então não
precisa ir ao servidor.

## Funciona offline

O app é um PWA: instala na tela inicial e abre sem servidor por perto.

> **Precisa de HTTPS.** O navegador só guarda o app em origem segura (`https://` ou `localhost`).
> Para a rede local: `npm run cert && npm run dev:https`, instale `certs/rootCA.crt` no aparelho e
> acesse `https://SEU_IP:3001`.

- **Telas e assets** ficam no aparelho via service worker (`public/sw.js`); a lista é gerada por
  `npm run pages` em `public/precache.js`, versionada por hash.
- **Leitura**: cada GET guarda a última resposta no IndexedDB. Sem servidor, a tela abre com esses
  dados e um aviso diz de que horas eles são.
- **Escrita**: venda do PDV, cliente, movimentação/ajuste de estoque, sangria e suprimento entram
  numa fila local e sobem sozinhas quando a conexão volta. O resto exige servidor e avisa isso.
- **Sem venda duplicada**: cada venda leva uma `idempotencyKey` gerada no aparelho; o servidor
  guarda a resposta por chave, então reenviar devolve a mesma venda.
- **Conflito**: o servidor continua sendo a autoridade. Se o estoque acabou enquanto você estava
  offline, o item aparece em **Sincronização** como *Recusada* com o motivo — nada é sobrescrito.
  A tela não descarta operação: ou ela sobe, ou fica registrada com o motivo até alguém resolver
  (repor o estoque e mandar de novo). Venda de caixa não se joga fora pela interface.

## Arquitetura

```
prisma/schema.prisma   26 modelos; toda tabela de empresa tem companyId + índice
src/common/            prisma (guarda de tenant), auth.guard (JWT em cookie + RBAC),
                       rbac (matriz de permissões), core (auditoria, notificações, planos,
                       configurações, idempotência, filial, relógio da empresa),
                       util (datas/dinheiro pt-BR), error.filter
src/modules/           auth, catalog (produtos/categorias), crm (clientes/fornecedores),
                       stock (posição, movimentações, entradas), sales (PDV), cash,
                       finance, reports, company (filiais/pagamentos/config), users,
                       billing (planos), imports (CSV), misc (busca, notificações, auditoria)
public/pdv.html+js/pdv.js   frente de caixa (layout e CSS próprios: public/pdv.css)
public/                painel: páginas HTML com a marcação do tema + js/pages/*
                       estoque.html reúne posição, movimentações e entradas em abas
public/js/offline.js   cache de leitura + fila de alterações (IndexedDB)
test/rules.spec.ts     verificação das regras de negócio
```

### Multi-tenant

Sessão é um JWT em cookie `httpOnly; SameSite=strict` com `companyId` e, opcionalmente, `branchId`
(usuário preso a uma loja). Todo service filtra por `companyId`, e o Prisma é estendido com uma
checagem que **derruba** qualquer `findMany`, `updateMany`, `count`, `groupBy` etc. em modelo de
empresa sem `companyId` no `where` — vazamento vira erro 500 em vez de dado alheio na tela.

### Perfis

| | Proprietário | Administrador | Gerente | Caixa | Estoquista | Financeiro |
|---|---|---|---|---|---|---|
| PDV e vendas | ✓ | ✓ | ✓ | ✓ | — | leitura |
| Cancelar venda / desconto acima do limite | ✓ | ✓ | ✓ | — | — | — |
| Produtos e estoque | ✓ | ✓ | ✓ | leitura | ✓ | leitura |
| Caixa (abrir/fechar) | ✓ | ✓ | ✓ | ✓ | — | leitura |
| Sangria e suprimento | ✓ | ✓ | ✓ | — | — | — |
| Financeiro | ✓ | ✓ | ✓ | — | — | ✓ |
| Relatórios | ✓ | ✓ | ✓ | — | ✓ | ✓ |
| Equipe / empresa | ✓ | ✓ | — | — | — | — |
| Plano e assinatura | ✓ | — | — | — | — | — |

### Integridade da venda

`total = Σ(preço × quantidade) − descontos`, tudo em centavos (inteiro). A finalização é uma
transação única: valida → grava venda e itens → grava pagamentos → baixa estoque → registra o
caixa → lança a receita. Qualquer falha desfaz tudo.

- **Preço e custo viram snapshot** no `SaleItem`: mudar o cadastro hoje não altera a venda de ontem.
- **Estoque** só muda por movimentação (`StockMovement` com saldo anterior e posterior). A baixa usa
  `updateMany` condicionado ao saldo lido — dois caixas vendendo a última unidade: um grava, o outro
  recebe 409.
- **Cancelamento** nunca apaga: muda o status, devolve o estoque com movimentação `CANCELAMENTO`,
  estorna no caixa aberto, cancela o lançamento financeiro e registra auditoria.
- **Venda ≠ caixa ≠ financeiro**: são três tabelas e três responsabilidades.

### Planos e assinatura

Os planos vêm do `.env` (nome, preço, limites, features) e são sincronizados no seed. Nenhum módulo
consulta plano na mão: `PlanService` responde `hasFeature`, `assertLimit` e `assertActive` (trial
vencido ou assinatura suspensa bloqueiam escrita). A cobrança em si ainda não está plugada.

## Decisões que economizaram código

- **PostgreSQL + Prisma**: o schema nasceu no SQLite (por isso os "enums" são String) e migrou sem mudar os models.
- **Contas a pagar/receber, despesas e receitas numa tabela só** (`FinanceEntry` com `type` +
  `status`): três tabelas quase idênticas só multiplicariam relatório e migração.
- **Papéis fixos em código** no lugar de `Role`/`Permission`/`UserRole`: funções personalizadas
  entram depois virando tabela com a mesma lista de strings.
- **Unidade e marca como campo do produto**, não tabelas: nada além do nome é usado hoje.
- **Datas como texto `YYYY-MM-DD HH:mm`** no fuso da empresa: ordenam no SQL e dispensam lib de datas.
- **Frontend em módulos ES nativos** sobre o tema — sem bundler, sem build de frontend.
- **IndexedDB na mão** (~70 linhas) no lugar de Dexie/Workbox.
- **Venda suspensa no aparelho**: nada foi baixado do estoque, então não precisa de tabela.
- **Comprovante pelo `window.print()`** com CSS de bobina, em vez de lib de PDF.

## Limites conhecidos

- Recuperação de senha e convites não enviam e-mail: o link aparece na tela (convite) ou no log.
- Troca de plano não cobra: falta o checkout em `billing.ts` (é onde o gateway entra).
- Upload de logo e imagem de produto é por URL, sem armazenamento de arquivos.
- Emissão fiscal (NFC-e/SAT) não faz parte do MVP — o comprovante é interno e a venda já está
  isolada o suficiente para receber um emissor depois sem reescrever o módulo.
- Jobs assíncronos (relatório pesado, alerta agendado, recorrência financeira) ainda rodam na
  requisição; a fila entra quando doer.
- Relatórios agregam em memória sobre um recorte já filtrado por período — vira `GROUP BY` se o
  volume crescer.

### Catálogo de alimentos e bebidas com fotos

Em **Produtos → Novo produto**, digite nome, marca, peso, embalagem, volume ou código de barras. Escolha uma sugestão com foto para preencher o cadastro. O catálogo combinado tem 25.234 referências com imagem: 10.625 alimentos de mercearia e 14.609 bebidas. Use os filtros de tipo/categoria; referências do mercado brasileiro aparecem primeiro. Custo, preço e estoque são informados pela loja.

Pesquisa, cobertura, licenças e atualização: [docs/catalogo-mercearia.md](docs/catalogo-mercearia.md). Histórico da primeira pesquisa: [docs/catalogo-bebidas.md](docs/catalogo-bebidas.md). Dados em `data/catalog/products.json` e `groceries.json`; importação com `npx ts-node --transpile-only tools/catalog/import.ts` após aplicar o schema. A referência pública pode ser baixada em `/api/product-catalog/export`.
