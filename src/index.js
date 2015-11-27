
import ElectronManager from './ElectronManager';

function createManager(options) {
  let manager = new ElectronManager(options);
  return manager;
}

function electronManager(options) {
  return createManager(options);
}

export default electronManager;
