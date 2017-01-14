
/**
 * ElectronManager is responsible of managing pool of electron worker processes
 * and distributing tasks to them.
 */

import { EventEmitter } from 'events';
import os from 'os';
import debug from 'debug';
import which from 'which';
import findIndex from 'lodash.findindex';
import ElectronWorker from './ElectronWorker';
import { name as pkgName } from '../package.json';

const numCPUs = os.cpus().length,
      debugManager = debug(`${pkgName}:manager`);

let ELECTRON_PATH;

function getElectronPath() {
  let electron;

  if (ELECTRON_PATH) {
    debugManager('getting electron path from cache');
    return ELECTRON_PATH;
  }

  // first try to find the electron executable if it is installed from `electron`..
  electron = getElectronPathFromPackage('electron');

  if (electron == null) {
    // second try to find the electron executable if it is installed from `electron-prebuilt`..
    electron = getElectronPathFromPackage('electron-prebuilt');
  }

  if (electron == null) {
    // last try to find the electron executable, trying using which module
    debugManager('trying to get electron path from $PATH..');

    try {
      electron = which.sync('electron');
    } catch (whichErr) {
      throw new Error(
        'Couldn\'t find the path to the electron executable automatically, ' +
        'try installing the `electron` or `electron-prebuilt` package, ' +
        'or set the `pathToElectron` option to specify the path manually'
      );
    }
  }

  ELECTRON_PATH = electron;

  return electron;
}

function getElectronPathFromPackage(moduleName) {
  let electronPath;

  try {
    debugManager(`trying to get electron path from "${moduleName}" module..`);

    // eslint-disable-next-line global-require
    electronPath = require(moduleName);

    return electronPath;
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      return electronPath;
    }

    throw err;
  }
}

class ElectronManager extends EventEmitter {
  constructor(options = {}) {
    super();

    let instance = this;

    this._electronInstances = [];
    this._electronInstancesTasksCount = {};
    this.options = { ...options };
    this.options.connectionMode = this.options.connectionMode || 'server';
    this.options.electronArgs = this.options.electronArgs || [];
    this.options.pathToElectron = this.options.pathToElectron || getElectronPath();
    this.options.numberOfWorkers = this.options.numberOfWorkers || numCPUs;
    this.options.maxConcurrencyPerWorker = this.options.maxConcurrencyPerWorker || Infinity;
    this.options.timeout = this.options.timeout || 10000;
    this.options.host = this.options.host || 'localhost';
    this.options.hostEnvVarName = this.options.hostEnvVarName || 'ELECTRON_WORKER_HOST';
    this.options.portEnvVarName = this.options.portEnvVarName || 'ELECTRON_WORKER_PORT';
    this._timeouts = [];
    this.tasksQueue = [];

    if (isNaN(this.options.maxConcurrencyPerWorker) ||
      typeof this.options.maxConcurrencyPerWorker !== 'number') {
      throw new Error('`maxConcurrencyPerWorker` option must be a number');
    }

    if (this.options.maxConcurrencyPerWorker <= 0) {
      throw new Error('`maxConcurrencyPerWorker` option must be greater than 0');
    }

    function processExitHandler() {
      debugManager('process exit: trying to kill workers..');
      instance.kill();
    }

    this._processExitHandler = processExitHandler;

    process.once('exit', processExitHandler);
  }

