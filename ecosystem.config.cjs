/** PM2: web app + background worker (Tron poller, cleanup, reconciliation). */
module.exports = {
  apps: [
    {
      name: "getotps-app",
      script: "dist/index.cjs",
      cwd: __dirname,
      instances: "max",
      exec_mode: "cluster",
      max_memory_restart: "400M",
      env: { NODE_ENV: "production" },
    },
    {
      name: "getotps-worker",
      script: "dist/worker.cjs",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "300M",
      env: { NODE_ENV: "production" },
    },
  ],
};
