
import { EventEmitter } from 'events';
import childProcess from 'child_process';
import cluster from 'cluster';
import http from 'http';
import debugPkg from 'debug';
import netCluster from 'net-cluster';
import portScanner from 'portscanner';
import uuid from 'uuid';
import checkPortStatus from './checkPortStatus';
import checkIpcStatus from './checkIpcStatus';
import { name as pkgName } from '../package.json';

const debugWorker = debugPkg(`${pkgName}:worker`);

function findFreePort(host, cb) {
  let server = netCluster.createServer(),
      port = 0;

  debugWorker('trying to find free port..');

  server.on('listening', () => {
    port = server.address().port;
    server.close();
  });

  server.on('close', () => {
    cb(null, port);
  });

  server.listen(0, host);
}

function findFreePortInRange(host, portLeftBoundary, portRightBoundary, cb) {
  let newPortLeftBoundary = portLeftBoundary;

  // in cluster we don't want ports to collide, so we make a special space for every
  // worker assuming max number of cluster workers is 5
  if (cluster.worker) {
    newPortLeftBoundary = portLeftBoundary + (((portRightBoundary - portLeftBoundary) / 5) * (cluster.worker.id - 1));
  }

  debugWorker(`trying to find free port in range ${newPortLeftBoundary}-${portRightBoundary}`);

  portScanner.findAPortNotInUse(newPortLeftBoundary, portRightBoundary, host, (error, port) => {
    cb(error, port);
  });
}

function isValidConnectionMode(mode) {
  if (mode !== 'server' && mode !== 'ipc') {
    return false;
  }

  return true;
}

class ElectronWorker extends EventEmitter {
  constructor(options) {
    super();

    this.options = options;
    this.firstStart = false;
    this.shouldRevive = false;
    this.exit = false;
    this.isBusy = false;
    this.isRecycling = false;
    this.id = uuid.v1();
    this._hardKill = false;
    this._earlyError = false;
    this._taskCallback = {};

    this.onWorkerProcessError = this.onWorkerProcessError.bind(this);
    this.onWorkerProcessExitTryToRecyle = this.onWorkerProcessExitTryToRecyle.bind(this);
    this.onWorkerProcessIpcMessage = this.onWorkerProcessIpcMessage.bind(this);

    if (options.connectionMode === 'ipc') {
      this.findFreePort = function(cb) {
        cb(null);
      };
    } else {
      if (options.portLeftBoundary && options.portRightBoundary) {
        this.findFreePort = function(cb) {
          findFreePortInRange(options.host, options.portLeftBoundary, options.portRightBoundary, cb);
        };
      } else {
        this.findFreePort = function(cb) {
          findFreePort(options.host, cb);
        };
      }
    }
  }

  onWorkerProcessError(workerProcessErr) {
    debugWorker(`worker [${this.id}] electron process error callback: ${workerProcessErr.message}`);

    // don't handle early errors (errors between spawning the process and the first checkAlive call) in this handler
    if (this._earlyError) {
      debugWorker(`worker [${this.id}] ignoring error because it was handled previously (early): ${workerProcessErr.message}`);
      return;
    }

    // try revive the process when an error is received,
    // note that could not be spawn errors are not handled here..
    if (this.firstStart && !this.isRecycling && !this.shouldRevive) {
      debugWorker(`worker [${this.id}] the process will be revived because an error: ${workerProcessErr.message}`);
      this.shouldRevive = true;
    }
  }

  onWorkerProcessExitTryToRecyle(code, signal) {
    debugWorker(`worker [${this.id}] onWorkerProcessExitTryToRecyle callback..`);

    if (code != null || signal != null) {
      debugWorker(`worker [${this.id}] electron process exit with code: ${code} and signal: ${signal}`);
    }

    // we only recycle the process on exit and if it is not in the middle
    // of another recycling
    if (this.firstStart && !this.isRecycling) {
      debugWorker(`trying to recycle worker [${this.id}], reason: process exit..`);

      this.exit = true;
      this.firstStart = false;

      this.recycle(() => {
        this.exit = false;
      });
    }
  }

  onWorkerProcessIpcMessage(payload) {
    let callback,
        responseData;

    if (payload && payload.workerEvent === 'taskResponse') {
      debugWorker(`task in worker [${this.id}] has ended..`);

      callback = this._taskCallback[payload.taskId];
      responseData = payload.response;

      if (!callback || typeof callback !== 'function') {
        debugWorker(`worker [${this.id}] - callback registered for the task's response (${payload.taskId}) is not a function`);
        return;
      }

      if (payload.error) {
        return callback(new Error(payload.error.message || 'An error has occurred when trying to process the task'));
      }

      callback(null, responseData);
    }
  }

