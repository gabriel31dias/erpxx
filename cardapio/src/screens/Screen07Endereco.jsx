import React, { useState } from 'react';
import { Crosshair, Check } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { ScreenHeader } from '../components/ScreenHeader';
import { fetchCep } from '../lib/api';

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
  const { deliveryType, setDeliveryType, customer, setCustomer, navigateTo, storeInfo, selectedPayment, deliveryGeo, setDeliveryGeo } = useApp();
  const [error, setError] = useState('');
  const [cepState, setCepState] = useState(''); // '', 'loading', mensagem de erro
  const [locating, setLocating] = useState(false);
  const set = (key) => (e) => setCustomer((c) => ({ ...c, [key]: e.target.value }));
  const v = (key) => customer[key] ?? ''; // endereço salvo antes destes campos não tem a chave

  // CEP completo: preenche rua, bairro e cidade (o cliente só põe número e complemento)
  const onCep = async (e) => {
    const zip = e.target.value.replace(/\D/g, '').slice(0, 8);
    setCustomer((c) => ({ ...c, zip: zip.length > 5 ? `${zip.slice(0, 5)}-${zip.slice(5)}` : zip }));
    if (zip.length !== 8) return setCepState('');
    setCepState('loading');
    try {
      const r = await fetchCep(zip);
      setCustomer((c) => ({ ...c, street: r.street || c.street, district: r.district || c.district, city: r.city, state: r.state }));
      setCepState('');
    } catch (err) {
      setCepState(err.message);
    }
  };

  // GPS do celular: o motoboy chega no ponto certo mesmo com endereço difícil
  const locate = () => {
    if (!navigator.geolocation) return setError('Seu celular não informa a localização.');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setDeliveryGeo({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) });
        setLocating(false);
      },
      () => {
        setError('Não deu para pegar sua localização. Confira se ela está liberada para o navegador.');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

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
          <div className="space-y-3.5">
            <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
              <Input label="CEP" inputMode="numeric" autoComplete="postal-code" maxLength={9} value={v('zip')} onChange={onCep} placeholder="00000-000" />
              <span className="h-11 flex items-center text-[11px] text-zinc-500">{cepState === 'loading' ? 'Buscando…' : ''}</span>
            </div>
            {cepState && cepState !== 'loading' && <p className="text-[11px] text-amber-400 -mt-2">{cepState}</p>}
            <Input label="Rua" required maxLength={120} value={v('street')} onChange={set('street')} autoComplete="address-line1" placeholder="Rua, avenida…" />
            <div className="grid grid-cols-[110px_1fr] gap-2">
              <Input label="Número" required maxLength={20} value={v('number')} onChange={set('number')} placeholder="123" />
              <Input label="Complemento" maxLength={60} value={v('complement')} onChange={set('complement')} placeholder="Apto, bloco, referência" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input label="Bairro" required maxLength={80} value={v('district')} onChange={set('district')} />
              <Input label="Cidade" required maxLength={80} value={v('city')} onChange={set('city')} autoComplete="address-level2" />
            </div>
            <button
              type="button"
              onClick={locate}
              disabled={locating}
              className={`w-full h-11 rounded-2xl text-xs font-semibold flex items-center justify-center gap-2 border transition active:scale-[0.98] ${
                deliveryGeo ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10' : 'border-[#26262C] text-zinc-300 bg-[#18181C]'
              }`}
            >
              {deliveryGeo ? <Check size={15} /> : <Crosshair size={15} className={locating ? 'animate-spin' : ''} />}
              {locating ? 'Pegando sua localização…' : deliveryGeo ? 'Localização marcada: o motoboy vem direto aqui' : 'Estou no local: usar minha localização'}
            </button>
          </div>
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
