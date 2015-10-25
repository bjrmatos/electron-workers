
import { EventEmitter } from 'events';
import childProcess from 'child_process';
import cluster from 'cluster';
import http from 'http';
import netCluster from 'net-cluster';
import portScanner from 'portscanner';
import uuid from 'uuid';
import checkPortStatus from './checkPortStatus';

function findFreePort(host, cb) {
  let server = netCluster.createServer(),
      port = 0;

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

  portScanner.findAPortNotInUse(newPortLeftBoundary, portRightBoundary, host, (error, port) => {
    cb(error, port);
  });
}

class ElectronWorker extends EventEmitter {
  constructor(options) {
    super();

    this.options = options;
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
    this.findFreePort((err, port) => {
      let childArgs,
          childOpts;

      let {
        electronArgs,
        pathToElectron,
        pathToScript,
        hostEnvVarName,
        portEnvVarName,
        host
      } = this.options;

      childArgs = electronArgs.slice();
      childArgs.unshift(pathToScript);

      childOpts = {
        env: {}
      };

      if (err) {
        return cb(err);
      }

      this.port = port;

      childOpts.env[hostEnvVarName] = host;
      childOpts.env[portEnvVarName] = port;

      /* eslint-disable no-unused-vars */
      // we send host and port as env vars to child process
      this._childProcess = childProcess.execFile(pathToElectron, childArgs, childOpts, (error, stdout, stderr) => {

      });
      /* eslint-enable no-unused-vars */

      this.checkAlive(cb);

      process.stdout.setMaxListeners(0);
      process.stderr.setMaxListeners(0);

      this._childProcess.stdout.pipe(process.stdout);
      this._childProcess.stderr.pipe(process.stderr);
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

        try {
          responseData = result ? JSON.parse(result) : null;
        } catch (err) {
          return cb(err);
        }

        cb(null, responseData);
      });
    });

    req.setHeader('Content-Type', 'application/json');
    json = JSON.stringify(data);
    req.setHeader('Content-Length', Buffer.byteLength(json));
    req.write(json);

    req.on('error', (err) => {
      cb(err);
    });

    req.end();
  }

  recycle(cb) {
    if (this._childProcess) {
      this._childProcess.kill();
      this._childProcess = undefined;
    }

    this.start(cb);
  }

  kill() {
    if (this._childProcess) {
      this._childProcess.kill('SIGTERM');
      this._childProcess = undefined;
    }
  }
}

export default ElectronWorker;
