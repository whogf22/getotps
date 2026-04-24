/** PM2: web app + background worker (Tron poller, cleanup, reconciliation). */
module.exports = {
  apps: [
    {
      name: "getotps",
      script: "dist/index.cjs",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      env: { NODE_ENV: "production" },
    },
    {
      name: "getotps-worker",
      script: "dist/worker.cjs",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      env: { NODE_ENV: "production" },
    },
  ],
};
