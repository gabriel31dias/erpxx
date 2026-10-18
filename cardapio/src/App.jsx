import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2 } from 'lucide-react';
import { useApp } from './context/AppContext';
import { Screen01Splash } from './screens/Screen01Splash';
import { Screen02Onboarding } from './screens/Screen02Onboarding';
import { Screen03Home } from './screens/Screen03Home';
import { Screen04Categoria } from './screens/Screen04Categoria';
import { Screen05DetalheProduto } from './screens/Screen05DetalheProduto';
import { Screen06Carrinho } from './screens/Screen06Carrinho';
import { Screen07Endereco } from './screens/Screen07Endereco';
import { Screen08Pagamento } from './screens/Screen08Pagamento';
import { Screen09PedidoRealizado } from './screens/Screen09PedidoRealizado';
import { Screen10MeusPedidos } from './screens/Screen10MeusPedidos';
import { Screen11Rastreamento } from './screens/Screen11Rastreamento';
import { Screen12Perfil } from './screens/Screen12Perfil';
import { Screen13Favoritos } from './screens/Screen13Favoritos';
import { Screen14Promocoes } from './screens/Screen14Promocoes';
import { Screen15Sobre } from './screens/Screen15Sobre';
import { Screen16Suporte } from './screens/Screen16Suporte';
import { Screen17Configuracoes } from './screens/Screen17Configuracoes';
import { ScreenPix } from './screens/ScreenPix';

export function App() {
  const { currentScreen, menu, slug } = useApp();

  const renderCurrentScreen = () => {
    switch (currentScreen) {
      case 'splash':
        return <Screen01Splash />;
      case 'onboarding':
        return <Screen02Onboarding />;
      case 'home':
        return <Screen03Home />;
      case 'categoria':
        return <Screen04Categoria />;
      case 'detalhe':
        return <Screen05DetalheProduto />;
      case 'carrinho':
        return <Screen06Carrinho />;
      case 'endereco':
        return <Screen07Endereco />;
      case 'pagamento':
        return <Screen08Pagamento />;
      case 'pix':
        return <ScreenPix />;
      case 'pedido_realizado':
        return <Screen09PedidoRealizado />;
      case 'meus_pedidos':
        return <Screen10MeusPedidos />;
      case 'rastreamento':
        return <Screen11Rastreamento />;
      case 'perfil':
        return <Screen12Perfil />;
      case 'favoritos':
        return <Screen13Favoritos />;
      case 'promocoes':
        return <Screen14Promocoes />;
      case 'sobre':
        return <Screen15Sobre />;
      case 'suporte':
        return <Screen16Suporte />;
      case 'configuracoes':
        return <Screen17Configuracoes />;
      default:
        return <Screen03Home />;
    }
  };

  if (menu.loading || menu.error) {
    return (
      <div className="w-full min-h-screen bg-black text-white flex flex-col items-center justify-center gap-3 px-8 text-center font-['Plus_Jakarta_Sans',sans-serif]">
        {menu.loading ? (
          <div className="w-10 h-10 rounded-full border-4 border-white/20 border-t-white animate-spin" />
        ) : (
          <>
            <h1 className="text-xl font-black">{menu.error}</h1>
            <p className="text-sm text-zinc-400">
              {slug
                ? <>Não existe loja com o link <b className="text-white">/{slug}</b>. Confira o link no painel (Minha loja).</>
                : <>Abra o link da loja, por exemplo <b className="text-white">/don-beef</b>.</>}
            </p>
          </>
        )}
      </div>
    );
  }

  return <AppFrame>{renderCurrentScreen()}</AppFrame>;
}

/** casca do app (cliente e garçom): coluna de celular, animação de tela e aviso */
export function AppFrame({ children }) {
  const { currentScreen, menu, toast } = useApp();
  return (
    <div
      style={{ '--brand': menu.store.primary_color }}
      className="w-full min-h-screen bg-[#000000] text-white flex justify-center items-stretch font-['Plus_Jakarta_Sans',sans-serif] antialiased">
      {/* REAL END-USER APP: 100% full screen on mobile, cleanly centered on desktop, ZERO emulators */}
      <main className="w-full max-w-[440px] min-h-screen bg-[#0E0E10] flex flex-col justify-between shadow-2xl relative overflow-hidden">
        {/* key remounts per screen so the CSS entrance animation replays on every navigation */}
        <div key={currentScreen} className={`flex-1 flex flex-col ${currentScreen === 'detalhe' ? 'anim-sheet-in' : 'anim-fade-in'}`}>
          {children}
        </div>
        <AnimatePresence>
          {toast && (
            <motion.div
              key={toast.id}
              role="status"
              initial={{ opacity: 0, y: -24, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -24, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 420, damping: 30 }}
              className="fixed top-3 left-0 right-0 mx-auto w-[calc(100%-2rem)] max-w-[408px] z-[60] bg-emerald-500 text-white rounded-2xl px-4 py-3 flex items-center space-x-2.5 shadow-[0_8px_30px_rgba(16,185,129,0.35)]"
            >
              <CheckCircle2 size={20} className="shrink-0" />
              <span className="text-[13px] font-bold truncate">{toast.text}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
