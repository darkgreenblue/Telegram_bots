const path = require('node:path');

const proxyUrl = 'http://127.0.0.1:18759';

module.exports = {
  apps: [{
    name: 'notebook-podcast-proxy',
    cwd: __dirname,
    script: path.join(__dirname, '.proxy/xray'),
    args: ['run', '-config', path.join(__dirname, '.proxy/config.json')],
    interpreter: 'none',
    autorestart: true,
  }, {
    name: 'notebook-podcast',
    cwd: __dirname,
    script: 'bot.py',
    interpreter: path.join(__dirname, '.venv/bin/python'),
    env: {
      HTTP_PROXY: proxyUrl,
      HTTPS_PROXY: proxyUrl,
      http_proxy: proxyUrl,
      https_proxy: proxyUrl,
    },
    autorestart: true,
  }],
};
