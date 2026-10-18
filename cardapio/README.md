# Cardápio digital (app do cliente)

App mobile em React + Vite + Tailwind, aberto em `/<slug-da-empresa>`. Não tem backend próprio:
lê o catálogo e manda pedidos para a API pública do ERP (`../src/modules/menu.ts`, rotas `/api/public/*`).
Configuração da loja, produtos e pedidos ficam no ERP (menus **Cardápio digital** e **Pedidos do cardápio**).

## Rodar

```bash
npm install
npm run dev        # :3333, com proxy de /api e /uploads para o ERP em http://localhost:3010
```

Outra porta do ERP: `VITE_API_PROXY_TARGET=http://localhost:3001 npm run dev`.

## Fluxo

1. No ERP: ligue o cardápio em **Cardápio digital** e marque os produtos com "Mostrar no cardápio".
2. Cliente monta o carrinho e finaliza por **WhatsApp** (pedido salvo + mensagem pronta) ou
   **Pix** (QR do gateway PIX do ERP; a tela confirma sozinha).
3. Pedido aparece em **Pedidos do cardápio** no ERP; entregue, vira venda (caixa, estoque, financeiro).
   O cliente acompanha em "Pedidos" no app.

## Produção

- Passo a passo do servidor (nginx, `.env`, banco): [SERVIDOR.md](SERVIDOR.md).
- `npm run build` gera `dist/` (estático).
- `VITE_API_URL`: URL do ERP se estiver em outro domínio.
- No ERP, `MENU_URL` aponta para onde este app está publicado (link "Abrir cardápio").
