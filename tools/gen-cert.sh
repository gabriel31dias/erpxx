#!/usr/bin/env bash
# Gera uma autoridade local (rootCA) e um certificado para o IP desta máquina.
# É o que permite servir https:// na rede local — sem HTTPS o celular não guarda
# o app no aparelho e o modo offline não existe.
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)/certs"
mkdir -p "$DIR"
cd "$DIR"

IP="${1:-$(ip route get 1.1.1.1 2>/dev/null | grep -oP 'src \K\S+' || hostname -I | awk '{print $1}')}"
echo "Gerando certificado para: $IP"

if [ ! -f rootCA.key ]; then
  openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
    -keyout rootCA.key -out rootCA.crt \
    -subj "/CN=AgendaFlow CA local" >/dev/null 2>&1
  echo "✔ autoridade local criada (rootCA.crt)"
fi

cat > server.cnf <<EOF
[req]
distinguished_name = dn
[dn]
[ext]
subjectAltName = IP:$IP, DNS:localhost, IP:127.0.0.1
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
EOF

openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr \
  -subj "/CN=$IP" >/dev/null 2>&1
openssl x509 -req -in server.csr -CA rootCA.crt -CAkey rootCA.key -CAcreateserial \
  -out server.crt -days 825 -sha256 -extfile server.cnf -extensions ext >/dev/null 2>&1
rm -f server.csr server.cnf

cat <<FIM

✔ Certificado pronto em $DIR

1) Suba o servidor em HTTPS:
     SSL_KEY=certs/server.key SSL_CERT=certs/server.crt npm run dev

2) No celular, instale a autoridade local UMA vez:
   - envie o arquivo certs/rootCA.crt para o aparelho (WhatsApp, e-mail, pendrive);
   - Android: Ajustes > Segurança > Criptografia e credenciais > Instalar certificado > Certificado CA;
   - iPhone: abra o arquivo, Ajustes > Perfil baixado > Instalar; depois
     Ajustes > Geral > Sobre > Confiança em certificados > ligue "AgendaFlow CA local".

3) Acesse https://$IP:3000 — sem aviso de site inseguro, e o app passa a
   funcionar offline no aparelho.

FIM
