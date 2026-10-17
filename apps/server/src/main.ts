import closeWithGrace from 'close-with-grace';
import { buildApp } from './app.ts';
import { loadEnv } from './config/env.ts';

const env = loadEnv();
const app = buildApp(env);

closeWithGrace({ delay: 10_000 }, async ({ err }) => {
  if (err) app.log.error({ err }, 'shutting down after error');
  await app.close();
});

await app.listen({ host: env.HOST, port: env.PORT });
