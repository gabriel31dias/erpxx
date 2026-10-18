import React from 'react';
import { useApp } from '../context/AppContext';

export function Screen01Splash() {
  const { navigateTo } = useApp();

  return (
    <div 
      onClick={() => navigateTo('onboarding')}
      className="relative w-full h-full min-h-screen bg-[#0E0E10] overflow-hidden flex flex-col justify-between cursor-pointer select-none px-6 py-12"
    >
      {/* Decorative Tomato Slice Top Left */}
      <div className="absolute -top-6 -left-6 w-36 h-36 pointer-events-none opacity-85 rotate-12">
        <svg viewBox="0 0 100 100" fill="none" className="w-full h-full drop-shadow-md">
          <circle cx="50" cy="50" r="42" fill="#D32F2F" />
          <circle cx="50" cy="50" r="36" fill="#E53935" />
          <path d="M50 20C40 35 40 45 50 50C60 45 60 35 50 20Z" fill="#C62828"/>
          <path d="M50 80C40 65 40 55 50 50C60 55 60 65 50 80Z" fill="#C62828"/>
          <path d="M20 50C35 40 45 40 50 50C45 60 35 60 20 50Z" fill="#C62828"/>
          <path d="M80 50C65 40 55 40 50 50C55 60 65 60 80 50Z" fill="#C62828"/>
          <circle cx="50" cy="50" r="6" fill="#FFCDD2" />
          <circle cx="42" cy="38" r="2.5" fill="#FFE082"/>
          <circle cx="58" cy="38" r="2.5" fill="#FFE082"/>
          <circle cx="42" cy="62" r="2.5" fill="#FFE082"/>
          <circle cx="58" cy="62" r="2.5" fill="#FFE082"/>
        </svg>
      </div>

      {/* Decorative Tomato Slice Bottom Right */}
      <div className="absolute -bottom-8 -right-8 w-44 h-44 pointer-events-none opacity-80 -rotate-45">
        <svg viewBox="0 0 100 100" fill="none" className="w-full h-full drop-shadow-lg">
          <circle cx="50" cy="50" r="44" fill="#C62828" />
          <circle cx="50" cy="50" r="38" fill="#E53935" />
          <path d="M50 18C38 33 38 45 50 50C62 45 62 33 50 18Z" fill="#B71C1C"/>
          <path d="M50 82C38 67 38 55 50 50C62 55 62 67 50 82Z" fill="#B71C1C"/>
          <path d="M18 50C33 38 45 38 50 50C45 62 33 62 18 50Z" fill="#B71C1C"/>
          <path d="M82 50C67 38 55 38 50 50C55 62 67 62 82 50Z" fill="#B71C1C"/>
          <circle cx="50" cy="50" r="7" fill="#FFEBEE" />
          <circle cx="40" cy="36" r="3" fill="#FFE082"/>
          <circle cx="60" cy="36" r="3" fill="#FFE082"/>
        </svg>
      </div>

      {/* Basil Leaf Top Right */}
      <div className="absolute top-20 -right-2 w-12 h-16 pointer-events-none opacity-70 rotate-45">
        <svg viewBox="0 0 50 70" fill="none" className="w-full h-full">
          <path d="M25 5C5 25 5 50 25 65C45 50 45 25 25 5Z" fill="#2E7D32"/>
          <path d="M25 15V58" stroke="#4CAF50" strokeWidth="2"/>
        </svg>
      </div>

      {/* Top Spacer */}
      <div className="h-6" />

      {/* Center Saboria Brand Logo */}
      <div className="flex flex-col items-center justify-center text-center z-10">
        {/* Chef Hat Icon */}
        <div className="w-20 h-20 mb-3">
          <svg viewBox="0 0 100 100" fill="none" className="w-full h-full shadow-lg">
            <path
              d="M50 14C38 14 32 21 32 30C26 32 22 37 24 45C25.5 50 30 53 35 53C36 53 37 52.8 38 52.5C41 57 45.5 59 50 59C54.5 59 59 57 62 52.5C63 52.8 64 53 65 53C70 53 74.5 50 76 45C78 37 74 32 68 30C68 21 62 14 50 14Z"
              fill="var(--brand)"
              stroke="#FF3B47"
              strokeWidth="2.5"
            />
            <path
              d="M34 63H66C68 63 70 65 70 67C70 69 68 71 66 71H34C32 71 30 69 30 67C30 65 32 63 34 63Z"
              fill="var(--brand)"
            />
            <circle cx="42" cy="67" r="2" fill="#FFFFFF" />
            <circle cx="50" cy="67" r="2" fill="#FFFFFF" />
            <circle cx="58" cy="67" r="2" fill="#FFFFFF" />
          </svg>
        </div>

        {/* Brand Text */}
        <h1 className="text-4xl font-black text-white tracking-tight font-['Plus_Jakarta_Sans',sans-serif]">
          Sabor<span className="text-[var(--brand)]">ia</span>
        </h1>
        <p className="text-sm font-medium text-zinc-300 tracking-wide mt-1">
          Cardápio Digital
        </p>

        {/* Slogan */}
        <div className="mt-10 text-center space-y-1">
          <p className="text-sm text-zinc-300 font-light leading-relaxed">
            Comida boa
          </p>
          <p className="text-sm text-zinc-300 font-light leading-relaxed">
            em qualquer lugar.
          </p>
        </div>
      </div>

      {/* Bottom Action / Hint */}
      <div className="text-center z-10 pb-4">
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest animate-pulse">
          Toque para continuar
        </p>
      </div>
    </div>
  );
}
