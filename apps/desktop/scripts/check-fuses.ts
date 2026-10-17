import { join } from 'node:path';
import { FuseState, FuseV1Options, getCurrentFuseWire } from '@electron/fuses';

/** Fails unless every fuse in BRIEF §8.2 is in its hardened state on the unpacked build. */
const EXPECTED: [FuseV1Options, boolean][] = [
  [FuseV1Options.RunAsNode, false],
  [FuseV1Options.EnableCookieEncryption, true],
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable, false],
  [FuseV1Options.EnableNodeCliInspectArguments, false],
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, true],
  [FuseV1Options.OnlyLoadAppFromAsar, true],
  [FuseV1Options.GrantFileProtocolExtraPrivileges, false],
];

const binary =
  process.platform === 'win32'
    ? join('release', 'win-unpacked', 'SilverCord.exe')
    : join('release', 'linux-unpacked', 'silvercord');

const wire = await getCurrentFuseWire(binary);
const failures = EXPECTED.filter(
  ([fuse, enabled]) => wire[fuse] !== (enabled ? FuseState.ENABLE : FuseState.DISABLE),
);
for (const [fuse, enabled] of failures) {
  process.stderr.write(
    `fuse ${FuseV1Options[fuse]} should be ${enabled ? 'enabled' : 'disabled'}\n`,
  );
}
if (failures.length > 0) process.exit(1);
process.stdout.write(`all ${EXPECTED.length} fuses hardened in ${binary}\n`);
