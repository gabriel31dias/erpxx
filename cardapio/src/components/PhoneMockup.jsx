import React from 'react';

export function PhoneMockup({
  children,
  label = '',
  number = null,
  active = false,
  onClick = null,
  scale = 1,
  width = 280,
  height = 580,
  className = ''
}) {
  return (
    <div className={`flex flex-col items-center select-none ${className}`}>
      {/* Phone Hardware Shell */}
      <div
        onClick={onClick}
        style={{
          width: `${width * scale}px`,
          height: `${height * scale}px`,
          transformOrigin: 'top center',
        }}
        className={`relative bg-[#000000] rounded-[44px] p-[10px] shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9),0_0_0_1px_rgba(255,255,255,0.12)] transition-all duration-300 ${
          active
            ? 'ring-2 ring-[var(--brand)] shadow-lg'
            : 'hover:shadow-[0_30px_70px_-10px_rgba(0,0,0,1),0_0_0_1px_rgba(255,255,255,0.2)]'
        } ${onClick ? 'cursor-pointer hover:scale-[1.015]' : ''}`}
      >
        {/* Outer Titanium Rim */}
        <div className="absolute inset-0 rounded-[44px] border-[2px] border-zinc-700/60 pointer-events-none" />

        {/* Dynamic Island / Top Speaker Notch */}
        <div className="absolute top-[14px] left-1/2 -translate-x-1/2 w-20 h-5 bg-black rounded-full z-40 flex items-center justify-between px-2.5 pointer-events-none">
          <div className="w-2.5 h-2.5 rounded-full bg-[#111115] flex items-center justify-center">
            <div className="w-1.5 h-1.5 rounded-full bg-[#0a0a1f]/80" />
          </div>
          <div className="w-2 h-2 rounded-full bg-emerald-500/80 opacity-0" />
        </div>

        {/* Screen Bezel & Screen Content Container */}
        <div className="relative w-full h-full bg-[#121212] rounded-[34px] overflow-hidden flex flex-col justify-between">
          {children}

          {/* Bottom Home Indicator Bar */}
          <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-28 h-1 bg-white/40 rounded-full z-40 pointer-events-none" />
        </div>
      </div>

      {/* Screen Label (Matching Mockup text: "1. Splash", "2. Onboarding", etc.) */}
      {label && (
        <div className="mt-3.5 text-center">
          <span className="text-xs font-medium text-zinc-400 tracking-wide">
            {number ? `${number}. ` : ''}{label}
          </span>
        </div>
      )}
    </div>
  );
}
