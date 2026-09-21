// Fila offline: o que ainda não subiu, o que foi recusado e por quê.
import { pageTitle } from '../shell.js';
import { filaAtualizar, filaListar, sincronizar } from '../offline.js';
import { mount, card, dataList, emptyState, h, refreshIcons, toast } from '../ui.js';

export default async function render({ content }) {
  const lista = h('div', {});

  const enviar = h('button', { class: 'btn btn-primary' }, 'Tentar enviar agora');
  enviar.onclick = async () => {
    const { enviados, falhas } = await sincronizar();
    toast(`${enviados} enviada(s), ${falhas} com erro.`, falhas ? 'warning' : 'success');
    carregar();
  };

  mount(content,
    pageTitle('Sincronização', enviar),
    card('Como funciona', h('div', {},
      h('p', { class: 'mb-1' }, 'Sem conexão, o PDV guarda a venda no aparelho e envia sozinho quando a rede volta. '
        + 'Cada venda leva uma chave própria, então reenviar nunca duplica.'),
      h('p', { class: 'mb-0 txt-secondary f-12' },
        'O servidor continua sendo a autoridade: se o estoque acabou enquanto você estava offline, '
        + 'o item aparece aqui como recusado com o motivo — nada é sobrescrito automaticamente. '
        + 'Nenhuma operação é descartada: resolva o motivo (repor o estoque, por exemplo) e mande de novo.'))),
    card('Fila', lista));

  async function carregar() {
    const rows = await filaListar();
    lista.replaceChildren(rows.length ? dataList({
      rows: rows.sort((a, b) => b.id - a.id),
      columns: [
        { label: 'Operação', cell: (r) => h('strong', {}, r.label ?? r.path) },
        { label: 'Quando', cell: (r) => new Date(r.at).toLocaleString('pt-BR') },
        {
          label: 'Situação',
          cell: (r) => h('div', {},
            h('span', { class: `badge text-bg-${r.status === 'pendente' ? 'warning' : 'danger'}` },
              r.status === 'pendente' ? 'Aguardando envio' : 'Recusada'),
            r.error ? h('small', { class: 'd-block text-danger' }, r.error) : null),
        },
        {
          // sem "descartar": operação de caixa não se joga fora — ou sobe, ou
          // fica registrada aqui com o motivo até alguém resolver
          label: '', className: 'text-end',
          cell: (r) => (r.status === 'falhou' ? h('button', {
            class: 'btn btn-sm btn-outline-primary',
            onclick: async () => {
              await filaAtualizar({ ...r, status: 'pendente', error: null });
              const { falhas } = await sincronizar();
              if (falhas) toast('Continua recusada. Resolva o motivo e tente de novo.', 'warning');
              carregar();
            },
          }, 'Tentar de novo') : h('span', { class: 'txt-secondary f-12' }, 'envio automático')),
        },
      ],
    }) : emptyState('Nada pendente: tudo já está no servidor.'));
    refreshIcons(content);
  }

  await carregar();
}
