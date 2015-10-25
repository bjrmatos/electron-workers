
import path from 'path';
import os from 'os';
import should from 'should';
import ElectronManager from '../src/ElectronManager';

/* eslint padded-blocks: [0] */
describe('electron workers', () => {

  it('should pass custom arguments to the electron executable', function(done) {
    let electronManager = new ElectronManager({
      electronArgs: ['--some-value=2', '--enable-some-behaviour'],
      pathToScript: path.join(__dirname, 'electron-script', 'custom-args.js'),
      numberOfWorkers: 1
    });

    electronManager.start((startErr) => {
      if (startErr) {
        startErr.workerErrors.forEach((workerErr) => {
          console.log(workerErr.message);
        });

        return done(startErr);
      }

      electronManager.execute({}, (executeErr, data) => {
        if (executeErr) {
          return done(executeErr);
        }

        should(data.join(' ')).be.eql('--some-value=2 --enable-some-behaviour');
        electronManager.kill();
        done();
      });
    });
  });

  it('should spin up number of workers equal to number of cores by default', function(done) {
    let electronManager = new ElectronManager({
      pathToScript: path.join(__dirname, 'electron-script', 'script.js')
    });

    electronManager.start((startErr) => {
      if (startErr) {
        return done(startErr);
      }

      should(electronManager._electronInstances.length).be.eql(os.cpus().length);
      electronManager.kill();
      done();
    });
  });

  it('should spin up specified number of workers', function(done) {
    let electronManager = new ElectronManager({
      pathToScript: path.join(__dirname, 'electron-script', 'script.js'),
      numberOfWorkers: 3
    });

    electronManager.start((startErr) => {
      if (startErr) {
        return done(startErr);
      }

      should(electronManager._electronInstances.length).be.eql(3);
      electronManager.kill();
      done();
    });
  });

  it('should initialize free workers', function(done) {
    let electronManager = new ElectronManager({
      pathToScript: path.join(__dirname, 'electron-script', 'script.js'),
      numberOfWorkers: 2
    });

    electronManager.start((startErr) => {
      let busyWorkers;

      if (startErr) {
        return done(startErr);
      }

      busyWorkers = electronManager._electronInstances.filter((worker) => {
        return worker.isBusy === true;
      });

      should(busyWorkers.length).be.eql(0);
      electronManager.kill();
      done();
    });
  });

  it('should distribute tasks across all workers', function(done) {
    let electronManager = new ElectronManager({
      pathToScript: path.join(__dirname, 'electron-script', 'script.js'),
      numberOfWorkers: 4
    });

    electronManager.start((startErr) => {
      let workersCalled = [],
          isDone = false,
          executeCount = 0;

      if (startErr) {
        return done(startErr);
      }

      electronManager._electronInstances.forEach((worker) => {
        worker.once('task', function() {
          workersCalled.push(worker.id);
        });
      });

      function executeTask() {
        electronManager.execute({}, (executeErr) => {
          if (isDone) {
            return;
          }

          if (executeErr) {
            isDone = true;
            done(executeErr);
            return;
          }

          executeCount++;

          if (executeCount === electronManager._electronInstances.length) {
            let workerIds,
                workersNotCalled;

            workerIds = electronManager._electronInstances.map((worker) => {
              return worker.id;
            });

            workersNotCalled = workerIds.filter((workerId) => {
              return workersCalled.indexOf(workerId) === -1;
            });

            should(workersNotCalled.length).be.eql(0);
            electronManager.kill();
            done();
          }
        });
      }

      for (let ix = 0; ix < electronManager._electronInstances.length; ix++) {
        executeTask();
      }
    });
  });

  it('should be able to communicate with slowly starting electron', function(done) {
    this.timeout(5000);

    let electronManager = new ElectronManager({
      pathToScript: path.join(__dirname, 'electron-script', 'slowstart.js'),
      numberOfWorkers: 1
    });

    electronManager.start((startErr) => {
      if (startErr) {
        return done(startErr);
      }

      electronManager.execute({ foo: 'test' }, (executeErr, data) => {
        if (executeErr) {
          return done(executeErr);
        }

        should(data).be.eql({ ok: true });
        electronManager.kill();
        done();
      });
    });
  });

  it('should be able to communicate with electron', function(done) {
    let electronManager = new ElectronManager({
      pathToScript: path.join(__dirname, 'electron-script', 'script.js'),
      numberOfWorkers: 1
    });

    electronManager.start((startErr) => {
      if (startErr) {
        return done(startErr);
      }

      electronManager.execute({ foo: 'test' }, (executeErr, data) => {
        if (executeErr) {
          return done(executeErr);
        }

        should(data).be.eql({ foo: 'test' });
        electronManager.kill();
        done();
      });
    });
  });

  it('should be able to start electron in a port range', function(done) {
    let electronManager = new ElectronManager({
      pathToScript: path.join(__dirname, 'electron-script', 'script.js'),
      numberOfWorkers: 1,
      portLeftBoundary: 10000,
      portRightBoundary: 11000
    });

    electronManager.start((startErr) => {
      if (startErr) {
        return done(startErr);
      }

      should(electronManager._electronInstances[0].port).be.within(10000, 11000);
      electronManager.kill();
      done();
    });
  });

  it('should be able to communicate with just-port script', function(done) {
    let electronManager = new ElectronManager({
      pathToScript: path.join(__dirname, 'electron-script', 'just-port.js'),
      numberOfWorkers: 1
    });

    electronManager.start((startErr) => {
      if (startErr) {
        return done(startErr);
      }

      electronManager.execute({ foo: 'test' }, (executeErr, data) => {
        if (executeErr) {
          return done(executeErr);
        }

        should(data).be.eql({ foo: 'test' });
        electronManager.kill();
        done();
      });
    });
  });

  it('should be able to send just a simple string on input', function(done) {
    let electronManager = new ElectronManager({
      pathToScript: path.join(__dirname, 'electron-script', 'script.js'),
      numberOfWorkers: 1
    });

    electronManager.start((startErr) => {
      if (startErr) {
        return done(startErr);
      }

      electronManager.execute('test', (executeErr, data) => {
        if (executeErr) {
          return done(executeErr);
        }

        should(data).be.eql('test');
        electronManager.kill();
        done();
      });
    });
  });

  it('simple input string should not be stringified what is causing broken line endings', function(done) {
    let electronManager = new ElectronManager({
      pathToScript: path.join(__dirname, 'electron-script', 'script.js'),
      numberOfWorkers: 1
    });

    electronManager.start((startErr) => {
      if (startErr) {
        return done(startErr);
      }

      electronManager.execute('<style> td { \n background-color: red \n } </style>', (executeErr, data) => {
        if (executeErr) {
          return done(executeErr);
        }

        should(data).be.eql('<style> td { \n background-color: red \n } </style>');
        electronManager.kill();
        done();
      });
    });
  });

  it('timeout should emit event', function(done) {
    this.timeout(6000);

    let electronManager = new ElectronManager({
      pathToScript: path.join(__dirname, 'electron-script', 'timeout.js'),
      numberOfWorkers: 1,
      timeout: 10
    });

    let emitted = false;

    electronManager.on('workerTimeout', () => {
      emitted = true;
      done();
    });

    electronManager.start((startErr) => {
      if (startErr) {
        return done(startErr);
      }

      electronManager.execute({}, (executeErr) => {
        if (!executeErr) {
          return done(new Error('should not execute successfully'));
        }
      });
    });

    setTimeout(() => {
      electronManager.kill();

      if (!emitted) {
        done(new Error('worker was not recycled'));
      }
    }, 2500);
  });

  it('timeout should cb with error', function(done) {
    this.timeout(6000);

    let electronManager = new ElectronManager({
      pathToScript: path.join(__dirname, 'electron-script', 'timeout.js'),
      numberOfWorkers: 1,
      timeout: 100
    });

    electronManager.start((startErr) => {
      if (startErr) {
        return done(startErr);
      }

      electronManager.execute({}, (executeErr) => {
        if (!executeErr) {
          return done(new Error('should not execute successfully'));
        }

        electronManager.kill();
        done();
      });
    });
  });

});
