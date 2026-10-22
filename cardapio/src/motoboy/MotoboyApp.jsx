import React, { useEffect, useState } from 'react';
import { AppProvider, useApp } from '../context/AppContext';
import { AppFrame } from '../App';
import { waiterApi } from '../lib/api';
import { Center, Login, Spinner } from '../garcom/GarcomApp';
import { ScreenEntregas } from './ScreenEntregas';
import { ScreenRota } from './ScreenRota';

const SCREENS = { entregas: ScreenEntregas, rota: ScreenRota };

/** app do motoboy em /motoboy: entra com o usuário do ERP (perfil Motoboy) e usa as cores do delivery */
export function MotoboyApp() {
  const [me, setMe] = useState(undefined); // undefined = carregando, null = sem sessão
  useEffect(() => {
    waiterApi.me().then(setMe).catch(() => setMe(null));
  }, []);

  if (me === undefined) return <Center><Spinner /></Center>;
  if (!me) return <Login onLogin={setMe} title="Motoboy" />;
  if (!me.permissions.includes('entrega.realizar')) {
    return (
      <Center>
        <h1 className="text-xl font-black">Sem acesso às entregas</h1>
        <p className="text-sm text-zinc-400">O perfil de {me.user.name} ({me.user.roleLabel}) não faz entregas. Peça ao gerente o perfil Motoboy.</p>
        <button onClick={() => waiterApi.logout().finally(() => location.reload())} className="mt-2 text-sm font-bold underline">
          Entrar com outro usuário
        </button>
      </Center>
    );
  }
  return (
    <AppProvider courier={me}>
      <Shell />
    </AppProvider>
  );
}

function Shell() {
  const { currentScreen, menu } = useApp();
  if (menu.loading) return <Center><Spinner /></Center>;
  if (menu.error) return <Center><h1 className="text-xl font-black">{menu.error}</h1></Center>;
  const Screen = SCREENS[currentScreen] || ScreenEntregas;
  return <AppFrame><Screen /></AppFrame>;
}
