
const http = require('http'),
      // disabling eslint import because `electron` is a buil-in module
      // eslint-disable-next-line import/no-unresolved
      { app } = require('electron');

const port = process.env.ELECTRON_WORKER_PORT,
      JOB_DURATION_MS = parseInt(process.env.JOB_DURATION_MS, 10);

app.on('ready', () => {
  const server = http.createServer((req, res) => {
    let started = Date.now();

    res.writeHead(200, { 'Content-Type': 'application/json' });

    // simulate 500ms duration
    setTimeout(() => {
      res.end(JSON.stringify({
        started,
        ended: Date.now()
      }));
    }, JOB_DURATION_MS);
  });

  server.listen(port);
});
