/* eslint-disable */

var app = require('app');

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
