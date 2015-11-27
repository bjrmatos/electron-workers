
import debug from 'debug';
import ElectronManager from './ElectronManager';
import { name as pkgName } from '../package.json';

const debugMe = debug(pkgName);

function createManager(options) {
  let manager = new ElectronManager(options);
  debugMe('Creating a new manager with options:', manager.options);
  return manager;
}

function electronManager(options) {
  return createManager(options);
}

export default electronManager;
