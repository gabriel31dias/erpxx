import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { dragScroll } from '../lib/dragScroll';

// lista horizontal com flechinha de cada lado enquanto ainda houver o que rolar pra aquele lado
export function ScrollRow({ className = '', children }) {
  const ref = useRef(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const update = () => {
    const el = ref.current;
    if (el) setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  };
  useEffect(() => {
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [children]);

  return (
    <div className="relative">
      <div
        ref={ref}
        {...dragScroll}
        onScroll={update}
        className={`flex items-center space-x-2 overflow-x-auto scrollbar-none cursor-grab active:cursor-grabbing ${className}`}
      >
        {children}
      </div>
      <Arrow side="left" show={edges.left} onClick={() => ref.current.scrollBy({ left: -160, behavior: 'smooth' })} />
      <Arrow side="right" show={edges.right} onClick={() => ref.current.scrollBy({ left: 160, behavior: 'smooth' })} />
    </div>
  );
}

function Arrow({ side, show, onClick }) {
  const left = side === 'left';
  const Icon = left ? ChevronLeft : ChevronRight;
  return (
    <button
      aria-label={left ? 'Ver categorias anteriores' : 'Ver mais categorias'}
      tabIndex={show ? 0 : -1}
      onClick={onClick}
      className={`absolute inset-y-0 w-12 flex items-center to-transparent transition-opacity duration-200 ${
        left ? 'left-0 justify-start bg-gradient-to-r' : 'right-0 justify-end bg-gradient-to-l'
      } from-white via-white/90 ${show ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
    >
      <span className={`w-6 h-6 rounded-full bg-white shadow-md border border-slate-100 flex items-center justify-center ${left ? 'animate-nudge-left' : 'animate-nudge'}`}>
        <Icon size={15} className="text-slate-700 stroke-[2.5]" />
      </span>
    </button>
  );
}
