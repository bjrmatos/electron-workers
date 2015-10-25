
import ElectronManager from './ElectronManager';

function createManager(options) {
  return new ElectronManager(options);
}

function electronManager(options) {
  return createManager(options);
}

electronManager.createManager = createManager;

export default electronManager;
