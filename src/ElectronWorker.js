
import { EventEmitter } from 'events';
import childProcess from 'child_process';
import cluster from 'cluster';
import http from 'http';
import debugPkg from 'debug';
import netCluster from 'net-cluster';
import portScanner from 'portscanner';
import uuid from 'uuid';
import checkPortStatus from './checkPortStatus';
import { name as pkgName } from '../package.json';

const debugWorker = debugPkg(pkgName + ':worker');

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

  // in cluster we don't want ports to collide, so we make a special space for every worker assuming max number of cluster workers is 5
  if (cluster.worker) {
    newPortLeftBoundary = portLeftBoundary + (((portRightBoundary - portLeftBoundary) / 5) * (cluster.worker.id - 1));
  }

  debugWorker(`trying to find free port in range ${newPortLeftBoundary}-${portRightBoundary}`);

  portScanner.findAPortNotInUse(newPortLeftBoundary, portRightBoundary, host, (error, port) => {
    cb(error, port);
  });
}

class ElectronWorker extends EventEmitter {
  constructor(options) {
    super();

    this.options = options;
    this.firstStart = false;
    this.shouldRevive = false;
    this.exit = false;
    this.isBusy = false;
    this.id = uuid.v1();

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

  start(cb) {
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
        stdio
      } = this.options;

      if (!env) {
        env = {};
      }

      childArgs = electronArgs.slice();
      childArgs.unshift(pathToScript);

      if (debugBrk != null) {
        childArgs.unshift('--debug-brk=' + debugBrk);
      } else if (debug != null) {
        childArgs.unshift('--debug=' + debug);
      }

      if (err) {
        debugWorker(`couldn't find free port for worker [${this.id}]..`);
        return cb(err);
      }

      this.port = port;

      childOpts = {
        env: {
          ...env,
          [hostEnvVarName]: host,
          [portEnvVarName]: port,
          ELECTRON_WORKER_ID: this.id
        },
        stdio: 'inherit'
      };

      if (stdio != null) {
        childOpts.stdio = stdio;
      }

      debugWorker(`spawning process for worker [${this.id}] with args:`, childArgs, 'and options:', childOpts);

      // we send host and port as env vars to child process
      this._childProcess = childProcess.spawn(pathToElectron, childArgs, childOpts);

      this._childProcess.on('exit', () => {
        debugWorker(`worker [${this.id}] exit callback..`);

        // we only recycle the process on exit and if it is not in the middle
        // of another recycling
        if (this.firstStart && !this.isBusy) {
          debugWorker(`trying to recycle worker [${this.id}], reason: process exit..`);

          this.exit = true;
          this.firstStart = false;

          this.recycle(() => {
            this.exit = false;
          });
        }
      });

      this.emit('processCreated');

      debugWorker(`checking if worker [${this.id}] is alive..`);

      this.checkAlive((checkAliveErr) => {
        if (checkAliveErr) {
          debugWorker(`worker [${this.id}] is not alive..`);
          return cb(checkAliveErr);
        }

        if (!this.firstStart) {
          this.firstStart = true;
        }

        debugWorker(`worker [${this.id}] is alive..`);
        cb();
      });
    });
  }

  checkAlive(cb, shot) {
    let shotCount = shot || 1;

    checkPortStatus(this.port, this.options.host, (err, portStatus) => {
      if (!err && portStatus === 'open') {
        return cb();
      }

      if (shotCount > 50) {
        return cb(new Error('Unable to reach electron worker web server'));
      }

      shotCount++;

      setTimeout(() => {
        this.checkAlive(cb, shotCount);
      }, 100);
    });
  }

  execute(data, cb) {
    let httpOpts,
        req,
        json;

    debugWorker(`new task for worker [${this.id}]..`);

    this.emit('task');

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
      // mark worker as busy before recycling
      this.isBusy = true;
      this.emit('recycling');

      this.kill();

      debugWorker(`trying to re-start child process for worker [${this.id}]..`);

      this.start((startErr) => {
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

  kill() {
    debugWorker(`killing worker [${this.id}]..`);

    if (this._childProcess) {
      if (this._childProcess.connected) {
        debugWorker(`closing ipc connection - worker [${this.id}]..`);
        this._childProcess.disconnect();
      }

      // guard against closing a process that has been closed before
      if (!this.exit) {
        if (this.options.killSignal) {
          debugWorker(`killing worker [${this.id}] with custom signal:`, this.options.killSignal);
          this._childProcess.kill(this.options.killSignal);
        } else {
          this._childProcess.kill();
        }
      }

      this._childProcess = undefined;
    } else {
      debugWorker(`there is no child process to kill - worker [${this.id}]`);
    }
  }
}

export default ElectronWorker;
