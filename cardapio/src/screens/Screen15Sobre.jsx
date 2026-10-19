import React from 'react';
import { ArrowLeft, Share2, Clock, DollarSign, MapPin } from 'lucide-react';
import { useApp, brl } from '../context/AppContext';
import { pub } from '../lib/api';

export function Screen15Sobre() {
  const { goBack, storeInfo: s } = useApp();
  const RESTAURANT_INFO = {
    name: s.name,
    subtitle: s.subtitle,
    deliveryTime: s.delivery_time,
    deliveryFee: s.delivery_fee ? brl(s.delivery_fee) : 'Grátis',
    status: s.is_open ? 'Aberto agora' : 'Fechado',
    hours: s.hours,
    description: s.description,
    address: s.address,
  };
  const share = () => {
    if (navigator.share) navigator.share({ title: s.name, url: location.href }).catch(() => {});
    else navigator.clipboard?.writeText(location.href);
  };

  return (
    <div className="relative w-full h-full min-h-screen bg-[#0E0E10] overflow-hidden flex flex-col justify-between select-none">
      {/* Scrollable Container */}
      <div className="flex-1 overflow-y-auto scrollbar-none pb-6">
        {/* Top Hero Image with Saboria Logo Overlay */}
        <div className="relative w-full h-52 bg-zinc-900">
          <img
            src={s.cover_url || s.banner_url || pub('assets/images/restaurant_interior.png')}
            alt={s.name}
            className="w-full h-full object-cover"
          />

          {/* Gradient Overlay */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/30 to-[#0E0E10]" />

          {/* Header Actions */}
          <div className="absolute top-5 left-0 right-0 px-4 flex items-center justify-between z-20">
            <button
              onClick={goBack}
              className="w-9 h-9 rounded-full bg-black/50 backdrop-blur-md text-white flex items-center justify-center hover:bg-black/70 active:scale-90 transition-transform"
            >
              <ArrowLeft size={18} />
            </button>

            <div className="flex items-center space-x-2">
              <button onClick={share} aria-label="Compartilhar" className="w-9 h-9 rounded-full bg-black/50 backdrop-blur-md text-white flex items-center justify-center hover:bg-black/70 active:scale-90 transition-transform">
                <Share2 size={18} />
              </button>
            </div>
          </div>

          {/* logo da loja no mesmo tamanho do topo do cardápio (configurado no admin) */}
          {s.logo_url && (
            <div className="absolute inset-0 flex items-center justify-center pt-8 z-10 pointer-events-none">
              <img src={s.logo_url} alt="" style={{ height: s.logo_size || 32 }} className="w-auto max-w-[220px] object-contain drop-shadow-lg" />
            </div>
          )}
        </div>

        {/* Content Section */}
        <div className="px-5 pt-1 pb-4 space-y-4 -mt-2 relative z-10">
          {/* Title & Rating */}
          <div className="text-center">
            <h1 className="text-sm font-bold text-white tracking-tight">
              {RESTAURANT_INFO.name}
            </h1>
            <p className="text-xs text-zinc-400 mt-0.5">
              {RESTAURANT_INFO.subtitle}
            </p>

            {s.instagram && (
              <a
                href={`https://instagram.com/${s.instagram.replace('@', '')}`}
                target="_blank"
                rel="noreferrer"
                className="inline-block text-xs text-zinc-300 mt-1.5 hover:text-white"
              >
                {s.instagram}
              </a>
            )}
          </div>

          {/* 3 Metric Cards */}
          <div className="grid grid-cols-3 gap-2.5 pt-1">
            <div className="bg-[#18181C] border border-[#26262C] p-2.5 rounded-2xl text-center flex flex-col items-center justify-center">
              <Clock size={16} className="text-zinc-400 mb-1" />
              <span className="text-[11px] font-bold text-white block">
                {RESTAURANT_INFO.deliveryTime}
              </span>
              <span className="text-[9px] text-zinc-400">
                Tempo de entrega
              </span>
            </div>

            <div className="bg-[#18181C] border border-[#26262C] p-2.5 rounded-2xl text-center flex flex-col items-center justify-center">
              <DollarSign size={16} className="text-zinc-400 mb-1" />
              <span className="text-[11px] font-bold text-white block">
                {RESTAURANT_INFO.deliveryFee}
              </span>
              <span className="text-[9px] text-zinc-400">
                Taxa de entrega
              </span>
            </div>

            <div className="bg-[#18181C] border border-[#26262C] p-2.5 rounded-2xl text-center flex flex-col items-center justify-center">
              <div className={`w-2 h-2 rounded-full mb-1 ${s.is_open ? 'bg-emerald-400 animate-pulse' : 'bg-red-500'}`} />
              <span className={`text-[11px] font-bold block ${s.is_open ? 'text-emerald-400' : 'text-red-400'}`}>
                {RESTAURANT_INFO.status}
              </span>
              <span className="text-[9px] text-zinc-400">
                {RESTAURANT_INFO.hours}
              </span>
            </div>
          </div>

          {/* About Description */}
          <p className="text-xs text-zinc-400 leading-relaxed text-left pt-1">
            {RESTAURANT_INFO.description}
          </p>

          {/* Action Button: Ver Localização */}
          <div className="pt-2">
            <button
              onClick={() => window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(RESTAURANT_INFO.address || s.name)}`, '_blank')}
              className="w-full py-3 bg-[#18181C] hover:bg-[#202024] border border-[#26262C] rounded-2xl flex items-center justify-center space-x-2 text-xs font-semibold text-zinc-200 transition-colors"
            >
              <MapPin size={16} className="text-zinc-400" />
              <span>Ver localização</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
