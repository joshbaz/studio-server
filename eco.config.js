module.exports = {
   apps: [
      {
         name: 'nyatiApi',
         script: './api/app.js',
         instances: 'max', // Use all available CPU cores (for clustering)
         exec_mode: 'cluster', // Cluster mode for better performance
         watch: false,
         env: {
            NODE_ENV: 'development',
            PORT: 3000,
         },
         env_production: {
            NODE_ENV: 'production',
            PORT: 8000, // Specify the production port
         },
      },
      {
         name: 'nyati-studio',
         script: './studio/dist/index.cjs',
         instances: 'max', // Use all available CPU cores (for clustering)
         exec_mode: 'cluster', // Cluster mode for better performance
         watch: false,
         env: {
            NODE_ENV: 'production',
            PORT: 5000,
         },
      },
   ],

   deploy: {
      production: {
         user: 'sevadmin',
         host: '157.230.122.94',
         ref: 'origin/master',
         repo: 'https://github.com/joshbaz/MoMo-API.git',
         path: '/var/www/api',
         'pre-deploy-local': '',
         'post-deploy':
            'npm install && pm2 reload ecosystem.config.js --env production',
         'pre-setup': '',
      },
   },
};
