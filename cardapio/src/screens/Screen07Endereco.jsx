import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { ScreenHeader } from '../components/ScreenHeader';

const inputClass =
  'w-full h-11 bg-[#18181C] border border-[#26262C] rounded-2xl px-4 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500';

function Input({ label, ...props }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[11px] font-semibold text-zinc-400">{label}</span>
      <input className={inputClass} {...props} />
    </label>
  );
}

export function Screen07Endereco() {
  const { deliveryType, setDeliveryType, customer, setCustomer, navigateTo, storeInfo, selectedPayment } = useApp();
  const [error, setError] = useState('');
  const set = (key) => (e) => setCustomer((c) => ({ ...c, [key]: e.target.value }));

  const options = [
    storeInfo.accepts_delivery && ['delivery', 'Entrega'],
    storeInfo.accepts_pickup && ['pickup', 'Retirar no local'],
  ].filter(Boolean);

  const next = (e) => {
    e.preventDefault();
    if (customer.phone.replace(/\D/g, '').length < 10) return setError('Informe um telefone com DDD');
    setError('');
    navigateTo('pagamento');
  };

  return (
    <form onSubmit={next} className="relative w-full h-full min-h-screen bg-[#0E0E10] overflow-hidden flex flex-col justify-between select-none">
      {/* Top Header */}
      <div className="shrink-0 pt-2">
        <ScreenHeader title="Entrega" />

        {/* Segmented Control */}
        {options.length > 1 && (
          <div className="px-5 py-2">
            <div className="grid grid-cols-2 p-1 bg-[#18181C] border border-[#26262C] rounded-2xl text-xs font-semibold">
              {options.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setDeliveryType(id)}
                  className={`py-2 rounded-xl transition-all ${
                    deliveryType === id ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Dados do cliente */}
      <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3.5 scrollbar-none">
        <Input label="Seu nome" required minLength={2} maxLength={80} value={customer.name} onChange={set('name')} autoComplete="name" placeholder="Como devemos te chamar" />
        <Input label="WhatsApp / telefone" required type="tel" maxLength={20} value={customer.phone} onChange={set('phone')} autoComplete="tel" placeholder="(11) 99999-9999" />
        {selectedPayment === 'pix' && (
          <Input label="E-mail (comprovante do Pix)" required type="email" value={customer.email} onChange={set('email')} autoComplete="email" placeholder="voce@email.com" />
        )}
        {deliveryType === 'delivery' ? (
          <label className="block space-y-1.5">
            <span className="text-[11px] font-semibold text-zinc-400">Endereço de entrega</span>
            <textarea
              required
              minLength={5}
              maxLength={300}
              rows={3}
              value={customer.address}
              onChange={set('address')}
              autoComplete="street-address"
              placeholder="Rua, número, bairro, complemento"
              className={`${inputClass} h-auto py-3`}
            />
          </label>
        ) : (
          <div className="p-4 rounded-2xl border bg-[#18181C] border-[#26262C] text-xs">
            <span className="font-bold text-white block">Retirar em</span>
            <p className="text-zinc-300 font-medium mt-0.5">{storeInfo.address || storeInfo.name}</p>
          </div>
        )}
        <Input label="Observações (opcional)" maxLength={300} value={customer.notes} onChange={set('notes')} placeholder="Sem cebola, troco para 50..." />
        {error && <p className="text-xs font-semibold text-red-400">{error}</p>}
      </div>

      {/* Bottom Action */}
      <div className="p-4 bg-[#0E0E10] border-t border-[#202026] shrink-0">
        <button
          type="submit"
          className="w-full py-3.5 bg-[var(--brand)] hover:brightness-90 active:scale-[0.98] transition-all rounded-2xl text-white font-semibold text-sm shadow-lg"
        >
          Continuar
        </button>
      </div>
    </form>
  );
}
