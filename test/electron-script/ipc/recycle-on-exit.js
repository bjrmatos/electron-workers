/* eslint-disable */

var app = require('app');

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
        response: {
          ok: true
        }
      });
      app.quit();
    }
  });
});
