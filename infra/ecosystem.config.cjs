// PM2 process for auth.hoandat.com on the shared server.
// Usage on the server:
//   cd /var/www/hoandat-auth && pm2 startOrReload infra/ecosystem.config.cjs --update-env && pm2 save
// Environment comes from /var/www/hoandat-auth/.env through Node's --env-file.

module.exports = {
	apps: [
		{
			name: "hoandat-auth",
			script: "dist/server.mjs",
			cwd: "/var/www/hoandat-auth",
			node_args: "--env-file=/var/www/hoandat-auth/.env --enable-source-maps",
			instances: 1,
			exec_mode: "fork",
			autorestart: true,
			// The server exits on purpose when MongoDB or the env is missing;
			// back off instead of spinning.
			exp_backoff_restart_delay: 1000,
			max_memory_restart: "400M",
			kill_timeout: 12000,
			env: {
				NODE_ENV: "production",
			},
		},
	],
};
