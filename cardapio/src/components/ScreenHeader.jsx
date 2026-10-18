import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { useApp } from '../context/AppContext';

export function ScreenHeader({
  title,
  showBack = true,
  onBack,
  rightElement = null,
  transparent = false,
  className = ''
}) {
  const { goBack } = useApp();

  const handleBack = () => {
    if (onBack) onBack();
    else goBack();
  };

  return (
    <div className={`w-full px-4 py-3 flex items-center justify-between shrink-0 z-20 ${
      transparent ? 'bg-transparent' : 'bg-[#121212]'
    } ${className}`}>
      {/* Left Back Button */}
      <div className="w-9 flex items-center">
        {showBack && (
          <button
            onClick={handleBack}
            className="w-8 h-8 rounded-full flex items-center justify-center text-white hover:bg-zinc-800/80 active:scale-90 transition-transform"
            aria-label="Voltar"
          >
            <ArrowLeft size={20} className="stroke-[2.2]" />
          </button>
        )}
      </div>

      {/* Center Title */}
      <div className="flex-1 text-center">
        {title && (
          <h1 className="text-base font-semibold text-white tracking-tight truncate">
            {title}
          </h1>
        )}
      </div>

      {/* Right Action */}
      <div className="w-9 flex items-center justify-end">
        {rightElement}
      </div>
    </div>
  );
}
