const path = require('node:path');

module.exports = {
  apps: [{
    name: 'notebook-podcast',
    cwd: __dirname,
    script: 'bot.py',
    interpreter: path.join(__dirname, '.venv/bin/python'),
    autorestart: true,
  }],
};
