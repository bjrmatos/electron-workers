/* eslint-disable */

var http = require('http'),
    app = require('app');

var port = process.env.ELECTRON_WORKER_PORT;

app.on('ready', () => {
  var server = http.createServer((req, res) => {
    res.writeHead(200, {'Content-Type': 'application/json'});
    req.pipe(res);
  });

  server.listen(port);
});
