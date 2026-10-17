import type { Configuration } from 'electron-builder';

/**
 * Packaging (BRIEF §9.5). Fuses are flipped at package time (BRIEF §8.2); `pnpm test:package`
 * verifies them on the unpacked build.
 */
const config: Configuration = {
  appId: 'app.silvercord.desktop',
  productName: 'SilverCord',
  executableName: 'silvercord',
  copyright: 'Copyright © 2026 SilverCord. All rights reserved.',
  directories: { output: 'release', buildResources: 'resources' },
  files: ['out/**', 'resources/**', 'package.json'],
  asar: true,
  electronFuses: {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    grantFileProtocolExtraPrivileges: false,
  },
  protocols: [{ name: 'SilverCord', schemes: ['silvercord'] }],
  win: { target: ['nsis'], icon: 'resources/icon.png' },
  nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true },
  linux: {
    target: ['AppImage', 'deb', 'rpm'],
    icon: 'resources/icon.png',
    category: 'Network;InstantMessaging;Chat;',
    maintainer: 'SilverCord',
  },
};

export default config;
