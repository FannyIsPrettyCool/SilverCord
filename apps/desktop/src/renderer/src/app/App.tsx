import {
  AmbientLayer,
  applyTheme,
  GlassQualityProvider,
  MotionPreferences,
  themeById,
} from '@silvercord/ui';
import { RouterProvider } from '@tanstack/react-router';
import { useEffect, useMemo } from 'react';
import { TitleBar } from '../features/shell/TitleBar.tsx';
import { useGatewayConnection } from '../gateway/use-gateway-connection.ts';
import { useSession } from '../session/session-store.ts';
import { router } from './router.tsx';

/** Visual preferences come from settings in phase 7; until then, theme and tier can be forced for screenshots. */
function usePreferences() {
  return useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return {
      theme: themeById(params.get('theme') ?? 'aurora'),
      quality: (params.get('tier') ?? 'auto') as 'auto' | 'high' | 'low' | 'solid',
      still: params.has('still'),
    };
  }, []);
}

export function App() {
  const { theme, quality, still } = usePreferences();
  const status = useSession((s) => s.status);
  useGatewayConnection();

  useEffect(() => applyTheme(document.documentElement, theme), [theme]);
  useEffect(() => {
    if (status === 'signed-in' || status === 'signed-out') void router.invalidate();
  }, [status]);

  return (
    <GlassQualityProvider quality={quality}>
      <MotionPreferences intensity={theme.motionIntensity}>
        <AmbientLayer theme={theme} still={still} />
        <TitleBar />
        {status === 'restoring' ? null : <RouterProvider router={router} />}
      </MotionPreferences>
    </GlassQualityProvider>
  );
}
