/* eslint-disable */

var http = require('http'),
    app = require('app');

var port = process.env.ELECTRON_WORKER_PORT,
    host = process.env.ELECTRON_WORKER_HOST;

app.on('ready', () => {
  var server = http.createServer((req, res) => {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify(process.argv.slice(2)));
  });

  server.listen(port, host);
});
