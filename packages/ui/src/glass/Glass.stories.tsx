import type { Meta, StoryObj } from '@storybook/react-vite';
import { Glass } from './Glass.tsx';

const meta: Meta<typeof Glass> = {
  title: 'Glass/Surface',
  component: Glass,
  parameters: { still: true },
};
export default meta;

type Story = StoryObj<typeof Glass>;

const panel = { width: 360, height: 220, padding: 24 } as const;

export const Levels: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 32, alignItems: 'center' }}>
      <Glass level={1} style={{ width: 160, height: 120 }} />
      <Glass level={2} style={panel} />
      <Glass level={3} style={{ width: 300, height: 300 }} />
    </div>
  ),
};

export const Interactive: Story = {
  render: () => <Glass level={2} interactive style={panel} />,
};

export const RefractivePills: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <Glass level={1} pill refract interactive style={{ width: 280, height: 56 }} />
      <Glass level={1} pill refract interactive style={{ width: 120, height: 44 }} />
      <Glass level={1} pill interactive style={{ width: 280, height: 56 }} />
    </div>
  ),
};

const CHANNEL_NAMES = [
  'general',
  'voice-lobby',
  'screenshots',
  'off-topic',
  'dev-log',
  'music',
  'announcements',
];
const CHANNELS = Array.from(
  { length: 14 },
  (_, i) => `${CHANNEL_NAMES[i % 7]} · ${12 + i * 7} messages`,
);

/** Refraction is only judgeable over detail: pills float over a column of text. */
export const RefractionOverContent: Story = {
  render: () => (
    <div style={{ position: 'relative', width: 520 }}>
      <div
        style={{
          fontSize: 15,
          lineHeight: '24px',
          color: 'var(--color-text)',
          columns: 2,
          columnGap: 24,
        }}
      >
        {CHANNELS.map((line) => (
          <p key={line} style={{ margin: '0 0 8px' }}>
            {line}
          </p>
        ))}
      </div>
      <Glass
        level={1}
        pill
        refract
        interactive
        style={{ position: 'absolute', left: 40, top: 60, width: 300, height: 64 }}
      />
      <Glass
        level={1}
        pill
        interactive
        style={{ position: 'absolute', left: 140, top: 180, width: 300, height: 64 }}
      />
    </div>
  ),
};
