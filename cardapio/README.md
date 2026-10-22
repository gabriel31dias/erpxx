# Cardápio digital (app do cliente)

App mobile em React + Vite + Tailwind no domínio do ERP, com três entradas no mesmo build:

- **Cardápio da mesa** `/cardapio/<slug>/mesa/<n>?t=<código>`: o cliente lê o QR colado na mesa (gerado em **Mesas** no ERP),
  escolhe e o pedido cai na comanda da mesa, igual ao do garçom; a conta fecha no caixa. Sem o código do QR não pede;
  `/cardapio/<slug>/mesa` (botão "Abrir cardápio") só mostra o cardápio.
  Na tela "Mesa N" o cliente **chama o garçom** ou **pede a conta** (o sino da home também chama): o chamado aparece ao vivo
  no app do garçom (vibra e toca), em **Mesas** e no alarme do ERP, e fica aberto até alguém tocar "Atendido" ou fechar a conta.
- **Delivery** `/delivery/<slug>` (o link antigo `/cardapio/<slug>` continua abrindo o delivery): entrega/retirada, WhatsApp ou Pix.
- **Garçom** `/garcom`.
- **Motoboy** `/motoboy`.

Abaixo, "cardápio" no fluxo do cliente é o delivery. Não tem backend próprio:
lê o catálogo e manda pedidos para a API pública do ERP (`../src/modules/menu.ts`, rotas `/api/public/*`).
Configuração da loja, produtos e pedidos ficam no ERP (menus **Cardápio digital** e **Pedidos do cardápio**).

## Rodar

```bash
npm install
npm run dev        # :3333/cardapio/<slug>, com proxy de /api e /uploads para o ERP em http://localhost:3010
```

Outra porta do ERP: `VITE_API_PROXY_TARGET=http://localhost:3001 npm run dev`.

## Fluxo

1. No ERP: ligue o cardápio em **Cardápio digital** e marque os produtos com "Mostrar no cardápio".
2. Cliente monta o carrinho e finaliza por **WhatsApp** (pedido salvo + mensagem pronta) ou
   **Pix** (QR do gateway PIX do ERP; a tela confirma sozinha).
3. Pedido aparece em **Pedidos do cardápio** no ERP; entregue, vira venda (caixa, estoque, financeiro).
   O cliente acompanha em "Pedidos" no app.

## App do garçom (`/garcom`)

Mesmo projeto, outra entrada: `src/garcom/`. Entra com o usuário do ERP (perfil **Garçom**, ou caixa/gerente),
mostra as mesas ao vivo (SSE `/api/menu/events`), lança pedidos na mesa reaproveitando catálogo, detalhe e
carrinho do cardápio, e mostra a comanda. "Fechar conta" junta os pedidos da mesa numa venda só
(exige `pedido.gerenciar`), com taxa de serviço opcional (% em Cardápio digital) e conta dividida em
vários pagamentos. Na comanda: transferir/juntar mesas e cancelar pedido ou item, sempre com motivo
(garçom só cancela pedido "Novo"; depois que a cozinha aceita, só caixa/gerente).
Em produção abre em `/garcom`; em dev: `http://localhost:3333/cardapio/garcom`.

## App do motoboy (`/motoboy`)

Outra entrada do mesmo projeto: `src/motoboy/`, com as cores da loja e os componentes do delivery. Entra com o usuário
do ERP de perfil **Motoboy** (o login do ERP manda direto para cá).

1. A cozinha marca um pedido de **entrega** como pronto: ele aparece ao vivo em "Disponíveis" (SSE `/api/courier/events`)
   para todos os motoboys. Quem tocar primeiro em **Aceitar** leva; o pedido vai para "Saiu para entrega".
2. "Minhas entregas" mostra o mapa com a loja, onde o motoboy está e as paradas na melhor ordem pelas ruas
   (OSRM `trip`), com Ligar, GPS (Google Maps/Waze) e **Entregue**, onde ele informa como o cliente pagou.
3. Com o app aberto, a posição vai para o ERP a cada ~10 s. A tela não apaga enquanto houver entrega (Wake Lock);
   com a tela apagada ou em outro app, o navegador para de mandar a posição.
4. No ERP, **Entregas** mostra os motoboys no mapa ao vivo, o trajeto do dia e os prontos sem motoboy. O **acerto**
   lança cada entrega como venda no caixa de quem acerta, na forma que o motoboy informou.

O ponto da entrega vem do checkout do delivery: o CEP preenche o endereço e o cliente pode tocar em "usar minha
localização". Sem isso, o servidor procura o endereço no Nominatim; o que não achar, o caixa marca no mapa em Entregas.

Mapas: os servidores públicos do OSRM (rota) e do OpenStreetMap (mapa) servem para começar. Com mais uso, aponte
`ROUTING_URL` (no `.env` do ERP) para um OSRM próprio e `VITE_TILE_URL` (no build do app) para um provedor com chave.

## Produção

- Passo a passo do servidor (nginx, `.env`, banco): [SERVIDOR.md](SERVIDOR.md).
- `npm run build` gera `dist/` com base `/cardapio/`; o próprio ERP serve esse `dist` em `/cardapio` e `/garcom`.
- `VITE_BASE` troca o prefixo; `VITE_API_URL` só se a API estiver em outro domínio (o garçom não funciona assim).
- No ERP, `MENU_URL=https://<domínio-do-erp>/cardapio` (link "Abrir cardápio").
