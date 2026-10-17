import closeWithGrace from 'close-with-grace';
import { buildApp } from './app.ts';
import { loadEnv } from './config/env.ts';
import { closeAppContext, createAppContext } from './context.ts';

const env = loadEnv();
const context = await createAppContext(env);
const app = await buildApp(context);

closeWithGrace({ delay: 10_000 }, async ({ err }) => {
  if (err) app.log.error({ err }, 'shutting down after error');
  await app.close();
  await closeAppContext(context);
});

await app.listen({ host: env.HOST, port: env.PORT });
