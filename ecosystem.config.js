// PM2 프로세스 정의.
// nginx(news.aibaseclub.com) 가 127.0.0.1:3012 로 프록시하므로 포트는 3012 고정.
// 기동:   pm2 start ecosystem.config.js && pm2 save
// 재배포: npm run build && pm2 reload ainews
module.exports = {
  apps: [
    {
      name: "ainews",
      cwd: "/home/swingken/project/AiNews",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3012",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      env: {
        NODE_ENV: "production",
        PORT: "3012",
      },
    },
  ],
};
