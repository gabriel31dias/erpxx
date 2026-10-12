// Cria (ou redefine a senha de) um aprovador da plataforma — quem libera as contas novas.
//   npm run aprovador -- email@dominio.com "Nome"
// Senha: APROVADOR_SENHA no ambiente; sem ela, gera uma e mostra uma vez.
// Para bloquear: npm run aprovador -- email@dominio.com --desativar
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { randomBytes } = require('crypto');

(async () => {
  const [email, arg] = process.argv.slice(2);
  if (!email || !email.includes('@')) {
    console.error('Uso: npm run aprovador -- email@dominio.com "Nome"   (ou --desativar)');
    process.exit(1);
  }
  const db = new PrismaClient();
  const key = email.toLowerCase().trim();

  if (arg === '--desativar') {
    const { count } = await db.approver.updateMany({ where: { email: key }, data: { active: false } });
    console.log(count ? `Aprovador ${key} desativado.` : `Nenhum aprovador com ${key}.`);
    return db.$disconnect();
  }

  const password = process.env.APROVADOR_SENHA || randomBytes(9).toString('base64url');
  if (password.length < 8) throw new Error('A senha precisa de ao menos 8 caracteres.');
  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await db.approver.findUnique({ where: { email: key } });
  await db.approver.upsert({
    where: { email: key },
    create: { email: key, name: arg || key.split('@')[0], passwordHash },
    update: { passwordHash, active: true, ...(arg ? { name: arg } : {}) },
  });
  console.log(`${existing ? 'Senha redefinida' : 'Aprovador criado'}: ${key}`);
  if (!process.env.APROVADOR_SENHA) console.log(`Senha: ${password}  (guarde agora; não aparece de novo)`);
  console.log('Entre por /login.html — cai direto em /aprovacoes.html.');
  await db.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
