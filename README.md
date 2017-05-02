electron-workers
================

[![NPM Version](http://img.shields.io/npm/v/electron-workers.svg?style=flat-square)](https://npmjs.com/package/electron-workers)[![License](http://img.shields.io/npm/l/electron-workers.svg?style=flat-square)](http://opensource.org/licenses/MIT)[![Build Status](https://travis-ci.org/bjrmatos/electron-workers.png?branch=master)](https://travis-ci.org/bjrmatos/electron-workers)

> **Run electron scripts in managed workers**

This module lets you run an electron script with scalability in mind, useful if you have to rely on electron to do heavy or long running tasks in parallel (web scraping, taking screenshots, generating PDFs, etc).

*Works in electron@>=0.35.x including electron@1.x.x*

Requeriments
------------

-	Install [electron](http://electron.atom.io/) >= 0.35.x including electron@1, the easy way to install
electron in your app is `npm install electron --save` or `npm install electron-prebuilt --save`
(or you can pass the path to your `electron` executable using the `pathToElectron` option, see [options](#options))


Modes
-----

There are two ways to communicate and distribute tasks between workers, each mode has its own way to use.

-	`server` -> Communication and task distribution will be doing using an embedded web server inside the electron process.
-	`ipc` -> Communication and task distribution will be doing using an ipc channel.

The best mode to use will depend of how your electron app is implemented, however the recommended option is to use the `ipc` mode.

### How to use server mode

1.- First create an electron script wrapped in a webserver

*script.js*

```js
var http = require('http'),
    app = require('electron').app;

// every worker gets unique port, get it from a process environment variables
var port = process.env.ELECTRON_WORKER_PORT,
    host = process.env.ELECTRON_WORKER_HOST,
    workerId = process.env.ELECTRON_WORKER_ID; // worker id useful for logging

console.log('Hello from worker', workerId);

app.on('ready', function() {
  // you can use any webserver library/framework you like (connect, express, hapi, etc)
  var server = http.createServer(function(req, res) {
    // You can respond with a status `500` if you want to indicate that something went wrong
    res.writeHead(200, {'Content-Type': 'application/json'});
    // data passed to `electronWorkers.execute` will be available in req body
    req.pipe(res);
  });

  server.listen(port, host);
});
```

2.- Start electron workers

```js
var electronWorkers = require('electron-workers')({
  connectionMode: 'server',
  pathToScript: 'script.js',
  timeout: 5000,
  numberOfWorkers: 5
});

electronWorkers.start(function(startErr) {
  if (startErr) {
    return console.error(startErr);
  }

  // `electronWorkers` will send your data in a POST request to your electron script
  electronWorkers.execute({ someData: 'someData' }, function(err, data) {
    if (err) {
      return console.error(err);
    }

    console.log(JSON.stringify(data)); // { someData: 'someData' }
    electronWorkers.kill(); // kill all workers explicitly
  });
});
```

### How to use ipc mode

1.- First create an electron script

You will have an ipc channel available, what this means is that you can use `process.send`, and listen `process.on('message', function() {})` inside your script

*script.js*

```js
var app = require('electron').app;

var workerId = process.env.ELECTRON_WORKER_ID; // worker id useful for logging

console.log('Hello from worker', workerId);

app.on('ready', function() {
  // first you will need to listen the `message` event in the process object
  process.on('message', function(data) {
    if (!data) {
      return;
    }

    // `electron-workers` will try to verify is your worker is alive sending you a `ping` event
    if (data.workerEvent === 'ping') {
      // responding the ping call.. this will notify `electron-workers` that your process is alive
      process.send({ workerEvent: 'pong' });
    } else if (data.workerEvent === 'task') { // when a new task is executed, you will recive a `task` event


      console.log(data); //data -> { workerEvent: 'task', taskId: '....', payload: <whatever you have passed to `.execute`> }

      console.log(data.payload.someData); // -> someData

      // you can do whatever you want here..

      // when the task has been processed,
      // respond with a `taskResponse` event, the `taskId` that you have received, and a custom `response`.
      // You can specify an `error` field if you want to indicate that something went wrong
      process.send({
        workerEvent: 'taskResponse',
        taskId: data.taskId,
        response: {
          value: data.payload.someData
        }
      });
    }
  });
});
```

2.- Start electron workers

```js
var electronWorkers = require('electron-workers')({
  connectionMode: 'ipc',
  pathToScript: 'script.js',
  timeout: 5000,
  numberOfWorkers: 5
});

electronWorkers.start(function(startErr) {
  if (startErr) {
    return console.error(startErr);
  }

  // `electronWorkers` will send your data in a POST request to your electron script
  electronWorkers.execute({ someData: 'someData' }, function(err, data) {
    if (err) {
      return console.error(err);
    }

    console.log(JSON.stringify(data)); // { value: 'someData' }
    electronWorkers.kill(); // kill all workers explicitly
  });
});
```

Options
-------

`connectionMode` - `server`, `ipc` mode, defaults to `server` mode if no specified.`pathToScript` (required) - path to the electron script.

`pathToElectron` - path to the electron executable, by default we will try to find the path using the value returned from the `electron` or `electron-prebuilt` packages (if any of them are found), otherwhise we will try to find it in your `$PATH` env var.

`debug` Number - pass debug port to electron process,[see electron's debugging guide](http://electron.atom.io/docs/v0.34.0/tutorial/debugging-main-process/).

`debugBrk` Number - pass debug-brk port to electron process, [see electron's debugging guide](http://electron.atom.io/docs/v0.34.0/tutorial/debugging-main-process/)

`electronArgs` Array - pass custom arguments to the electron executable. ej: `electronArgs: ['--some-value=2', '--enable-some-behaviour']`.

`env` Object - pass custom env vars to workers. ej: `env: { CUSTOM_ENV: 'foo' }`.

`stdio` pass custom stdio option to worker's child process. see [node.js documentation](https://nodejs.org/api/child_process.html#child_process_options_stdio) for details.

`killSignal` String - when calling `electronWorkers.kill()` this value will be used to [kill the child process](https://nodejs.org/api/child_process.html#child_process_child_kill_signal) attached to the worker. see node.js docs for [more info on signal events](https://nodejs.org/api/process.html#process_signal_events)

`pingTimeout` Number - time in ms to wait for worker response in order to be considered alive, note that we retry the ping to a worker several times, this value is the interval between those pings. Default: 100

`timeout` - execution timeout in ms.

`numberOfWorkers` - number of electron instances, by default it will be the number of cores in the machine.

`maxConcurrencyPerWorker` - number of tasks a worker can handle at the same time, default `Infinity`

`host` - ip or hostname where to start listening electron web server, default localhost

`portLeftBoundary` - don't specify if you just want to take any random free port

`portRightBoundary` - don't specify if you just want to take any random free port

`hostEnvVarName` - customize the name of the environment variable passed to the electron script that specifies the worker host. defaults to `ELECTRON_WORKER_HOST`

`portEnvVarName` - customize the name of the environment variable passed to the electron script that specifies the worker port. defaults to `ELECTRON_WORKER_PORT`

Troubleshooting
---------------

If you are using node with [nvm](https://github.com/creationix/nvm) and you have installed electron with `npm install -g electron-prebuilt` you probably will see an error or log with `env: node: No such file or directory`, this is because the electron executable installed by `electron-prebuilt` is a node CLI spawning the real electron executable internally, since nvm don't install/symlink node to `/usr/bin/env/node` when the electron executable installed by `electron-prebuilt` tries to run, it will fail because `node` won't be found in that context.

Solution
--------

1.- Install `electron-prebuilt` as a dependency in your app, this is the **recommended** option because you probably want to ensure your app will always run with the exact version you tested, and you probably don't want to install electron globally on your system.

2.- You can make a symlink to `/usr/bin/env/node` but this is **not recommended** by nvm authors, because you will lose all the power that nvm brings.

3.- Put the path to the **real electron executable** in your `$PATH`.

License
-------

See [license](https://github.com/bjrmatos/electron-workers/blob/master/LICENSE)
