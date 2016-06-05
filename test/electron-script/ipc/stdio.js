
// disabling eslint import because `electron` is a buil-in module
// eslint-disable-next-line import/no-unresolved
const { app } = require('electron');

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
