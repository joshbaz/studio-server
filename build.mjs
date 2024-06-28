import * as esbuild from 'esbuild';

await esbuild.build({
   entryPoints: ['src/index.js'],
   platform: 'node',
   bundle: true,
   outdir: 'dist/src',
   sourcemap: true,
   minify: true,
   outExtension: { '.js': '.cjs' },
});
