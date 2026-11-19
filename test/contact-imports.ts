import * as assert from 'assert';
import { Workbook } from 'exceljs';
import { readContacts } from '../src/modules/contact-imports';

/** Executado pela suíte principal, sempre no banco descartável. */
export async function checkContactImports({ check, api, caixa, outra, garcom, db, base }: any) {
  console.log('\nImportação de clientes e fornecedores');
  const company = await db.company.findFirstOrThrow({ where: { users: { some: { email: 'ana@teste.com' } } } });
  const otherCompany = await db.company.findFirstOrThrow({ where: { users: { some: { email: 'beto@teste.com' } } } });
  const csv = (content: string, mapping?: Record<string, string>) => ({ format: 'csv', content, ...(mapping ? { mapping } : {}) });

  await check('modelos Excel, XML e CSV de ambos os cadastros podem ser baixados e relidos', async () => {
    for (const kind of ['customers', 'suppliers'] as const) {
      for (const format of ['xlsx', 'xml', 'csv'] as const) {
        const res = await fetch(`${base}/api/imports/${kind}/example?format=${format}`, { headers: { cookie: api.cookie() } });
        assert.equal(res.status, 200);
        assert.match(res.headers.get('content-disposition')!, new RegExp(`\\.${format}"$`));
        const buffer = Buffer.from(await res.arrayBuffer());
        const content = buffer.toString(format === 'xlsx' ? 'base64' : 'utf8');
        const preview = await api('POST', `/api/imports/${kind}/preview`, { format, content });
        assert.equal(preview.status, 201, JSON.stringify(preview.data));
        assert.equal(preview.data.rows.length, 1);
        assert.deepEqual(preview.data.errors, []);
        assert.equal(preview.data.rows[0].data.document, '01234567890');
        assert.equal(preview.data.rows[0].data.active, true);
      }
    }
  });

  await check('prévia não grava; CSV aceita aspas, ponto e vírgula e observações em várias linhas', async () => {
    const before = await db.customer.count({ where: { companyId: company.id } });
    const result = await api('POST', '/api/imports/customers/preview', csv('Nome;CPF/CNPJ;Observações\n"Ana; Importação";01234567891;"Linha 1\nLinha ""2"""'));
    assert.equal(result.status, 201, JSON.stringify(result.data));
    assert.equal(result.data.rows[0].data.name, 'Ana; Importação');
    assert.equal(result.data.rows[0].data.notes, 'Linha 1\nLinha "2"');
    assert.equal(await db.customer.count({ where: { companyId: company.id } }), before);
  });

  await check('erros apontam as linhas originais mesmo com linhas vazias e campos multilinha', async () => {
    const result = await api('POST', '/api/imports/customers/preview', csv('\nNome;Observações\n\nCliente;"Linha 1\nLinha 2"\nA;Inválido'));
    assert.equal(result.data.rows[0].line, 4);
    assert.equal(result.data.errors[0].line, 6);
    const book = new Workbook();
    const sheet = book.addWorksheet('Clientes');
    sheet.getCell('A2').value = 'Nome';
    sheet.getCell('A5').value = 'A';
    const excel = await api('POST', '/api/imports/customers/preview', { format: 'xlsx', content: Buffer.from(await book.xlsx.writeBuffer()).toString('base64') });
    assert.equal(excel.data.errors[0].line, 5);
    const comma = await api('POST', '/api/imports/customers/preview', csv('\nNome,Telefone\nCliente com vírgula,11999990000'));
    assert.equal(comma.data.rows[0].data.phone, '11999990000');
  });

  await check('mapeamento manual é respeitado e campos inválidos ou repetidos são recusados', async () => {
    const content = 'Razão;Contato\nMapeamento Teste;teste@example.com';
    const preview = await api('POST', '/api/imports/customers/preview', csv(content, { Razão: 'name', Contato: 'email' }));
    assert.equal(preview.data.rows[0].data.email, 'teste@example.com');
    for (const mapping of [{ Razão: 'name', Contato: 'name' }, { Razão: 'companyId' }, { Inexistente: 'name' }, { Razão: 123 }]) {
      assert.equal((await api('POST', '/api/imports/customers', { format: 'csv', content, mapping })).status, 400);
    }
    assert.equal((await api('POST', '/api/imports/customers', csv(content, {}))).status, 400);
  });

  await check('CPF/CNPJ atualiza só o cadastro da empresa e campos vazios preservam os dados', async () => {
    const document = '98765432101';
    const existing = await db.customer.create({ data: {
      companyId: company.id, name: 'Antes da importação', document: '987.654.321-01',
      phone: '11988887777', notes: 'Manter observações', active: false,
      lat: -23.5, lng: -46.6, geoSource: 'manual',
    } });
    const foreign = await db.customer.create({ data: { companyId: otherCompany.id, name: 'Outra empresa', document } });
    const body = csv(`Nome;CPF/CNPJ;Telefone;E-mail\nNome atualizado;${document};;NOVO@EXAMPLE.COM`);
    const result = await api('POST', '/api/imports/customers', body);
    assert.equal(result.status, 201, JSON.stringify(result.data));
    assert.deepEqual([result.data.created, result.data.updated, result.data.ignored], [0, 1, 0]);
    const saved = await db.customer.findUniqueOrThrow({ where: { id: existing.id } });
    assert.deepEqual([saved.name, saved.phone, saved.notes, saved.active, saved.email, saved.lat],
      ['Nome atualizado', '11988887777', 'Manter observações', false, 'novo@example.com', -23.5]);
    assert.equal((await db.customer.findUniqueOrThrow({ where: { id: foreign.id } })).name, 'Outra empresa');
    // Um documento que só existe na outra empresa gera um cadastro novo na atual.
    await db.customer.create({ data: { companyId: otherCompany.id, name: 'Só na outra', document: '98765432102' } });
    const create = await api('POST', '/api/imports/customers', csv('Nome;CPF/CNPJ\nCliente isolado;98765432102'));
    assert.deepEqual([create.data.created, create.data.updated], [1, 0]);
  });

  await check('endereço importado monta a linha e invalida coordenadas antigas', async () => {
    const existing = await db.customer.create({ data: {
      companyId: company.id, name: 'Endereço Antigo', document: '98765432103',
      street: 'Rua Antiga', number: '2', city: 'Campinas', state: 'SP',
      lat: -23.5, lng: -46.6, geoSource: 'manual',
    } });
    const result = await api('POST', '/api/imports/customers', csv('Nome;CPF/CNPJ;Rua;Número;CEP\nEndereço Novo;98765432103;Rua Nova;100;01305000'));
    assert.equal(result.status, 201, JSON.stringify(result.data));
    const saved = await db.customer.findUniqueOrThrow({ where: { id: existing.id } });
    assert.deepEqual([saved.city, saved.zip, saved.lat, saved.lng, saved.geoSource], ['Campinas', '01305000', null, null, null]);
    assert.match(saved.address, /Rua Nova, 100/);
    const free = await api('POST', '/api/imports/customers', csv('Nome;CPF/CNPJ;Endereço\nEndereço livre;98765432103;Avenida Nova, 200, Centro'));
    assert.equal(free.status, 201, JSON.stringify(free.data));
    const replaced = await db.customer.findUniqueOrThrow({ where: { id: existing.id } });
    assert.deepEqual([replaced.address, replaced.street, replaced.zip, replaced.city], ['Avenida Nova, 200, Centro', null, null, null]);
  });

  await check('XML preserva zeros e entidades e fornecedores são criados e atualizados', async () => {
    const body = { format: 'xml', content: '<fornecedores><fornecedor><name>Importação &amp; Cia</name><document>01234567000190</document><tradeName>Fantasia</tradeName><phone>11999990000</phone><active>não</active></fornecedor></fornecedores>' };
    const first = await api('POST', '/api/imports/suppliers', body);
    assert.equal(first.status, 201, JSON.stringify(first.data));
    assert.deepEqual([first.data.created, first.data.updated], [1, 0]);
    const second = await api('POST', '/api/imports/suppliers', body);
    assert.deepEqual([second.data.created, second.data.updated], [0, 1]);
    const saved = await db.supplier.findFirstOrThrow({ where: { companyId: company.id, document: '01234567000190' } });
    assert.deepEqual([saved.name, saved.tradeName, saved.whatsapp, saved.active], ['Importação & Cia', 'Fantasia', '11999990000', false]);
  });

  await check('linhas inválidas e documentos duplicados são relatados e ignorados', async () => {
    const body = csv('Nome;CPF/CNPJ;E-mail;Ativo;CEP;UF\nCliente válido;98765432104;valido@example.com;sim;01305000;sp\nOutro;98765432104;;;;\nSem email;;errado;;;\nA;;;;;\nInativo;;;talvez;;\nCEP ruim;;;;123;\nUF ruim;;;;;ABC\nDocumento;abc;;;;');
    const preview = await api('POST', '/api/imports/customers/preview', body);
    assert.equal(preview.data.rows.length, 1);
    assert.deepEqual(preview.data.errors.map((error: any) => error.line), [3, 4, 5, 6, 7, 8, 9]);
    const result = await api('POST', '/api/imports/customers', body);
    assert.deepEqual([result.data.created, result.data.updated, result.data.ignored], [1, 0, 7]);
  });

  await check('documentos ambíguos entre cadastros existentes não são atualizados', async () => {
    await db.supplier.createMany({ data: [
      { companyId: company.id, name: 'Duplicado A', document: '98765432105' },
      { companyId: company.id, name: 'Duplicado B', document: '987.654.321-05' },
    ] });
    const result = await api('POST', '/api/imports/suppliers/preview', csv('Nome;CPF\nAmbíguo;98765432105'));
    assert.equal(result.data.rows.length, 0);
    assert.match(result.data.errors[0].message, /mais de um cadastro/);
    assert.equal((await api('POST', '/api/imports/suppliers', csv('Nome;CPF\nAmbíguo;98765432105'))).status, 400);
  });

  await check('Excel com fórmula, arquivos inválidos e limites excedidos são recusados', async () => {
    const book = new Workbook();
    const sheet = book.addWorksheet('Clientes');
    sheet.addRow(['Nome']);
    sheet.addRow([{ formula: '"Cliente"', result: 'Cliente' }]);
    const content = Buffer.from(await book.xlsx.writeBuffer()).toString('base64');
    await assert.rejects(() => readContacts({ format: 'xlsx', content }, 'customers'), /fórmulas/);
    for (const body of [
      { format: 'xlsx', content: 'invalido' },
      { format: 'csv', content: 'Nome\n"Sem fechar' },
      { format: 'csv', content: 'Nome;Nome\nRepetido;Repetido' },
      { format: 'csv', content: 'Nome' },
      { format: 'csv', content: 'Nome\n' + Array(1001).fill('Cliente Teste').join('\n') },
      { format: 'csv', content: 'Nome\n' + 'x'.repeat(3 * 1024 * 1024) },
      { format: 'xml', content: '<clientes><cliente>' },
      { format: 'xml', content: '<!DOCTYPE clientes [<!ENTITY x SYSTEM "file:///etc/passwd">]><clientes><cliente><name>&x;</name></cliente></clientes>' },
      { format: 'xml', content: '<clientes><cliente><name><nested>Não aceito</nested></name></cliente></clientes>' },
    ]) {
      await assert.rejects(() => readContacts(body as any, 'customers'));
    }
    assert.equal((await api('POST', '/api/imports/customers', { format: 'xls', content: 'x' })).status, 400);
    assert.equal((await api('GET', '/api/imports/customers/example?format=xls')).status, 400);
  });

  await check('rotas de importação respeitam permissões, sessão e plano', async () => {
    const body = csv('Nome\nCliente Teste');
    for (const kind of ['customers', 'suppliers']) {
      assert.equal((await garcom('POST', `/api/imports/${kind}/preview`, body)).status, 403);
      assert.equal((await garcom('POST', `/api/imports/${kind}`, body)).status, 403);
      assert.equal((await garcom('GET', `/api/imports/${kind}/example?format=csv`)).status, 403);
      assert.equal((await fetch(`${base}/api/imports/${kind}/example?format=csv`)).status, 401);
    }
    // Caixa pode gerenciar clientes, mas não fornecedores.
    assert.equal((await caixa('POST', '/api/imports/customers/preview', body)).status, 201);
    assert.equal((await caixa('POST', '/api/imports/suppliers/preview', body)).status, 403);
    const basic = await db.plan.findUniqueOrThrow({ where: { code: 'basico' } });
    await db.company.update({ where: { id: company.id }, data: { planId: basic.id } });
    try {
      for (const kind of ['customers', 'suppliers']) {
        assert.equal((await api('POST', `/api/imports/${kind}/preview`, body)).status, 403);
        assert.equal((await api('POST', `/api/imports/${kind}`, body)).status, 403);
      }
    } finally { await db.company.update({ where: { id: company.id }, data: { planId: company.planId } }); }
  });
}
