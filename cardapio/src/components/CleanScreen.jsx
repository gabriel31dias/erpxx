import React from 'react';

export function CleanScreen({
  children,
  label = '',
  number = null,
  active = false,
  onClick = null,
  scale = 1,
  width = 240,
  height = 510,
  className = '',
  aspectRatio = '19.5/9',
  border = true
}) {
  return (
    <div className={`flex flex-col items-center select-none ${className}`}>
      {/* PURE SCREEN CARD: No phone frame, no chassis, no emulator bezel, no fake plastic hardware */}
      <div
        onClick={onClick}
        style={{
          width: `${width * scale}px`,
          height: `${height * scale}px`,
          transformOrigin: 'top center',
        }}
        className={`relative bg-[#0F0F11] overflow-hidden flex flex-col justify-between transition-all duration-150 rounded-2xl ${
          border ? 'border border-[#26262A] shadow-2xl shadow-black/80' : ''
        } ${
          active ? 'ring-2 ring-[var(--brand)] shadow-lg' : ''
        } ${
          onClick ? 'cursor-pointer hover:border-zinc-500 hover:scale-[1.01]' : ''
        }`}
      >
        {children}
      </div>

      {/* Screen Label (Matching reference image: "1. Splash", "2. Onboarding", etc.) */}
      {label && (
        <div className="mt-3 text-center">
          <span className="text-xs font-semibold text-zinc-300 tracking-wide font-['Plus_Jakarta_Sans',sans-serif]">
            {number ? `${number}. ` : ''}{label}
          </span>
        </div>
      )}
    </div>
  );
}
