
/**
 * ElectronManager is responsible of managing pool of electron worker processes
 * and distributing tasks to them.
 */

import { EventEmitter } from 'events';
import os from 'os';
import which from 'which';
import findIndex from 'lodash.findindex';
import ElectronWorker from './ElectronWorker';

const numCPUs = os.cpus().length;
let ELECTRON_PATH;

function getElectronPath() {
  let electron;

  if (ELECTRON_PATH) {
    return ELECTRON_PATH;
  }

  try {
    // first try to find the electron executable if it is installed from electron-prebuilt..
    electron = require('electron-prebuilt');
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      // ..if electron-prebuilt was not used try using which module
      electron = which.sync('electron');
    } else {
      throw err;
    }
  }

  ELECTRON_PATH = electron;

  return electron;
}

class ElectronManager extends EventEmitter {
  constructor(options = {}) {
    super();

    let instance = this;

    this._electronInstances = [];
    this.options = options;
    this.options.electronArgs = this.options.electronArgs || [];
    this.options.pathToElectron = this.options.pathToElectron || getElectronPath();
    this.options.numberOfWorkers = this.options.numberOfWorkers || numCPUs;
    this.options.timeout = this.options.timeout || 180000;
    this.options.host = this.options.host || '127.0.0.1';
    this.options.hostEnvVarName = this.options.hostEnvVarName || 'ELECTRON_WORKER_HOST';
    this.options.portEnvVarName = this.options.portEnvVarName || 'ELECTRON_WORKER_PORT';
    this._timeouts = [];
    this.tasksQueue = [];

    function processExitHandler() {
      instance.kill();
    }

    this._processExitHandler = processExitHandler;

    process.once('exit', processExitHandler);
  }

  start(cb) {
    let started = 0,
        workerErrors = [],
        { numberOfWorkers } = this.options,
        couldNotStartWorkersErr;

    function startHandler(err) {
      if (err) {
        workerErrors.push(err);
      }

      started++;

      if (started === numberOfWorkers) {
        if (workerErrors.length) {
          couldNotStartWorkersErr = new Error('electron manager could not start all workers..');
          couldNotStartWorkersErr.workerErrors = workerErrors;
          return cb(couldNotStartWorkersErr);
        }

        cb(null);
      }
    }

    for (let ix = 0; ix < numberOfWorkers; ix++) {
      let workerPortLeftBoundary = this.options.portLeftBoundary;

      // prevent that workers start with the same left boundary
      if (workerPortLeftBoundary != null) {
        workerPortLeftBoundary += ix;
      }

      let workerInstance = new ElectronWorker({
        debug: this.options.debug,
        debugBrk: this.options.debugBrk,
        env: this.options.env,
        stdio: this.options.stdio,
        killSignal: this.options.killSignal,
        electronArgs: this.options.electronArgs,
        pathToElectron: this.options.pathToElectron,
        pathToScript: this.options.pathToScript,
        hostEnvVarName: this.options.hostEnvVarName,
        portEnvVarName: this.options.portEnvVarName,
        host: this.options.host,
        portLeftBoundary: workerPortLeftBoundary,
        portRightBoundary: this.options.portRightBoundary
      });

      workerInstance.on('processCreated', () => {
        this.emit('workerProcessCreated', workerInstance, workerInstance._childProcess);
      });

      workerInstance.on('recycling', () => {
        this.emit('workerRecycling', workerInstance);
      });

      workerInstance.on('recycled', () => {
        this.emit('workerRecycled', workerInstance);
      });

      this._electronInstances.push(workerInstance);

      this._electronInstances[ix].start(startHandler);
    }
  }

  execute(data, ...args) {
    let availableWorkerInstanceIndex,
        availableWorkerInstance,
        options,
        cb;

    if (args.length > 1) {
      options = args[0];
      cb = args[1];
    } else {
      cb = args[0];
    }

    // simple round robin balancer across workers
    // on each execute, get the first available worker from the list...
    availableWorkerInstanceIndex = findIndex(this._electronInstances, {
      isBusy: false
    });

    if (availableWorkerInstanceIndex !== -1) {
      availableWorkerInstance = this._electronInstances.splice(availableWorkerInstanceIndex, 1)[0];
      this._executeInWorker(availableWorkerInstance, data, options, cb);
      // ..and then the worker we have used becomes the last item in the list
      this._electronInstances.push(availableWorkerInstance);
      return;
    }

    // if no available worker save task for later processing
    this.tasksQueue.push({ data, options, cb });
  }

  _executeInWorker(worker, data, options = {}, cb) {
    let isDone = false,
        workerTimeout,
        timeoutId;

    if (options.timeout != null) {
      workerTimeout = options.timeout;
    } else {
      workerTimeout = this.options.timeout;
    }

    timeoutId = setTimeout(() => {
      this._timeouts.splice(this._timeouts.indexOf(timeoutId), 1);

      if (isDone) {
        return;
      }

      isDone = true;

      this.emit('workerTimeout', worker);

      let error = new Error();
      error.workerTimeout = true;
      error.message = 'Worker Timeout, the worker process does not respond after ' + workerTimeout + 'ms';
      cb(error);

      // mark worker as busy before recycling
      worker.isBusy = true;

      // we only recyle the process if timeout is reached
      // TODO: decide what to do if the worker's recycle fail
      worker.recycle(() => {
        // mark worker as free after recycling
        worker.isBusy = false;
        this.tryFlushQueue();
      });
    }, workerTimeout);

    this._timeouts.push(timeoutId);

    worker.execute(data, (err, result) => {
      if (isDone) {
        return;
      }

      // clear timeout
      this._timeouts.splice(this._timeouts.indexOf(timeoutId), 1);
      clearTimeout(timeoutId);

      if (err) {
        this.tryFlushQueue();
        cb(err);
        return;
      }

      isDone = true;
      this.tryFlushQueue();
      cb(null, result);
    });
  }

  tryFlushQueue() {
    let availableWorkerInstanceIndex,
        availableWorkerInstance,
        task;

    if (this.tasksQueue.length === 0) {
      return;
    }

    // simple round robin balancer across workers
    // get the first available worker from the list...
    availableWorkerInstanceIndex = findIndex(this._electronInstances, {
      isBusy: false
    });

    if (availableWorkerInstanceIndex === -1) {
      return;
    }

    task = this.tasksQueue.shift();
    availableWorkerInstance = this._electronInstances.splice(availableWorkerInstanceIndex, 1)[0];
    this._executeInWorker(availableWorkerInstance, task.data, task.options, task.cb);
    // ..and then the worker we have used becomes the last item in the list
    this._electronInstances.push(availableWorkerInstance);
  }

  kill() {
    this._timeouts.forEach((tId) => {
      clearTimeout(tId);
    });

    this._electronInstances.forEach((workerInstance) => {
      workerInstance.kill();
    });

    process.removeListener('exit', this._processExitHandler);
  }
}

export default ElectronManager;
