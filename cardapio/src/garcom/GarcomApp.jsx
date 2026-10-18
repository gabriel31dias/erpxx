import React, { useEffect, useState } from 'react';
import { AppProvider, useApp } from '../context/AppContext';
import { AppFrame } from '../App';
import { waiterApi } from '../lib/api';
import { Screen04Categoria } from '../screens/Screen04Categoria';
import { Screen05DetalheProduto } from '../screens/Screen05DetalheProduto';
import { Screen06Carrinho } from '../screens/Screen06Carrinho';
import { ScreenMesas } from './ScreenMesas';
import { ScreenComanda } from './ScreenComanda';

const SCREENS = {
  mesas: ScreenMesas,
  comanda: ScreenComanda,
  categoria: Screen04Categoria,
  detalhe: Screen05DetalheProduto,
  carrinho: Screen06Carrinho,
};

const Center = ({ children }) => (
  <div className="w-full min-h-screen bg-black text-white flex flex-col items-center justify-center gap-3 px-8 text-center font-['Plus_Jakarta_Sans',sans-serif]">
    {children}
  </div>
);
const Spinner = () => <div className="w-10 h-10 rounded-full border-4 border-white/20 border-t-white animate-spin" />;

/** app do garçom em /garcom: entra com o usuário do ERP e reaproveita catálogo e carrinho do cardápio */
export function GarcomApp() {
  const [me, setMe] = useState(undefined); // undefined = carregando, null = sem sessão
  useEffect(() => {
    waiterApi.me().then(setMe).catch(() => setMe(null));
  }, []);

  if (me === undefined) return <Center><Spinner /></Center>;
  if (!me) return <Login onLogin={setMe} />;
  if (!me.permissions.includes('mesa.atender')) {
    return (
      <Center>
        <h1 className="text-xl font-black">Sem acesso às mesas</h1>
        <p className="text-sm text-zinc-400">O perfil de {me.user.name} ({me.user.roleLabel}) não atende mesas. Peça ao gerente o perfil Garçom.</p>
        <button onClick={() => waiterApi.logout().finally(() => location.reload())} className="mt-2 text-sm font-bold underline">
          Entrar com outro usuário
        </button>
      </Center>
    );
  }
  return (
    <AppProvider waiter={me}>
      <Shell />
    </AppProvider>
  );
}

function Shell() {
  const { currentScreen, menu } = useApp();
  if (menu.loading) return <Center><Spinner /></Center>;
  if (menu.error) return <Center><h1 className="text-xl font-black">{menu.error}</h1></Center>;
  const Screen = SCREENS[currentScreen] || ScreenMesas;
  return <AppFrame><Screen /></AppFrame>;
}

function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await waiterApi.login(email.trim(), password);
      onLogin(await waiterApi.me());
    } catch (err) {
      // login de aprovador da plataforma passa no /login mas não tem empresa: cai aqui também
      setError(err.message);
      setBusy(false);
    }
  };

  const input = 'w-full px-4 py-3 rounded-xl bg-[#18181C] border border-[#26262C] text-sm text-white placeholder:text-zinc-500 outline-none focus:border-white';
  return (
    <Center>
      <form onSubmit={submit} className="w-full max-w-[340px] space-y-3 text-left">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-black tracking-tight">Garçom</h1>
          <p className="text-sm text-zinc-400 mt-1">Entre com seu usuário do sistema</p>
        </div>
        <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail" aria-label="E-mail" className={input} />
        <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Senha" aria-label="Senha" className={input} />
        {error && <p className="text-xs font-semibold text-red-400">{error}</p>}
        <button disabled={busy} className="w-full py-3.5 rounded-2xl bg-white text-zinc-900 font-bold text-sm active:scale-[0.98] transition disabled:opacity-50">
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </Center>
  );
}
