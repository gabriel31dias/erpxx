// Detalhe da venda: itens, pagamentos, comprovante e cancelamento com motivo.
import { get, novaChave, post } from '../api.js';
import { pageTitle } from '../shell.js';
import { mount, card, confirmAction, fmtBRL, fmtDate, fmtQty, h, icon, input, modal, refreshIcons, toast } from '../ui.js';

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
      h('div', {}, sale.seller ? `Vendedor externo: ${sale.seller.name}` : `Operador: ${sale.operator?.name ?? '—'}`),
      sale.seller ? h('div', {}, [
        sale.offline ? 'Gerada offline' : 'Gerada online',
        sale.paidInApp ? `Paga no app (${{ pix: 'PIX', cartao: 'cartão', boleto: 'boleto' }[sale.appPaymentMethod] ?? sale.appPaymentMethod})` : 'Não paga no app',
      ].join(' · ')) : null,
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
  /** Id da cobrança no gateway (PIX/cartão) ou nosso número do boleto, para conciliar. */
  function referenciaGateway() {
    if (!sale.appPaymentRef) return null;
    const rotulo = { pix: 'ID da transação PIX no gateway', cartao: 'ID da transação do cartão', boleto: 'Nosso número do boleto' }[sale.appPaymentMethod]
      ?? 'ID do pagamento no gateway';
    const copiar = h('button', {
      class: 'btn btn-sm btn-outline-secondary', title: 'Copiar', 'aria-label': 'Copiar ID',
      onclick: () => navigator.clipboard?.writeText(sale.appPaymentRef).then(() => toast('ID copiado.')),
    }, icon('copy', 14));
    return h('div', { class: 'border-top pt-3 mt-2' },
      h('small', { class: 'd-block txt-secondary' }, rotulo),
      h('div', { class: 'd-flex align-items-center gap-2' },
        h('code', { class: 'text-break user-select-all' }, sale.appPaymentRef), copiar));
  }

  // ---------- comprovantes de pagamento anexados (app do vendedor ou ERP) ----------
  const comprovantes = h('div', {});
  function listarComprovantes(rows) {
    const arquivo = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,application/pdf', class: 'd-none' });
    const anexar = h('button', { class: 'btn btn-sm btn-outline-primary', onclick: () => arquivo.click() },
      icon('paperclip', 14), ' Anexar comprovante');
    arquivo.onchange = async () => {
      if (!arquivo.files[0]) return;
      const form = new FormData();
      form.append('file', arquivo.files[0]);
      anexar.disabled = true;
      try {
        // multipart: vai direto no fetch (o cliente da API só manda JSON)
        const res = await fetch(`/api/sales/${id}/attachments`, {
          method: 'POST', body: form, credentials: 'same-origin', headers: { 'X-Requested-With': 'lojaflow' },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Falha ao anexar.');
        toast('Comprovante anexado.');
        listarComprovantes((await get(`/sales/${id}/attachments`)).rows);
      } catch (e) { toast(e.message, 'error'); } finally { anexar.disabled = false; }
    };
    comprovantes.replaceChildren(
      rows.length
        ? h('ul', { class: 'list-unstyled mb-3' }, rows.map((a) => h('li', { class: 'mb-2' },
          h('a', { href: `/api/sales/attachments/${a.id}/file`, target: '_blank', rel: 'noopener' },
            icon(a.mimeType === 'application/pdf' ? 'file-text' : 'image', 14), ` ${a.fileName}`),
          h('small', { class: 'd-block txt-secondary' },
            `${new Date(a.createdAt).toLocaleString('pt-BR').slice(0, 17)} · ${Math.ceil(a.size / 1024)} KB`
            + (a.seller ? ` · enviado por ${a.seller.name}` : '') + (a.notes ? ` · ${a.notes}` : '')))))
        : h('p', { class: 'txt-secondary' }, 'Nenhum comprovante anexado.'),
      can('pdv.acessar') ? h('div', {}, anexar, arquivo) : null);
    refreshIcons(comprovantes);
  }
  listarComprovantes((await get(`/sales/${id}/attachments`)).rows);

  const btnEmitir = h('button', { class: 'btn btn-primary' }, icon('file-text', 16), ' Emitir NFC-e');
  btnEmitir.onclick = () => emitir(btnEmitir);

  mount(content,
    pageTitle(`Venda #${sale.number}`,
      h('a', { class: 'btn btn-light', href: '/vendas.html' }, 'Voltar'),
      h('button', { class: 'btn btn-outline-secondary', onclick: () => window.print() }, icon('printer', 16), ' Imprimir comprovante'),
      !cancelada && can('pdv.acessar') ? btnEmitir : null,
      !cancelada && can('pdv.cancelar_venda')
        ? h('button', { class: 'btn btn-outline-danger', onclick: cancelar }, 'Cancelar venda') : null),

    sale.paymentStatus === 'unpaid' ? h('div', { class: 'alert alert-warning d-flex flex-wrap justify-content-between align-items-center gap-2' },
      h('span', {}, h('strong', {}, 'Venda não paga. '),
        sale.dueDate ? `Vencimento em ${fmtDate(sale.dueDate)}.` : '',
        sale.paidInApp === false && sale.appPaymentMethod === 'pix' ? ' PIX aguardando confirmação.' : '',
        sale.appPaymentMethod === 'boleto' ? ' Boleto aguardando compensação.' : ''),
      can('financeiro.gerenciar') ? h('button', {
        class: 'btn btn-sm btn-warning',
        onclick: async (e) => {
          if (!(await confirmAction(`Marcar a venda #${sale.number} como paga hoje?`, { okLabel: 'Marcar como paga', danger: false }))) return;
          e.target.disabled = true;
          try {
            await post(`/finance/entries/${sale.finEntries.find((f) => f.status === 'pending').id}/pay`, {});
            toast('Venda marcada como paga.');
            location.reload();
          } catch (err) { toast(err.message, 'error'); e.target.disabled = false; }
        },
      }, 'Marcar como paga') : null) : null,

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
        card('Pagamentos', h('div', {}, h('div', { class: 'table-responsive' }, h('table', { class: 'table align-middle mb-0' },
          h('tbody', {}, sale.payments.map((p) => h('tr', {},
            h('td', {}, p.methodName),
            h('td', {}, p.installments > 1 ? `${p.installments}x` : 'à vista'),
            h('td', { class: 'text-end f-w-600' }, fmtBRL(p.amountCents))))))),
          referenciaGateway())),
        card('Comprovantes de pagamento', comprovantes)),
      h('div', { class: 'col-12 col-lg-4' },
        card('Comprovante não fiscal', comprovante))),
  );
  refreshIcons(content);
}
