# Cardápio digital no servidor

O app (`cardapio/`) é publicado **no mesmo domínio do ERP**, servido pelo próprio Node do ERP
(`src/app.module.ts`, a partir de `cardapio/dist`). Não precisa de domínio, certificado nem bloco
de nginx próprios.

```
erp.minhaloja.com.br (nginx -> ERP Node)
  ├─ /cardapio/<slug>   cardápio do cliente   ─┐
  ├─ /garcom            app do garçom          ├─ cardapio/dist (build com base /cardapio/)
  ├─ /cardapio/assets/  js, css e imagens     ─┘
  ├─ /api/...           API (pública e com sessão)
  ├─ /uploads/menu/     fotos do cardápio
  └─ o resto            telas do ERP
```

O prefixo `/cardapio/` existe porque o ERP já usa `/assets`. Por ser o mesmo domínio, não há
CORS nem `VITE_API_URL`, e o cookie de sessão (`SameSite=strict`) funciona no app do garçom.

## 1. ERP: variáveis

No `.env` do ERP:

```bash
# link "Abrir cardápio" no ERP (<MENU_URL>/<slug-da-empresa>)
MENU_URL="https://erp.minhaloja.com.br/cardapio"
# fotos do cardápio: fora da pasta do código, para sobreviver a deploy (opcional)
MENU_IMAGES_DIR="/var/lib/lojaflow/menu-images"
```

## 2. Publicar / atualizar

```bash
cd /caminho/do/erpxx && git pull
pg_dump "$DATABASE_URL" > antes-deploy.sql   # backup
npm ci && npm run db:push && npm run build

cd cardapio && npm ci && npm run build && cd ..   # gera cardapio/dist
pm2 restart lojaflow
```

O ERP só passa a servir `/cardapio` e `/garcom` se `cardapio/dist/index.html` existir na hora em que
sobe. Na primeira vez, faça o build do app **antes** do `pm2 restart`. Depois disso, rebuilds do app
não precisam de restart.

> `db:push` só adiciona tabelas e colunas, com valores padrão. Se ele pedir `--accept-data-loss`,
> pare e veja o que ele quer apagar.

## 3. nginx

O `location /` do ERP já atende tudo. Para o tempo real (`/api/menu/events`, SSE: tela de pedidos e
comanda do garçom), o ERP manda `X-Accel-Buffering: no` e um ping a cada 25 s. Se o
`proxy_read_timeout` for menor que 30 s, aumente. Fica melhor ainda com um bloco próprio:

```nginx
location /api/menu/events {
    proxy_pass http://127.0.0.1:3000;   # PORT do .env
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_read_timeout 1h;
}
```

- O `X-Forwarded-For` é necessário. O ERP limita a 20 pedidos por minuto **por cliente**, e sem
  esse cabeçalho todos os clientes contam como um só (o IP do nginx).
- Envio de foto vai até 3 MB: `client_max_body_size` precisa ser pelo menos `4m`.

> O aviso em tempo real roda em memória: vale para **um** processo Node (é o que o
> `ecosystem.config.js` sobe). Se um dia rodar em cluster, o canal precisa ir para Redis ou para
> o LISTEN/NOTIFY do Postgres.

## 4. Ligar na loja

No ERP, logado como dono:

1. **Cadastros → Cardápio digital**: ligue "Cardápio publicado", defina a taxa de entrega, o horário,
   o logo e o banner. Para usar Pix, configure antes o gateway PIX em Configurações.
2. **Produtos**: em cada produto, "Cardápio digital" → "Mostrar no cardápio".
3. Confira se o **WhatsApp** da empresa está no cadastro (o pedido por WhatsApp usa esse número).
4. Abra `https://erp.minhaloja.com.br/cardapio/<slug>` (botão "Abrir cardápio").
5. Mesas: em **Cardápio digital** informe quantas mesas tem o salão; em **Usuários** crie os garçons
   com o perfil **Garçom**. Eles entram em `https://erp.minhaloja.com.br/garcom` com o usuário do
   ERP, lançam pedidos e veem a comanda. Fechar a conta é do caixa/gerente (no mesmo app, botão
   "Fechar conta").

Pedido entregue vira venda no **caixa aberto**. Sem caixa aberto a entrega é recusada.

## Conferência rápida

```bash
curl -s https://erp.minhaloja.com.br/api/public/stores/<slug> | head -c 200     # JSON da loja
curl -s https://erp.minhaloja.com.br/cardapio/<slug> | grep -o '<title>[^<]*'    # Cardápio Digital
curl -s https://erp.minhaloja.com.br/garcom/ | grep -o '<title>[^<]*'           # Cardápio Digital
```

| Sintoma | Causa provável |
|---|---|
| `/cardapio/<slug>` abre a tela do ERP | `cardapio/dist` não existia quando o ERP subiu: build do app e `pm2 restart` |
| "Cardápio não encontrado" / loja não abre | cardápio desligado, empresa inativa ou slug errado |
| Fotos quebradas | `MENU_IMAGES_DIR` diferente de onde as fotos foram salvas |
| Link "Abrir cardápio" não aparece | `MENU_URL` vazio no `.env` do ERP (reinicie o pm2 depois de mudar) |
| Pedidos não chegam sozinhos ("Reconectando…") | buffering/timeout no nginx (ver seção 3) |
| Garçom não consegue entrar | sem HTTPS (o cookie de sessão é `secure` em produção) |
| "Abra o caixa antes de vender." ao entregar | não há caixa aberto na filial |

## Desenvolvimento

`cd cardapio && npm run dev` abre em `http://localhost:3333/cardapio/<slug>` (e `/cardapio/garcom`),
com proxy de `/api` e `/uploads` para `VITE_API_PROXY_TARGET` (padrão `http://localhost:3010`).
