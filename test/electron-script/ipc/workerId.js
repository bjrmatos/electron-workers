/* eslint-disable */

var http = require('http'),
    app = require('app');

var workerId = process.env.ELECTRON_WORKER_ID;

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
        response: workerId
      });
    }
  });
});
