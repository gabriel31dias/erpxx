# Cardápio digital no servidor

Como publicar o app do cliente (`cardapio/`) junto do ERP já em produção.
Exemplo: ERP em `erp.minhaloja.com.br`, cardápio em `cardapio.minhaloja.com.br`.

```
cliente ──> cardapio.minhaloja.com.br (nginx)
              ├─ /               arquivos estáticos de cardapio/dist
              ├─ /api/public/    proxy ─┐
              └─ /uploads/menu/  proxy ─┴─> ERP (Node, 127.0.0.1:PORT)
```

O app não tem backend próprio. Ele só fala com `/api/public/*` do ERP. Como o nginx repassa no
mesmo domínio, não precisa de CORS nem de `VITE_API_URL`.

## 1. ERP: banco e variáveis

No `.env` do ERP:

```bash
# link "Abrir cardápio" no ERP (<MENU_URL>/<slug-da-empresa>)
MENU_URL="https://cardapio.minhaloja.com.br"
# fotos do cardápio: fora da pasta do código, para sobreviver a deploy
MENU_IMAGES_DIR="/var/lib/lojaflow/menu-images"
```

```bash
sudo mkdir -p /var/lib/lojaflow/menu-images
sudo chown <usuario-do-pm2> /var/lib/lojaflow/menu-images

cd /caminho/do/erpxx
npm ci
npm run db:push          # cria MenuOrder e os campos novos de produto/categoria/empresa
npm run build
pm2 restart lojaflow     # ou: pm2 start ecosystem.config.js && pm2 save
```

> `db:push` só adiciona tabelas e colunas, com valores padrão. Mesmo assim, faça backup antes:
> `pg_dump "$DATABASE_URL" > antes-cardapio.sql`.

## 2. Build do app

```bash
cd /caminho/do/erpxx/cardapio
npm ci
npm run build            # gera dist/
```

Sem variável nenhuma. Se o cardápio ficar em outro domínio **sem** proxy, use
`VITE_API_URL=https://erp.minhaloja.com.br npm run build`. Mas aí o ERP precisa liberar CORS
em `/api/public` (hoje não libera), então prefira o proxy.

## 3. nginx

`/etc/nginx/sites-available/cardapio`:

```nginx
server {
    listen 80;
    server_name cardapio.minhaloja.com.br;

    root /caminho/do/erpxx/cardapio/dist;
    index index.html;

    # só a API pública: login e telas do ERP não ficam expostas neste domínio
    location /api/public/ {
        proxy_pass http://127.0.0.1:3000;   # PORT do .env do ERP
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # app do garçom (/garcom): login, catálogo, mesas e o tempo real com a sessão do ERP.
    # O cookie é SameSite=strict: o app precisa falar com a API pelo próprio domínio (este proxy).
    location ~ ^/api/(auth|menu|company/payment-methods)(/|$) {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;          # /api/menu/events é SSE
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_read_timeout 1h;
    }

    location /uploads/menu/ {
        proxy_pass http://127.0.0.1:3000;
        expires 7d;
    }

    # arquivos com hash do Vite: cache longo
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # rotas do React (/<slug>, /<slug>/pedidos...) caem no index.html
    location / {
        try_files $uri /index.html;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/cardapio /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d cardapio.minhaloja.com.br     # HTTPS
```

- O `X-Forwarded-For` é necessário. O ERP limita a 20 pedidos por minuto **por cliente**, e sem
  esse cabeçalho todos os clientes contam como um só (o IP do nginx).
- Envio de foto (até 3 MB) passa pelo domínio do ERP. Se o nginx do ERP tiver
  `client_max_body_size` menor que 4m, aumente.

### Tela "Pedidos do cardápio" (tempo real)

A tela do ERP recebe os pedidos por uma conexão aberta (`/api/menu/events`, SSE). O ERP já manda
`X-Accel-Buffering: no` e um ping a cada 25 s, então o `location /` padrão do nginx do ERP serve.
Se tiver `proxy_read_timeout` menor que 30s, aumente. Com HTTP/1.1 para o upstream é melhor ainda:

```nginx
location /api/menu/events {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_read_timeout 1h;
}
```

> O aviso em tempo real roda em memória: vale para **um** processo Node (é o que o
> `ecosystem.config.js` sobe). Se um dia rodar em cluster, o canal precisa ir para Redis ou para
> o LISTEN/NOTIFY do Postgres.

### App do garçom

Abre em `https://cardapio.minhaloja.com.br/garcom` (mesmo build, sem deploy separado). Entra com o
usuário do ERP. Em produção o cookie de sessão é `secure`: precisa de HTTPS. Não funciona com
`VITE_API_URL` apontando para outro domínio (o cookie `SameSite=strict` não vai entre sites).

## 4. Ligar na loja

No ERP, logado como dono:

1. **Cadastros → Cardápio digital**: ligue "Cardápio publicado", defina a taxa de entrega, o horário,
   o logo e o banner. Para usar Pix, configure antes o gateway PIX em Configurações.
2. **Produtos**: em cada produto, "Cardápio digital" → "Mostrar no cardápio".
3. Confira se o **WhatsApp** da empresa está no cadastro (o pedido por WhatsApp usa esse número).
4. Abra `https://cardapio.minhaloja.com.br/<slug>` (botão "Abrir cardápio").
5. Mesas: em **Cardápio digital** informe quantas mesas tem o salão; em **Usuários** crie os garçons
   com o perfil **Garçom**. Eles lançam pedidos e veem a comanda; fechar a conta é do caixa/gerente
   (no mesmo app, botão "Fechar conta").

Pedido entregue vira venda no **caixa aberto**. Sem caixa aberto a entrega é recusada.

## 5. Atualizar depois

```bash
cd /caminho/do/erpxx && git pull
npm ci && npm run db:push && npm run build && pm2 restart lojaflow
cd cardapio && npm ci && npm run build      # nginx já serve o dist novo, sem reload
```

## Conferência rápida

```bash
curl -s https://cardapio.minhaloja.com.br/api/public/stores/<slug> | head -c 200   # JSON da loja
curl -sI https://cardapio.minhaloja.com.br/<slug> | head -1                          # 200
```

| Sintoma | Causa provável |
|---|---|
| "Cardápio não encontrado" / loja não abre | cardápio desligado, empresa inativa ou slug errado |
| 404 ao recarregar `/<slug>` | falta o `try_files ... /index.html` |
| Fotos quebradas | `/uploads/menu/` sem proxy, ou `MENU_IMAGES_DIR` diferente de onde as fotos foram salvas |
| Link "Abrir cardápio" não aparece | `MENU_URL` vazio no `.env` do ERP (reinicie o pm2 depois de mudar) |
| Pedidos não chegam sozinhos ("Reconectando…") | buffering/timeout no nginx do ERP (ver seção SSE) |
| "Abra o caixa antes de vender." ao entregar | não há caixa aberto na filial |
