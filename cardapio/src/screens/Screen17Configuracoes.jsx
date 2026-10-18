import React from 'react';
import {
  Bell,
  Moon,
  Globe,
  FileText,
  Shield,
  Info,
  ChevronRight
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { ScreenHeader } from '../components/ScreenHeader';

export function Screen17Configuracoes() {
  const {
    notificationsEnabled,
    setNotificationsEnabled,
    themeMode,
    setThemeMode,
    language,
    setLanguage
  } = useApp();

  return (
    <div className="relative w-full h-full min-h-screen bg-[#0E0E10] overflow-hidden flex flex-col justify-between select-none">
      {/* Top Header */}
      <div className="shrink-0 pt-2">
        <ScreenHeader title="Configurações" />
      </div>

      {/* Settings Options List */}
      <div className="flex-1 overflow-y-auto px-5 py-2 space-y-2.5 scrollbar-none">
        {/* 1. Notificações */}
        <div className="w-full bg-[#18181C] border border-[#26262C] rounded-2xl px-4 py-3.5 flex items-center justify-between">
          <div className="flex items-center space-x-3.5">
            <Bell size={18} className="text-zinc-400" />
            <span className="text-xs font-medium text-zinc-200">
              Notificações
            </span>
          </div>

          <button
            onClick={() => setNotificationsEnabled(!notificationsEnabled)}
            className={`w-11 h-6 flex items-center rounded-full p-0.5 transition-colors duration-200 ${
              notificationsEnabled ? 'bg-[var(--brand)]' : 'bg-zinc-700'
            }`}
          >
            <div
              className={`bg-white w-5 h-5 rounded-full shadow transform transition-transform duration-200 ${
                notificationsEnabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* 2. Tema */}
        <button
          onClick={() => setThemeMode(themeMode === 'dark' ? 'light' : 'dark')}
          className="w-full bg-[#18181C] hover:bg-[#202024] border border-[#26262C] rounded-2xl px-4 py-3.5 flex items-center justify-between transition-colors text-left group"
        >
          <div className="flex items-center space-x-3.5">
            <Moon size={18} className="text-zinc-400 group-hover:text-white" />
            <span className="text-xs font-medium text-zinc-200 group-hover:text-white">
              Tema
            </span>
          </div>

          <div className="flex items-center space-x-1.5">
            <span className="text-xs text-zinc-400">
              {themeMode === 'dark' ? 'Escuro' : 'Claro'}
            </span>
            <ChevronRight size={15} className="text-zinc-500 group-hover:text-zinc-300" />
          </div>
        </button>

        {/* 3. Idioma */}
        <button
          onClick={() => setLanguage(language === 'Português' ? 'English' : 'Português')}
          className="w-full bg-[#18181C] hover:bg-[#202024] border border-[#26262C] rounded-2xl px-4 py-3.5 flex items-center justify-between transition-colors text-left group"
        >
          <div className="flex items-center space-x-3.5">
            <Globe size={18} className="text-zinc-400 group-hover:text-white" />
            <span className="text-xs font-medium text-zinc-200 group-hover:text-white">
              Idioma
            </span>
          </div>

          <div className="flex items-center space-x-1.5">
            <span className="text-xs text-zinc-400">
              {language}
            </span>
            <ChevronRight size={15} className="text-zinc-500 group-hover:text-zinc-300" />
          </div>
        </button>

        {/* 4. Termos de uso */}
        <button
          onClick={() => alert('Termos de uso')}
          className="w-full bg-[#18181C] hover:bg-[#202024] border border-[#26262C] rounded-2xl px-4 py-3.5 flex items-center justify-between transition-colors text-left group"
        >
          <div className="flex items-center space-x-3.5">
            <FileText size={18} className="text-zinc-400 group-hover:text-white" />
            <span className="text-xs font-medium text-zinc-200 group-hover:text-white">
              Termos de uso
            </span>
          </div>

          <ChevronRight size={15} className="text-zinc-500 group-hover:text-zinc-300" />
        </button>

        {/* 5. Política de privacidade */}
        <button
          onClick={() => alert('Política de privacidade')}
          className="w-full bg-[#18181C] hover:bg-[#202024] border border-[#26262C] rounded-2xl px-4 py-3.5 flex items-center justify-between transition-colors text-left group"
        >
          <div className="flex items-center space-x-3.5">
            <Shield size={18} className="text-zinc-400 group-hover:text-white" />
            <span className="text-xs font-medium text-zinc-200 group-hover:text-white">
              Política de privacidade
            </span>
          </div>

          <ChevronRight size={15} className="text-zinc-500 group-hover:text-zinc-300" />
        </button>

        {/* 6. Sobre o app */}
        <div className="w-full bg-[#18181C] border border-[#26262C] rounded-2xl px-4 py-3.5 flex items-center justify-between">
          <div className="flex items-center space-x-3.5">
            <Info size={18} className="text-zinc-400" />
            <div>
              <span className="text-xs font-medium text-zinc-200 block">
                Sobre o app
              </span>
              <span className="text-[10px] text-zinc-400">
                Versão 1.0.0
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
