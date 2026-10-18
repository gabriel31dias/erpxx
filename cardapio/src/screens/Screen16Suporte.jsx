import React from 'react';
import {
  MessageCircle,
  HelpCircle,
  AlertTriangle,
  MessageSquare,
  ChevronRight
} from 'lucide-react';
import { ScreenHeader } from '../components/ScreenHeader';
import { useApp } from '../context/AppContext';

export function Screen16Suporte() {
  const { storeInfo, navigateTo } = useApp();
  const wa = (text) => window.open(`https://wa.me/${storeInfo.whatsapp}?text=${encodeURIComponent(text)}`, '_blank');
  const supportOptions = [
    {
      id: 'whatsapp',
      title: 'Falar com o restaurante',
      subtitle: 'WhatsApp',
      icon: MessageCircle,
      action: () => wa(`Olá, ${storeInfo.name}! Tenho uma dúvida.`),
    },
    {
      id: 'faq',
      title: 'Horários e endereço',
      subtitle: null,
      icon: HelpCircle,
      action: () => navigateTo('sobre'),
    },
    {
      id: 'problem',
      title: 'Relatar um problema',
      subtitle: null,
      icon: AlertTriangle,
      action: () => wa('Olá! Tive um problema com meu pedido.'),
    },
    {
      id: 'suggestions',
      title: 'Sugestões',
      subtitle: null,
      icon: MessageSquare,
      action: () => wa('Olá! Tenho uma sugestão:'),
    },
  ];

  return (
    <div className="relative w-full h-full min-h-screen bg-[#0E0E10] overflow-hidden flex flex-col justify-between select-none">
      {/* Top Header */}
      <div className="shrink-0 pt-2">
        <ScreenHeader title="Suporte" />
      </div>

      {/* Support Options List */}
      <div className="flex-1 overflow-y-auto px-5 py-2 space-y-2.5 scrollbar-none">
        {supportOptions.map(opt => {
          const Icon = opt.icon;
          return (
            <button
              key={opt.id}
              onClick={opt.action}
              className="w-full bg-[#18181C] hover:bg-[#202024] border border-[#26262C] rounded-2xl px-4 py-3.5 flex items-center justify-between transition-colors text-left group"
            >
              <div className="flex items-center space-x-3.5">
                <div className="text-zinc-400 group-hover:text-white transition-colors">
                  <Icon size={18} />
                </div>
                <div>
                  <h3 className="text-xs font-medium text-zinc-200 group-hover:text-white">
                    {opt.title}
                  </h3>
                  {opt.subtitle && (
                    <p className="text-[11px] text-zinc-400 mt-0.5">
                      {opt.subtitle}
                    </p>
                  )}
                </div>
              </div>

              <ChevronRight size={15} className="text-zinc-500 group-hover:text-zinc-300" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
