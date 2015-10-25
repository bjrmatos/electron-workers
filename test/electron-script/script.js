/* eslint-disable */

var http = require('http'),
    app = require('app');

var port = process.env.ELECTRON_WORKER_PORT,
    host = process.env.ELECTRON_WORKER_HOST;

app.on('ready', () => {
  var server = http.createServer((req, res) => {
    res.writeHead(200, {'Content-Type': 'application/json'});
    req.pipe(res);
  });

  server.listen(port, host);
});
