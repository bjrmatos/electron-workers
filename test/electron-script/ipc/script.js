/* eslint-disable */

var app = require('app');

if (!process.send) {
  app.quit();
}

app.on('ready', () => {
  process.on('message', (data) => {
    if (!data) {
      return;
    }

    if (data.workerEvent === 'ping') {
      process.send({ workerEvent: 'pong' });
    } else if (data.workerEvent === 'task') {
      process.send({
        workerEvent: 'taskResponse',
        taskId: data.taskId,
        response: data.payload
      });
    }
  });
});
