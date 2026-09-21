# LojaFlow

ERP + PDV SaaS multiempresa para lojas varejistas: frente de caixa, estoque, caixa, financeiro,
relatórios e assinatura. Backend em **NestJS + Prisma**, painel administrativo montado sobre o
**starter kit Riho** (`../assets`) e **PDV com tela própria**.

Mesma base do AgendaFlow: multi-tenant com guarda no Prisma, sessão em cookie + header anti-CSRF,
frontend em módulos ES nativos sem bundler, e a mesma camada offline (service worker + IndexedDB).

## Rodando

```bash
npm install
npx prisma db push        # cria data/app.db a partir do schema
npm run seed              # dados de demonstração
npm run dev               # http://localhost:3001
npm run cert && npm run dev:https   # https na rede local (necessário p/ o PDV offline)
```

Produção: `npm run build && npm start`. Para trocar de banco, mude `datasource` em
`prisma/schema.prisma` para `postgresql` e ajuste `DATABASE_URL` — os models não mudam.

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

Sobe a API contra um banco descartável (`data/test.db`) e checa 44 regras: cálculo da venda,
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

- **SQLite + Prisma** em vez de subir Postgres: um arquivo, mesmo schema, troca de provider depois.
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
