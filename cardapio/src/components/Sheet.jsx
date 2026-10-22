import React from 'react';

/** folha que sobe do rodapé (garçom e motoboy): motivo, transferência, fechamento, entrega */
export function Sheet({ label, onCancel, children }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end justify-center" onClick={onCancel}>
      <div
        role="dialog"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[440px] max-h-[90vh] overflow-y-auto bg-[#18181C] rounded-t-3xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] space-y-4 anim-sheet-in"
      >
        {children}
      </div>
    </div>
  );
}

export const inputCls = 'w-full px-3.5 py-2.5 rounded-xl bg-[#0E0E10] border border-[#26262C] text-sm text-white outline-none focus:border-[var(--brand)]';
export const backBtn = 'flex-1 py-3 rounded-2xl text-sm font-bold text-zinc-300 bg-[#0E0E10] border border-[#26262C]';
