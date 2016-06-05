
// disabling eslint import because `electron` is a buil-in module
// eslint-disable-next-line import/no-unresolved
const { app } = require('electron');

app.on('ready', () => {
  setTimeout(() => {
    process.on('message', (data) => {
      if (!data) {
        return;
      }

      if (data.workerEvent === 'ping') {
        process.send({ workerEvent: 'pong' });
      }
    });
  }, 2000);
});
