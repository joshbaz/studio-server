import * as esbuild from 'esbuild';

await esbuild.build({
   entryPoints: ['src/index.ts'],
   platform: 'node',
   bundle: true,
   outdir: 'dist/src',
   sourcemap: true,
   minify: true,
   tsconfig: 'tsconfig.json',
   // outExtension: { '.js': '.cjs' },
});
