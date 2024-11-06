import esbuild from 'esbuild';

const isProduction = process.env.NODE_ENV === 'production';

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
      target: 'node18',
      format: 'cjs',
      logLevel: 'info',
   })
   .then((r) => {
      console.log('✨ Build succeeded.');
      // exit the process
      if (isProduction) {
         process.exit(0);
      }

      // if not production, watch the files
      if (!isProduction) {
         r.watch();
      }
   })
   .catch(() => process.exit(1));