  start(cb) {
    let started = 0,
        workerErrors = [],
        { numberOfWorkers, connectionMode } = this.options,
        couldNotStartWorkersErr;

    if (connectionMode !== 'server' && connectionMode !== 'ipc') {
      return cb(new Error(`invalid connection mode: ${connectionMode}`));
    }

    debugManager(`starting ${numberOfWorkers} worker(s), mode: ${connectionMode}..`);

    function startHandler(err) {
      if (err) {
        workerErrors.push(err);
      }

      started++;

      if (started === numberOfWorkers) {
        if (workerErrors.length) {
          couldNotStartWorkersErr = new Error('electron manager could not start all workers..');
          couldNotStartWorkersErr.workerErrors = workerErrors;
          debugManager('electron manager could not start all workers..');
          return cb(couldNotStartWorkersErr);
        }

        debugManager('all workers started correctly');
        cb(null);
      }
    }

    for (let ix = 0; ix < numberOfWorkers; ix++) {
      let workerPortLeftBoundary = this.options.portLeftBoundary,
          workerOptions,
          workerInstance;

      // prevent that workers start with the same left boundary
      if (workerPortLeftBoundary != null) {
        workerPortLeftBoundary += ix;
      }

      workerOptions = {
        debug: this.options.debug,
        debugBrk: this.options.debugBrk,
        env: this.options.env,
        stdio: this.options.stdio,
        connectionMode: this.options.connectionMode,
        killSignal: this.options.killSignal,
        electronArgs: this.options.electronArgs,
        pathToElectron: this.options.pathToElectron,
        pathToScript: this.options.pathToScript,
        hostEnvVarName: this.options.hostEnvVarName,
        portEnvVarName: this.options.portEnvVarName,
        host: this.options.host,
        portLeftBoundary: workerPortLeftBoundary,
        portRightBoundary: this.options.portRightBoundary
      };

      debugManager(`creating worker ${ix + 1} with options:`, workerOptions);
      workerInstance = new ElectronWorker(workerOptions);

      workerInstance.on('processCreated', () => {
        this.emit('workerProcessCreated', workerInstance, workerInstance._childProcess);
      });

      workerInstance.on('recycling', () => {
        if (this._electronInstancesTasksCount[workerInstance.id] != null) {
          this._electronInstancesTasksCount[workerInstance.id] = 0;
        }

        this.emit('workerRecycling', workerInstance);
      });

      workerInstance.on('recyclingError', () => {
        this.emit('workerRecyclingError', workerInstance);
        this.tryFlushQueue();
      });

      workerInstance.on('recycled', () => {
        this.emit('workerRecycled', workerInstance);
        this.tryFlushQueue();
      });

      workerInstance.on('kill', () => {
        if (this._electronInstancesTasksCount[workerInstance.id] != null) {
          this._electronInstancesTasksCount[workerInstance.id] = 0;
        }
      });

      this._electronInstances.push(workerInstance);
      this._electronInstancesTasksCount[workerInstance.id] = 0;

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

    debugManager('getting new task..');

    // simple round robin balancer across workers
    // on each execute, get the first available worker from the list...
    availableWorkerInstanceIndex = findIndex(this._electronInstances, {
      isBusy: false
    });

    if (availableWorkerInstanceIndex !== -1) {
      availableWorkerInstance = this._electronInstances.splice(availableWorkerInstanceIndex, 1)[0];

      this._manageTaskStartInWorker(availableWorkerInstance);

      debugManager(`worker [${availableWorkerInstance.id}] has been choosen for the task..`);

      this._executeInWorker(availableWorkerInstance, data, options, cb);
      // ..and then the worker we have used becomes the last item in the list
      this._electronInstances.push(availableWorkerInstance);
      return;
    }

    debugManager('no workers available, storing the task for later processing..');
    // if no available worker save task for later processing
    this.tasksQueue.push({ data, options, cb });
  }

  _manageTaskStartInWorker(worker) {
    const maxConcurrencyPerWorker = this.options.maxConcurrencyPerWorker;

    if (this._electronInstancesTasksCount[worker.id] == null) {
      this._electronInstancesTasksCount[worker.id] = 0;
    }

    if (this._electronInstancesTasksCount[worker.id] < maxConcurrencyPerWorker) {
      this._electronInstancesTasksCount[worker.id]++;
    }

    // "equality check" is just enough here but we apply the "greater than" check just in case..
    if (this._electronInstancesTasksCount[worker.id] >= maxConcurrencyPerWorker) {
      worker.isBusy = true; // eslint-disable-line no-param-reassign
    }
  }

  _manageTaskEndInWorker(worker) {
    const maxConcurrencyPerWorker = this.options.maxConcurrencyPerWorker;

    if (this._electronInstancesTasksCount[worker.id] == null) {
      this._electronInstancesTasksCount[worker.id] = 0;
    }

    if (this._electronInstancesTasksCount[worker.id] > 0) {
      this._electronInstancesTasksCount[worker.id]--;
    }

    if (this._electronInstancesTasksCount[worker.id] < maxConcurrencyPerWorker) {
      worker.isBusy = false; // eslint-disable-line no-param-reassign
    }
  }

  _executeInWorker(worker, data, options = {}, cb) {
    let workerTimeout;

    if (options.timeout != null) {
      workerTimeout = options.timeout;
    } else {
      workerTimeout = this.options.timeout;
    }

    if (worker.shouldRevive) {
      debugManager(`trying to revive worker [${worker.id}]..`);

      worker.start((startErr) => {
        if (startErr) {
          debugManager(`worker [${worker.id}] could not revive..`);
          this.tryFlushQueue();
          return cb(startErr);
        }

        debugManager(`worker [${worker.id}] has revived..`);
        executeTask.call(this);
      });
    } else {
      executeTask.call(this);
    }

    function executeTask() {
      let isDone = false;

      let timeoutId = setTimeout(() => {
        this._timeouts.splice(this._timeouts.indexOf(timeoutId), 1);

        if (isDone) {
          return;
        }

        debugManager(`task timeout in worker [${worker.id}] has been reached..`);

        isDone = true;

        this._manageTaskEndInWorker(worker);

        this.emit('workerTimeout', worker);

        let error = new Error();
        error.workerTimeout = true;
        error.message = `Worker Timeout, the worker process does not respond after ${workerTimeout} ms`;
        cb(error);

        this.tryFlushQueue();
      }, workerTimeout);

      debugManager(`executing task in worker [${worker.id}] with timeout:`, workerTimeout);

      this._timeouts.push(timeoutId);

      worker.execute(data, (err, result) => {
        if (isDone) {
          return;
        }

        this._manageTaskEndInWorker(worker);

        // clear timeout
        this._timeouts.splice(this._timeouts.indexOf(timeoutId), 1);
        clearTimeout(timeoutId);

        if (err) {
          debugManager(`task has failed in worker [${worker.id}]..`);
          this.tryFlushQueue();
          cb(err);
          return;
        }

        isDone = true;
        debugManager(`task executed correctly in worker [${worker.id}]..`);
        this.tryFlushQueue();
        cb(null, result);
      });
    }
  }

  tryFlushQueue() {
    let availableWorkerInstanceIndex,
        availableWorkerInstance,
        task;

    debugManager('trying to flush queue of pending tasks..');

    if (this.tasksQueue.length === 0) {
      debugManager('there is no pending tasks..');
      return;
    }

    // simple round robin balancer across workers
    // get the first available worker from the list...
    availableWorkerInstanceIndex = findIndex(this._electronInstances, {
      isBusy: false
    });

    if (availableWorkerInstanceIndex === -1) {
      debugManager('no workers available to process pending task..');
      return;
    }

    task = this.tasksQueue.shift();
    availableWorkerInstance = this._electronInstances.splice(availableWorkerInstanceIndex, 1)[0];

    this._manageTaskStartInWorker(availableWorkerInstance);

    debugManager(`worker [${availableWorkerInstance.id}] has been choosen for process pending task..`);

    this._executeInWorker(availableWorkerInstance, task.data, task.options, task.cb);
    // ..and then the worker we have used becomes the last item in the list
    this._electronInstances.push(availableWorkerInstance);
  }

  kill() {
    debugManager('killing all workers..');

    this._timeouts.forEach((tId) => {
      clearTimeout(tId);
    });

    this._electronInstances.forEach((workerInstance) => {
      workerInstance.kill(true);
    });

    process.removeListener('exit', this._processExitHandler);
  }
}

export default ElectronManager;
