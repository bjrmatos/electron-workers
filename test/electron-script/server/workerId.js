
const http = require('http'),
      // disabling eslint import because `electron` is a buil-in module
      // eslint-disable-next-line import/no-unresolved
      { app } = require('electron');

const port = process.env.ELECTRON_WORKER_PORT,
      host = process.env.ELECTRON_WORKER_HOST,
      workerId = process.env.ELECTRON_WORKER_ID;

app.on('ready', () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(workerId));
  });

  server.listen(port, host);
});
