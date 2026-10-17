import type { Decorator, Preview } from '@storybook/react-vite';
import { useEffect } from 'react';
import '../src/styles/global.css';
import { AmbientLayer } from '../src/ambient/AmbientLayer.tsx';
import { GlassQualityProvider } from '../src/glass/glass-quality.tsx';
import { MotionPreferences } from '../src/motion/motion-preferences.tsx';
import { themeById } from '../src/themes/index.ts';
import { applyTheme } from '../src/tokens/css-variables.ts';
import type { GlassQuality } from '../src/tokens/theme.ts';

/** Every story renders on the real ambient layer, in the selected theme and glass tier. */
const withGlassEnvironment: Decorator = (Story, context) => {
  const theme = themeById(String(context.globals['theme'] ?? 'aurora'));
  const quality = (context.globals['tier'] ?? 'high') as GlassQuality;
  const still = context.globals['still'] === true || context.parameters['still'] === true;
  useEffect(() => applyTheme(document.documentElement, theme), [theme]);
  return (
    <GlassQualityProvider quality={quality}>
      <MotionPreferences intensity={1}>
        <AmbientLayer theme={theme} still={still} />
        <div
          style={{
            position: 'relative',
            zIndex: 1,
            minHeight: '100vh',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <div data-story-subject="" style={{ padding: 24 }}>
            <Story />
          </div>
        </div>
      </MotionPreferences>
    </GlassQualityProvider>
  );
};

const preview: Preview = {
  decorators: [withGlassEnvironment],
  parameters: { layout: 'fullscreen', controls: { expanded: true } },
  globalTypes: {
    theme: {
      description: 'Theme',
      toolbar: {
        icon: 'paintbrush',
        items: ['aurora', 'frost', 'midnight-ember'],
        dynamicTitle: true,
      },
    },
    tier: {
      description: 'Glass tier',
      toolbar: { icon: 'mirror', items: ['high', 'low', 'solid', 'auto'], dynamicTitle: true },
    },
  },
  initialGlobals: { theme: 'aurora', tier: 'high' },
};

export default preview;
