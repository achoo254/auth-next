// PM2 process for auth.hoandat.com on the shared server.
// Each release lives in /var/www/hoandat-auth/releases/<id> with this file; infra/activate-incoming.sh points
// /var/www/hoandat-auth/current at it and runs pm2 start current/infra/ecosystem.config.cjs.
// Environment comes from /var/www/hoandat-auth/.env through Node's --env-file.

module.exports = {
	apps: [
		{
			name: "hoandat-auth",
			script: "dist/server.mjs",
			cwd: "/var/www/hoandat-auth/current",
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
				// IPv6 egress on the server is broken and IPv4 connects can take over 2 s, so Node's default
				// happy eyeballs (250 ms per address) times out: try IPv4 first and give each address 2.5 s.
				NODE_OPTIONS:
					"--dns-result-order=ipv4first --network-family-autoselection-attempt-timeout=2500",
			},
		},
	],
};
