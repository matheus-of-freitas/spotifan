import { build } from 'esbuild';

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outdir: 'dist',
  sourcemap: true,
  external: [
    '@aws-sdk/client-dynamodb',
    '@aws-sdk/client-lambda',
    '@aws-sdk/client-secrets-manager',
    '@aws-sdk/lib-dynamodb',
  ],
  banner: {
    js: 'import { createRequire } from "module"; const require = createRequire(import.meta.url);',
  },
};

await build({
  ...shared,
  entryPoints: ['src/lambdas/api.ts', 'src/lambdas/syncWorker.ts'],
  outExtension: { '.js': '.mjs' },
});
