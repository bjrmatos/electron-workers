/* eslint-disable */

var app = require('app');

var foo = process.env.FOO,
    customEnv = process.env.CUSTOM_ENV;

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
        response: {}
      });
    }
  });
});
