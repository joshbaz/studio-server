import esbuild from 'esbuild';

esbuild
   .context({
      entryPoints: ['src/index.mjs'],
      alias: {
         '@/*': './src/*',
      },
      platform: 'node',
      bundle: true,
      outdir: 'dist',
      sourcemap: true,
      minify: true,
      outExtension: { '.js': '.cjs' },
      target: 'node14',
      format: 'cjs',
      logLevel: 'info',
   })
   .then((r) => {
      console.log('✨ Build succeeded.');
      r.watch();
      console.log('watching files...');
   })
   .catch(() => process.exit(1));
