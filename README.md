# electron-workers
[![NPM Version](http://img.shields.io/npm/v/electron-workers.svg?style=flat-square)](https://npmjs.com/package/electron-workers)
[![License](http://img.shields.io/npm/l/electron-workers.svg?style=flat-square)](http://opensource.org/licenses/MIT)
[![Build Status](https://travis-ci.org/bjrmatos/electron-workers.png?branch=master)](https://travis-ci.org/bjrmatos/electron-workers)

> **Run electron scripts in managed workers**

This module let you run an electron script with scalability in mind, useful if you have to rely on electron to do heavy or long running tasks in parallel (web scrapping, take screenshots, generate PDF, etc)

## First create an electron script wrapped in a webserver

*script.js*
```js
var http = require('http'),
    app = require('app');

// every worker gets unique port, get it from a process environment variables
var port = process.env.ELECTRON_WORKER_PORT,
    host = process.env.ELECTRON_WORKER_HOST,
    workerId = process.env.ELECTRON_WORKER_ID; // worker id useful for logging

console.log('Hello from worker', workerId);

app.on('ready', function() {
  // you can use any webserver library/framework you like (connect, express, hapi, etc)
  var server = http.createServer(function(req, res) {
    res.writeHead(200, {'Content-Type': 'application/json'});
    // data passed to `electronWorkers.execute` will be available in req body
    req.pipe(res);
  });

  server.listen(port, host);
});
```


## Start electron workers

```js
var electronWorkers = require('electron-workers')({
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
  });
});
```

## Options

`pathToScript` (required) - path to the electron script<br/>
`pathToElectron` - path to the electron executable, by default we will try to find the path using the value returned from `electron-prebuilt` or the value in your `$PATH`<br/>
`electronArgs` Array - pass custom arguments to the electron executable. ej: `electronArgs: ['--some-value=2', '--enable-some-behaviour']`<br/>
`timeout` - execution timeout in ms<br/>
`numberOfWorkers` - number of electron instances, by default it will be the number of cores in the machine<br/>
`host` - ip or hostname where to start listening phantomjs web service, default 127.0.0.1<br/>
`portLeftBoundary` - don't specify if you just want to take any random free port<br/>
`portRightBoundary` - don't specify if you just want to take any random free port<br/>
`hostEnvVarName` - customize the name of the environment variable passed to the electron script that specifies the worker host. defaults to `ELECTRON_WORKER_HOST`<br/>
`portEnvVarName` - customize the name of the environment variable passed to the electron script that specifies the worker port. defaults to `ELECTRON_WORKER_PORT`

## Troubleshooting

If you are using node with [nvm](https://github.com/creationix/nvm) and you have installed electron with `npm install -g electron-prebuilt` you probably will see an error or log with `env: node: No such file or directory`, this is because the electron executable installed by `electron-prebuilt` is a node CLI spawning the real electron executable internally, since nvm don't install/symlink node to `/usr/bin/env/node` when the electron executable installed by `electron-prebuilt` tries to run, it will fail because `node` won't be found in that context..

*Solution:* 

1.- Install `electron-prebuilt` as a dependency in your app, this is the option **recommended** because you probably want to ensure your app always run with the exact version you tested it, and probably you dotn't want to install electron globally in your system.

2.- You can make a symlink to `/usr/bin/env/node` but this is **not recommended** by nvm authors, because you will loose all the power that nvm brings.

3.- Put the path to the **real electron executable** in your `$PATH`.

## License
See [license](https://github.com/bjrmatos/electron-workers/blob/master/LICENSE)
