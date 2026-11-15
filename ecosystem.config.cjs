// پیکربندی PM2 برای اجرای دائمی سرور «رصد خبر».
// اجرا:  npx pm2 start ecosystem.config.cjs && npx pm2 save
// لاگ‌ها:  npx pm2 logs news-radar
const path = require('node:path');

module.exports = {
  apps: [
    {
      name: 'news-radar',
      script: 'server.mjs',
      cwd: __dirname,
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_restarts: 30,
      min_uptime: '30s',
      restart_delay: 3000,
      exp_backoff_restart_delay: 500,
      kill_timeout: 5000,
      time: true,
      env: {
        PORT: '3001',
        UPDATE_INTERVAL_MINUTES: '30',
        NODE_ENV: 'production',
      },
      out_file: path.join(__dirname, 'logs', 'pm2-out.log'),
      error_file: path.join(__dirname, 'logs', 'pm2-error.log'),
      merge_logs: true,
    },
  ],
};
