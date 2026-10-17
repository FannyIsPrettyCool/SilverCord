import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Glass } from '../glass/Glass.tsx';
import { Button } from './Button.tsx';
import { Checkbox } from './Checkbox.tsx';
import { IconButton } from './IconButton.tsx';
import { TextField } from './TextField.tsx';

const meta: Meta = { title: 'Controls/All', parameters: { still: true } };
export default meta;

function Gear() {
  return (
    <svg width="18" height="18" viewBox="0 0 256 256" aria-hidden="true">
      <path
        fill="currentColor"
        d="M128 80a48 48 0 1 0 48 48 48.05 48.05 0 0 0-48-48Zm0 80a32 32 0 1 1 32-32 32 32 0 0 1-32 32Z"
      />
    </svg>
  );
}

function AuthCard() {
  const [agreed, setAgreed] = useState(true);
  return (
    <Glass level={3} style={{ width: 400, padding: 32, display: 'grid', gap: 20 }}>
      <h1
        style={{
          margin: 0,
          fontSize: 'var(--text-2xl)',
          lineHeight: 'var(--leading-2xl)',
          fontWeight: 680,
        }}
      >
        Sign in
      </h1>
      <TextField label="Email or username" defaultValue="fanny" autoComplete="username" />
      <TextField
        label="Password"
        type="password"
        defaultValue="hunter2hunter2"
        error="Invalid login or password"
      />
      <Checkbox checked={agreed} onCheckedChange={setAgreed}>
        I am at least 15 years old
      </Checkbox>
      <Button fullWidth>Sign in</Button>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <Button variant="quiet">Create account</Button>
        <Button variant="quiet">Forgot password?</Button>
      </div>
    </Glass>
  );
}

export const Auth: StoryObj = { render: () => <AuthCard /> };

export const Buttons: StoryObj = {
  render: () => (
    <Glass level={2} style={{ padding: 24, display: 'flex', gap: 12, alignItems: 'center' }}>
      <Button>Sign in</Button>
      <Button loading>Sign in</Button>
      <Button disabled>Sign in</Button>
      <Button variant="quiet">Cancel</Button>
      <IconButton label="Settings">
        <Gear />
      </IconButton>
    </Glass>
  ),
};