  start(cb) {
    let isDone = false;

    if (!isValidConnectionMode(this.options.connectionMode)) {
      return cb(new Error(`invalid connection mode: ${this.options.connectionMode}`));
    }

    debugWorker(`starting worker [${this.id}]..`);

    this.findFreePort((err, port) => {
      let childArgs,
          childOpts;

      let {
        electronArgs,
        pathToElectron,
        pathToScript,
        hostEnvVarName,
        portEnvVarName,
        host,
        debug,
        debugBrk,
        env,
        stdio,
        connectionMode
      } = this.options;

      if (!env) {
        env = {};
      }

      childArgs = electronArgs.slice();
      childArgs.unshift(pathToScript);

      if (debugBrk != null) {
        childArgs.unshift(`--debug-brk=${debugBrk}`);
      } else if (debug != null) {
        childArgs.unshift(`--debug=${debug}`);
      }

      if (err) {
        debugWorker(`couldn't find free port for worker [${this.id}]..`);
        return cb(err);
      }

      this.port = port;

      childOpts = {
        env: {
          ...env,
          ELECTRON_WORKER_ID: this.id,
          // propagate the DISPLAY env var to make it work on LINUX
          DISPLAY: process.env.DISPLAY
        }
      };

      // we send host and port as env vars to child process in server mode
      if (connectionMode === 'server') {
        childOpts.stdio = 'pipe';
        childOpts.env[hostEnvVarName] = host;
        childOpts.env[portEnvVarName] = port;
      } else if (connectionMode === 'ipc') {
        childOpts.stdio = ['pipe', 'pipe', 'pipe', 'ipc'];
      }

      if (stdio != null) {
        childOpts.stdio = stdio;
      }

      debugWorker(`spawning process for worker [${this.id}] with args:`, childArgs, 'and options:', childOpts);

      this._childProcess = childProcess.spawn(pathToElectron, childArgs, childOpts);

      debugWorker(`electron process pid for worker [${this.id}]:`, this._childProcess.pid);

      // ipc connection is required for ipc mode
      if (connectionMode === 'ipc' && !this._childProcess.send) {
        return cb(new Error(
          'ipc mode requires a ipc connection, if you\'re using stdio option make sure you are setting up ipc'
        ));
      }

      this._handleSpawnError = function(spawnError) {
        debugWorker(`worker [${this.id}] spawn error callback..`);

        if (!this.firstStart) {
          isDone = true;
          this._earlyError = true;
          debugWorker(`worker [${this.id}] start was canceled because an early error: ${spawnError.message}`);
          cb(spawnError);
        }
      };

      this._handleSpawnError = this._handleSpawnError.bind(this);

      this._childProcess.once('error', this._handleSpawnError);

      this._childProcess.on('error', this.onWorkerProcessError);

      this._childProcess.on('exit', this.onWorkerProcessExitTryToRecyle);

      if (connectionMode === 'ipc') {
        this._childProcess.on('message', this.onWorkerProcessIpcMessage);
      }

      this.emit('processCreated');

      setImmediate(() => {
        // the workers were killed explicitly by the user
        if (this._hardKill || isDone) {
          return;
        }

        if (this._childProcess == null) {
          debugWorker(`There is no child process for worker [${this.id}]..`);
          return cb(new Error('There is no child process for worker'));
        }

        debugWorker(`checking if worker [${this.id}] is alive..`);

        this.checkAlive((checkAliveErr) => {
          if (isDone) {
            return;
          }

          if (checkAliveErr) {
            debugWorker(`worker [${this.id}] is not alive..`);
            return cb(checkAliveErr);
          }

          this._earlyError = false;
          this._childProcess.removeListener('error', this._handleSpawnError);

          if (!this.firstStart) {
            this.firstStart = true;
          }

          debugWorker(`worker [${this.id}] is alive..`);
          cb();
        });
      });
    });
  }

  checkAlive(cb, shot) {
    let shotCount = shot || 1,
        connectionMode = this.options.connectionMode;

    function statusHandler(err, statusWorker) {
      if (!err && statusWorker === 'open') {
        return cb();
      }

      if (connectionMode === 'server' && shotCount > 50) {
        return cb(new Error(`Unable to reach electron worker - mode: ${connectionMode}, ${(err || {}).message}`));
      }

      if (connectionMode === 'ipc' && err) {
        return cb(err);
      }

      shotCount++;

      // re-try check
      if (connectionMode === 'server') {
        setTimeout(() => {
          this.checkAlive(cb, shotCount);
        }, 100);
      }
    }

    if (connectionMode === 'server') {
      checkPortStatus(this.options.pingTimeout, this.port, this.options.host, statusHandler.bind(this));
    } else if (connectionMode === 'ipc') {
      checkIpcStatus(this.options.pingTimeout, this._childProcess, statusHandler.bind(this));
    }
  }

