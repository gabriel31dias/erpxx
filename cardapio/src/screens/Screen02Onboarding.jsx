import React from 'react';
import { useApp } from '../context/AppContext';

export function Screen02Onboarding() {
  const { navigateTo } = useApp();

  return (
    <div className="relative w-full h-full min-h-screen bg-[#0E0E10] overflow-hidden flex flex-col justify-between select-none">
      {/* Top Burger Photo */}
      <div className="relative w-full h-[55vh] max-h-[480px] overflow-hidden flex items-center justify-center">
        <img
          src="/assets/images/burger_onboarding.png"
          alt="Hambúrguer Artesanal"
          className="w-full h-full object-cover object-center"
        />
        {/* Bottom Gradient Fade */}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#0E0E10]" />
      </div>

      {/* Bottom Content Area */}
      <div className="flex-1 flex flex-col justify-between px-6 pb-10 pt-2 z-10">
        <div>
          {/* Main Title */}
          <h1 className="text-2xl font-extrabold text-white leading-tight tracking-tight">
            Seus<br />
            pratos favoritos<br />
            mais perto de você
          </h1>

          {/* Carousel Dots */}
          <div className="flex items-center space-x-2 mt-6">
            <div className="w-6 h-2 rounded-full bg-[var(--brand)]" />
            <div className="w-2 h-2 rounded-full bg-zinc-600" />
            <div className="w-2 h-2 rounded-full bg-zinc-600" />
          </div>
        </div>

        {/* Action Buttons */}
        <div className="space-y-3 mt-8">
          <button
            onClick={() => navigateTo('home')}
            className="w-full py-3.5 bg-[var(--brand)] hover:brightness-90 active:scale-[0.98] transition-all rounded-2xl text-white font-bold text-sm shadow-lg"
          >
            Começar
          </button>

          <button
            onClick={() => navigateTo('home')}
            className="w-full py-2 text-zinc-400 hover:text-white transition-colors text-xs font-semibold text-center"
          >
            Pular
          </button>
        </div>
      </div>
    </div>
  );
}
