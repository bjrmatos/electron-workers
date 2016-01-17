/* eslint-disable */

var http = require('http'),
    app = require('app');

var port = process.env.ELECTRON_WORKER_PORT,
    host = process.env.ELECTRON_WORKER_HOST;

app.on('ready', () => {
  setTimeout(() => {
    var server = http.createServer((req, res) => {

    });

    server.listen(port, host);
  }, 2000);
});
