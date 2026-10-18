import React from 'react';
import { useApp } from '../context/AppContext';

export function SaboriaLogo({ size = 'medium', showTagline = false, className = '' }) {
  const isLarge = size === 'large';
  const isSmall = size === 'small';
  const { storeInfo } = useApp();

  return (
    <div className={`flex flex-col items-center justify-center text-center ${className}`}>
      {storeInfo?.logo_url ? (
        <img
          src={storeInfo.logo_url}
          alt=""
          className={`object-contain ${isLarge ? 'w-20 h-20 mb-3' : isSmall ? 'w-10 h-10 mb-1' : 'w-12 h-12 mb-2'}`}
        />
      ) : (
        <>
      {/* Chef Hat Icon */}
      <div className={`relative ${isLarge ? 'w-20 h-20 mb-3' : isSmall ? 'w-8 h-8 mb-1' : 'w-12 h-12 mb-2'}`}>
        <svg
          viewBox="0 0 100 100"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-full shadow-lg"
        >
          {/* Chef Hat Puffs */}
          <path
            d="M50 16C38 16 32 23 32 32C26 34 22 39 24 47C25.5 52 30 55 35 55C36 55 37 54.8 38 54.5C41 59 45.5 61 50 61C54.5 61 59 59 62 54.5C63 54.8 64 55 65 55C70 55 74.5 52 76 47C78 39 74 34 68 32C68 23 62 16 50 16Z"
            fill="var(--brand)"
            stroke="#FF3B47"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
          {/* Hat Band */}
          <path
            d="M34 65H66C68.2 65 70 66.8 70 69C70 71.2 68.2 73 66 73H34C31.8 73 30 71.2 30 69C30 66.8 31.8 65 34 65Z"
            fill="var(--brand)"
            stroke="#FF3B47"
            strokeWidth="1.5"
          />
          {/* Band Buttons */}
          <circle cx="42" cy="69" r="2" fill="#FFFFFF" />
          <circle cx="50" cy="69" r="2" fill="#FFFFFF" />
          <circle cx="58" cy="69" r="2" fill="#FFFFFF" />
        </svg>
      </div>

        </>
      )}

      {/* Brand Name */}
      <div className="flex items-baseline justify-center tracking-tight">
        <span className={`font-extrabold text-white font-['Plus_Jakarta_Sans',sans-serif] ${
          isLarge ? 'text-4xl' : isSmall ? 'text-lg' : 'text-2xl'
        }`}>
          {storeInfo?.name}
        </span>
      </div>

      {/* Subtitle */}
      <span className={`text-zinc-300 font-medium tracking-wide ${
        isLarge ? 'text-sm mt-1' : isSmall ? 'text-[9px]' : 'text-xs mt-0.5'
      }`}>
        {storeInfo?.subtitle || 'Cardápio Digital'}
      </span>

      {showTagline && (
        <p className="mt-8 text-zinc-300 text-sm font-light leading-relaxed max-w-[200px] text-center italic">
          Comida boa<br />em qualquer lugar.
        </p>
      )}
    </div>
  );
}
