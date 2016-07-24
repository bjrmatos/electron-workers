
// disabling eslint import because `electron` is a buil-in module
// eslint-disable-next-line import/no-unresolved
const { app } = require('electron');

const JOB_DURATION_MS = parseInt(process.env.JOB_DURATION_MS, 10);

app.on('ready', () => {
  // first you will need to listen the `message` event in the process object
  process.on('message', (data) => {
    if (!data) {
      return;
    }

    if (data.workerEvent === 'ping') {
      process.send({ workerEvent: 'pong' });
    } else if (data.workerEvent === 'task') {
      let started = Date.now();

      // simulate 500ms duration
      setTimeout(() => {
        process.send({
          workerEvent: 'taskResponse',
          taskId: data.taskId,
          response: {
            started,
            ended: Date.now()
          }
        });
      }, JOB_DURATION_MS);
    }
  });
});
