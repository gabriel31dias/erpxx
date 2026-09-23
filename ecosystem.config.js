// PM2: `pm2 start ecosystem.config.js && pm2 save` — o pm2-root.service sobe no boot.
module.exports = {
  apps: [
    {
      name: 'lojaflow',
      cwd: __dirname,
      script: 'dist/main.js',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '512M',
      time: true,
    },
  ],
};
