'use strict';

/**
 * This is a simple console logger used by quty to log
 * helpful information to the console.
 * Logging levels:
 * - ERROR
 * - WARN
 * - INFO
 * - DEBUG
 * - TRACE
 * */
log.LEVEL = {
  ERROR: 5,
  WARN: 4,
  INFO: 3,
  DEBUG: 2,
  TRACE: 1
};
let logLevel = log.LEVEL.INFO; // Set the default logging level.

function log() {
  let _args = Array.prototype.slice.call(arguments);
  let level = _args[0];
  if (typeof log.LEVEL[level] === 'undefined') {
    level = 'INFO';
  } else {
    _args.splice(0, 1);
  }
  let levelNumber = log.LEVEL[level];
  if (levelNumber < logLevel) return;
  let d = new Date().toISOString();
  d = d.replace('T', ' ').replace('Z', '');
  let msg = `[quty] [${d}] [${level}] `,
    _objects = [],
    hasMessage = false;
  for (let i = 0, len = _args.length; i < len; i++) {
    let _t = typeof _args[i];
    if (_t === 'string' || _t === 'number' || _t === 'boolean') {
      msg += _args[i];
      if (!hasMessage) hasMessage = true;
    } else if (_t === 'object' && _t !== null) {
      _objects.push(_args[i]);
    }
  }
  if (hasMessage) console.log(msg);
  if (_objects.length > 0) {
    console.log(_objects);
  }
}

log.error = log.bind(null, 'ERROR');
log.warn = log.bind(null, 'WARN');
log.info = log.bind(null, 'INFO');
log.debug = log.bind(null, 'DEBUG');
log.trace = log.bind(null, 'TRACE');

log.setLevel = (name) => {
  if (typeof name === 'string') name = name.toUpperCase();
  if (!log.LEVEL[name]) return false;
  logLevel = log.LEVEL[name];
  return true;
};

module.exports = log;