  execute(data, cb) {
    let connectionMode = this.options.connectionMode,
        httpOpts,
        req,
        json,
        taskId;

    debugWorker(`new task for worker [${this.id}]..`);

    this.emit('task');

    if (this._hardKill) {
      debugWorker(`task execution stopped because worker [${this.id}] was killed by the user..`);
      return;
    }

    if (connectionMode === 'ipc') {
      debugWorker(`creating ipc task message for worker [${this.id}]..`);

      taskId = uuid.v1();

      this._taskCallback[taskId] = (...args) => {
        this.emit('taskEnd');
        cb.apply(undefined, args);
      };

      return this._childProcess.send({
        workerEvent: 'task',
        taskId,
        payload: data
      });
    }

    debugWorker(`creating request for worker [${this.id}]..`);

    httpOpts = {
      hostname: this.options.host,
      port: this.port,
      path: '/',
      method: 'POST'
    };

    req = http.request(httpOpts, (res) => {
      let result = '';

      res.on('data', (chunk) => {
        result += chunk;
      });

      res.on('end', () => {
        let responseData;

        debugWorker(`request in worker [${this.id}] has ended..`);

        this.emit('taskEnd');

        try {
          debugWorker(`trying to parse worker [${this.id}] response..`);
          responseData = result ? JSON.parse(result) : null;
        } catch (err) {
          debugWorker(`couldn't parse response for worker [${this.id}]..`);
          return cb(err);
        }

        debugWorker(`response has been parsed correctly for worker [${this.id}]..`);
        cb(null, responseData);
      });
    });

    req.setHeader('Content-Type', 'application/json');
    json = JSON.stringify(data);
    req.setHeader('Content-Length', Buffer.byteLength(json));

    debugWorker(`trying to communicate with worker [${this.id}], request options:`, httpOpts, 'data:', json);

    req.write(json);

    req.on('error', (err) => {
      debugWorker(`error when trying to communicate with worker [${this.id}]..`);
      cb(err);
    });

    req.end();
  }

  recycle(...args) {
    let cb,
        revive;

    debugWorker(`recycling worker [${this.id}]..`);

    if (args.length < 2) {
      cb = args[0];
      revive = true;
    } else {
      cb = args[1];
      revive = args[0];
    }

    if (this._childProcess) {
      this.isRecycling = true;
      // mark worker as busy before recycling
      this.isBusy = true;

      this.emit('recycling');

      if (this._hardKill) {
        debugWorker(`recycling was stopped because worker [${this.id}] was killed by the user..`);
        return;
      }

      this.kill();

      debugWorker(`trying to re-start child process for worker [${this.id}]..`);

      this.start((startErr) => {
        this.isRecycling = false;
        // mark worker as free after recycling
        this.isBusy = false;

        // if there is a error on worker recycling, revive it on next execute
        if (startErr) {
          this.shouldRevive = Boolean(revive);

          debugWorker(`couldn't recycle worker [${this.id}], should revive: ${this.shouldRevive}`);

          cb(startErr);
          this.emit('recyclingError', startErr);
          return;
        }

        debugWorker(`worker [${this.id}] has been recycled..`);

        this.shouldRevive = false;

        cb();

        this.emit('recycled');
      });
    } else {
      debugWorker(`there is no child process to recycle - worker [${this.id}]`);
    }
  }

  kill(hardKill) {
    let connectionMode = this.options.connectionMode;

    debugWorker(`killing worker [${this.id}]..`);

    this.emit('kill');

    this._hardKill = Boolean(hardKill);

    if (this._childProcess) {
      if (this._childProcess.connected) {
        debugWorker(`closing ipc connection - worker [${this.id}]..`);
        this._childProcess.disconnect();
      }

      // clean previous listeners
      if (this._handleSpawnError) {
        this._childProcess.removeListener('error', this._handleSpawnError);
      }

      this._childProcess.removeListener('error', this.onWorkerProcessError);
      this._childProcess.removeListener('exit', this.onWorkerProcessExitTryToRecyle);

      if (connectionMode === 'ipc') {
        this._childProcess.removeListener('message', this.onWorkerProcessIpcMessage);
      }

      // guard against closing a process that has been closed before
      if (!this.exit) {
        if (this.options.killSignal) {
          debugWorker(`killing worker [${this.id}] with custom signal:`, this.options.killSignal);
          this._childProcess.kill(this.options.killSignal);
        } else {
          this._childProcess.kill();
        }

        if (!hardKill) {
          this.onWorkerProcessExitTryToRecyle();
        }
      }

      this._childProcess = undefined;
    } else {
      debugWorker(`there is no child process to kill - worker [${this.id}]`);
    }
  }
}

export default ElectronWorker;
