import closeWithGrace from 'close-with-grace';
import { buildApp } from './app.ts';
import { loadEnv } from './config/env.ts';
import { createRateLimiter } from './infra/rate-limiter.ts';
import { createValkey } from './infra/valkey.ts';

const env = loadEnv();
const valkey = createValkey(env.VALKEY_URL);
await valkey.connect();
const app = await buildApp(env, { rateLimiter: createRateLimiter(valkey) });

closeWithGrace({ delay: 10_000 }, async ({ err }) => {
  if (err) app.log.error({ err }, 'shutting down after error');
  await app.close();
  await valkey.quit();
});

await app.listen({ host: env.HOST, port: env.PORT });
