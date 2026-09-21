// Detalhe da venda: itens, pagamentos, comprovante e cancelamento com motivo.
import { get, novaChave, post } from '../api.js';
import { pageTitle } from '../shell.js';
import { mount, card, fmtBRL, fmtQty, h, icon, input, modal, refreshIcons, toast } from '../ui.js';

export default async function render({ content, can }) {
  const id = new URLSearchParams(location.search).get('id');
  const { sale, receipt } = await get(`/sales/${id}`);

  const cancelar = () => {
    const motivo = input({ class: 'form-control', placeholder: 'Motivo do cancelamento' });
    const ok = h('button', { class: 'btn btn-danger' }, 'Cancelar venda');
    const m = modal({
      title: `Cancelar venda #${sale.number}`,
      body: h('div', {},
        h('p', {}, 'A venda não é apagada: fica registrada como cancelada, o estoque volta e o financeiro é estornado.'),
        motivo),
      footer: [h('button', { class: 'btn btn-light', 'data-bs-dismiss': 'modal' }, 'Voltar'), ok],
    });
    ok.onclick = async () => {
      if (motivo.value.trim().length < 3) return toast('Informe o motivo.', 'warning');
      try {
        await post(`/sales/${id}/cancel`, { reason: motivo.value.trim(), idempotencyKey: novaChave() });
        m.close();
        toast('Venda cancelada.');
        location.reload();
      } catch (e) { toast(e.message, 'error'); }
    };
    setTimeout(() => motivo.focus(), 150);
  };

  const comprovante = h('div', { class: 'lf-recibo lf-recibo-print mx-auto' },
    h('div', { class: 'text-center' },
      h('strong', {}, receipt.company.name),
      receipt.company.document ? h('div', {}, `CNPJ ${receipt.company.document}`) : null,
      receipt.company.address ? h('div', {}, receipt.company.address) : null,
      h('div', {}, `Venda #${sale.number} · ${sale.soldAt}`),
      h('div', {}, `Operador: ${sale.operator?.name ?? '—'}`),
      h('div', {}, `Cliente: ${sale.customer?.name ?? 'Não identificado'}`)),
    h('hr'),
    h('table', {}, h('tbody', {}, sale.items.map((i) => h('tr', {},
      h('td', {}, `${fmtQty(i.quantity, i.unit)} × ${i.name}`),
      h('td', { class: 'text-end' }, fmtBRL(i.totalCents)))))),
    h('hr'),
    h('table', {}, h('tbody', {},
      h('tr', {}, h('td', {}, 'Subtotal'), h('td', { class: 'text-end' }, fmtBRL(sale.subtotalCents))),
      h('tr', {}, h('td', {}, 'Desconto'), h('td', { class: 'text-end' }, fmtBRL(sale.discountCents))),
      h('tr', {}, h('td', {}, h('strong', {}, 'TOTAL')), h('td', { class: 'text-end' }, h('strong', {}, fmtBRL(sale.totalCents)))),
      ...sale.payments.map((p) => h('tr', {},
        h('td', {}, `${p.methodName}${p.installments > 1 ? ` ${p.installments}x` : ''}`),
        h('td', { class: 'text-end' }, fmtBRL(p.amountCents)))),
      sale.changeCents ? h('tr', {}, h('td', {}, 'Troco'), h('td', { class: 'text-end' }, fmtBRL(sale.changeCents))) : null)),
    h('hr'),
    h('div', { class: 'text-center f-12' }, receipt.footer));

  const cancelada = sale.status === 'CANCELLED';

  async function emitir(btn) {
    btn.disabled = true;
    try {
      const doc = await post('/fiscal/nfce', { saleId: id });
      const linhas = [['Situação', doc.status], ['Número', doc.number ? `${doc.number} / série ${doc.serie}` : '—'],
        ['Chave de acesso', doc.accessKey || '—'], ['Protocolo', doc.protocol || '—']];
      if (doc.rejectionReason) linhas.push(['Motivo', doc.rejectionReason]);
      modal({
        title: 'NFC-e',
        body: h('div', {},
          h('table', { class: 'table table-sm' }, h('tbody', {}, linhas.map(([k, v]) => h('tr', {}, h('th', { style: 'width:140px' }, k), h('td', { class: 'text-break' }, String(v)))))),
          h('a', { href: '/notas.html' }, 'Ver todas as notas →')),
        footer: [h('button', { class: 'btn btn-light', 'data-bs-dismiss': 'modal' }, 'Fechar')],
      });
      toast(doc.status === 'authorized' ? 'NFC-e autorizada.' : `NFC-e: ${doc.status}`, doc.status === 'authorized' ? 'success' : 'warning');
    } catch (e) { toast(e.message, 'error'); } finally { btn.disabled = false; }
  }
  const btnEmitir = h('button', { class: 'btn btn-primary' }, icon('file-text', 16), ' Emitir NFC-e');
  btnEmitir.onclick = () => emitir(btnEmitir);

  mount(content,
    pageTitle(`Venda #${sale.number}`,
      h('a', { class: 'btn btn-light', href: '/vendas.html' }, 'Voltar'),
      h('button', { class: 'btn btn-outline-secondary', onclick: () => window.print() }, icon('printer', 16), ' Imprimir comprovante'),
      !cancelada && can('pdv.acessar') ? btnEmitir : null,
      !cancelada && can('pdv.cancelar_venda')
        ? h('button', { class: 'btn btn-outline-danger', onclick: cancelar }, 'Cancelar venda') : null),

    cancelada ? h('div', { class: 'alert alert-danger' },
      h('strong', {}, 'Venda cancelada. '),
      `${sale.cancelReason ?? ''}`) : null,

    h('div', { class: 'row' },
      h('div', { class: 'col-12 col-lg-8' },
        card('Itens', h('div', { class: 'table-responsive' }, h('table', { class: 'table align-middle mb-0' },
          h('thead', {}, h('tr', {},
            h('th', {}, 'Produto'), h('th', { class: 'text-end' }, 'Qtd'),
            h('th', { class: 'text-end' }, 'Unit.'), h('th', { class: 'text-end' }, 'Desc.'),
            h('th', { class: 'text-end' }, 'Total'))),
          h('tbody', {}, sale.items.map((i) => h('tr', {},
            h('td', {}, h('a', { href: `/produto.html?id=${i.productId}` }, i.name)),
            h('td', { class: 'text-end' }, fmtQty(i.quantity, i.unit)),
            h('td', { class: 'text-end' }, fmtBRL(i.unitPriceCents)),
            h('td', { class: 'text-end' }, i.discountCents ? `- ${fmtBRL(i.discountCents)}` : '—'),
            h('td', { class: 'text-end f-w-600' }, fmtBRL(i.totalCents)))))))),
        card('Pagamentos', h('div', { class: 'table-responsive' }, h('table', { class: 'table align-middle mb-0' },
          h('tbody', {}, sale.payments.map((p) => h('tr', {},
            h('td', {}, p.methodName),
            h('td', {}, p.installments > 1 ? `${p.installments}x` : 'à vista'),
            h('td', { class: 'text-end f-w-600' }, fmtBRL(p.amountCents))))))))),
      h('div', { class: 'col-12 col-lg-4' },
        card('Comprovante não fiscal', comprovante))),
  );
  refreshIcons(content);
}
