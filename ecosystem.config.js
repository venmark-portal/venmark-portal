module.exports = {
  apps: [{
    name: 'venmark',
    script: 'node_modules/.bin/next',
    args: 'start -p 3000',
    cwd: '/var/www/venmark',
    env: {
      NODE_ENV: 'production',
    },
    env_file: '/var/www/venmark/.env.local',
  }]
}
