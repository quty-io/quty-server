'use strict';
const EventEmitter = require('events').EventEmitter,
  Ws = require('ws'),
  qs = require('querystring'),
  url = require('url'),
  Http = require('http'),
  util = require('./util'),
  token = require('./token'),
  log = require('./logger');

/**
 * The server class abstracts away ws-specific functionality
 * and is used by both the cluster and the clients
 * The server is also an event emitter and will be emitting the following events:
 *  - listen -> when the server is listening
 *  - connect -> when a client is trying to connect
 *  - failed -> when a client failed the authorisation check.
 *  - client -> when a client is connected and passed the authorisation step.
 *  - disconnect -> when a client has disconnected
 * */
const http = Symbol('http'),
  config = Symbol('config'),
  authFn = Symbol('auth'),
  httpPaths = Symbol('httpPaths'),
  httpErrorFn = Symbol('httpErrorFn'),
  ws = Symbol('ws');

class Server extends EventEmitter {

  /**
   * Start the server using the following required configuration:
   * @Arguments
   *  config.server - a HTTP server instance to bind to and listen to the upgrade event
   *    OR
   *  config.engine - an already-configured websocket engine to work with (eg: ws OR engine.io
   *    OR
   *  config.port - the port to listen to, after creating the HTTP server.
   *  config.path - the path to listen to, after creating the HTTP server.
   * */
  constructor(_config = {}) {
    super();
    this.name = 'server';
    this.setMaxListeners(0);
    if (typeof _config !== 'object' || !_config) throw new Error('Quty server: configuration must be an object');
    this.id = `${_config.namespace || 'quty'}-${token.TYPE.CLUSTER}-${util.randomString(4)}${Date.now().toString().substr(-4)}`;
    if (typeof _config.port === 'string') _config.port = parseInt(_config.port, 10);
    if (typeof _config.server === 'object' && _config.server) {
      this[http] = _config.server;
    } else if (typeof _config.engine === 'object' && _config.engine) {
      this[ws] = _config.engine;
    } else {
      this[http] = null;
      if (typeof _config.port !== 'number' || isNaN(_config.port)) throw new Error('Quty server: configuration must contain a valid port to listen to');
      if (typeof _config.path !== 'string' || !_config.path) _config.path = '/';
      if (_config.path.charAt(0) !== '/') _config.path = `/${_config.path}`;
    }
    this[ws] = null;
    this[authFn] = null;
    this[httpPaths] = {}; // a map of http httpPaths as: ${METHOD}:${PATH}
    this[httpErrorFn] = _handleRequestError;
    this[config] = _config;
  }

  get config() {
    return this[config];
  }

  get ws() {
    return this[ws];
  }

  /**
   * Registers a custom HTTP Server path to process when an incoming request hits it.
   * @Arguments
   *  - method - the HTTP Method to handle, can be a string or array<string>
   *  - pathName - the HTTP pathname to be handled. Cannot contain specific functionality like arguments.
   *  - fn - the callback function that will process the request.
   *
   *  Note:
   *  - callback function will be called with fn(req, res);
   * */
  addHttpHandler(method, pathName, fn) {
    if (typeof method === 'string') method = [method];
    if (!(method instanceof Array)) method = [];
    if (typeof pathName === 'string') pathName = [pathName];
    if (!(pathName instanceof Array)) pathName = [];
    if (typeof fn !== 'function') throw new Error(`Quty server: HTTP handler function fn() must be a function`);
    for (let i = 0, len = method.length; i < len; i++) {
      let m = method[i];
      if (typeof m !== 'string' || !m) continue;
      m = m.toUpperCase();
      for (let j = 0, jlen = pathName.length; j < jlen; j++) {
        let p = pathName[j];
        if (typeof p !== 'string' || !p) continue;
        let fullPath = `${m}:${p}`;
        if (this[httpPaths][fullPath]) throw new Error(`Quty server: HTTP handler for: ${fullPath} is already registered.`);
        this[httpPaths][fullPath] = fn;
      }
    }
    return this;
  }

  /**
   * Helper functions over common http methods.
   * */
  $get(path, fn) {
    return this.addHttpHandler('GET', path, fn);
  }

  $post(path, fn) {
    return this.addHttpHandler('POST', path, fn);
  }

  $put(path, fn) {
    return this.addHttpHandler('PUT', path, fn);
  }

  $delete(path, fn) {
    return this.addHttpHandler('DELETE', path, fn);
  }

  /**
   * Sets an authorisation function, used to accept/deny incoming clients.
   * The function itself can return:
   *  - boolean - if we have synchronous auth checks
   *  - promise - if we have asynchronous checks (it should resolve to true/false)
   * @Arguments
   *  - fn - the callback function to call with the following structure: fn(request)
   * */
  setAuthorization(fn) {
    if (typeof fn !== 'function') throw new Error('Quty: authorisation function required');
    this[authFn] = fn;
    return this;
  }

  /**
   * Verifies if there is an authorisation function set.
   * If so, it will call it and perform socket authorisation.
   * */
  _authoriseClient(req, socket, done) {
    if (!this[authFn]) return done(true);
    let t;
    try {
      t = this[authFn](req, socket);
    } catch (e) {
      return done(false);
    }
    if (t === true) return done(true);
    if (t === false) return done(false);
    if (typeof t === 'object' && typeof t.then === 'function' && typeof t.catch === 'function') {
      t.then((ok) => done(ok === true));
      t.catch((err) => done(false));
      return;
    }
    return done(false);
  }

  /**
   * Helper function, to send a JSON result back to a HTTP client response
   * */
  _sendHttpJson(res, obj) {
    if (typeof obj !== 'object' || !obj) obj = {};
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    res.end(JSON.stringify(obj));
  }

  /**
   * Starts listening to the HTTP Server.
   * If the server is not passed, we create a simple HTTP Server to use.
   * Otherwise, we attach ourselves to the upgrade
   * */
  async listen() {
    let isNew = false,
      hasCustomEngine = true;
    if (!this[ws]) {
      this[ws] = _createWebsocketServer.call(this);
      hasCustomEngine = false;
    }
    if (hasCustomEngine) {
      log.info(`[${this.name}] listening`);
      this.emit('listen');
      return true;
    }
    if (!this[http]) {
      isNew = true;
      this[http] = Http.createServer();
    }
    this[http].on('upgrade', _handleUpgrade.bind(this, isNew));
    this[http].on('request', _handleRequest.bind(this));
    if (!isNew) {
      log.info(`[${this.name}] listening`);
      this.emit('listen');
      return true;
    }
    return new Promise((resolve, reject) => {
      this[http].listen(this[config].port, (err) => {
        if (err) {
          log.error(`[${this.name}] cannot listen on port: ${this[config].port} [${this.id}]`);
          return reject(err);
        }
        log.info(`[${this.name}] listening on port: ${this[config].port} [${this.id}]`);
        resolve();
        this.emit('listen');
      });
    });
  }

  /**
   * Utility function that will send an event to the specific scoket,
   * with the specified data.
   * The protocol we use to send data is:
   * "{event}|{stringData}"
   * In the case of data being an object, it will be stringified.
   * */
  sendEvent(socket, event, data) {
    return util.sendSocketEvent(socket, event, data);
  }

}

/**
 * Private functionality not exposed in the class.
 * */

/**
 * Handles an incoming HTTP Request
 * Note: Each and every single request handler is responsible with terminating the response.
 * */
function _handleRequest(req, res) {
  const reqUrl = url.parse(req.url);
  let fullPath = `${req.method}:${reqUrl.pathname}`,
    reqFn = this[httpPaths][fullPath];
  if (!reqFn) {
    let err = new Error(`404 Not Found`);
    err.status = 404;
    return _handleRequestError(req, res, err);
  }
  if (reqUrl.query) {
    try {
      req.query = qs.parse(reqUrl.query);
    } catch (e) {
      log.trace(`Quty server: failed to parse querystring: ${reqUrl.query}`);
      req.query = {};
    }
  } else {
    req.query = {};
  }
  try {
    let r = reqFn(req, res);
    if (typeof r === 'object' && r && r.then && r.catch) {
      r.catch(function (e) {
        log.warn(`Quty server: failed to process ${fullPath}`, e);
        let err = new Error(`Internal Server Error`);
        err.status = 500;
        err.error = e;
        return _handleRequestError(req, res, err);
      });
    }
  } catch (e) {
    log.warn(`Quty server: failed to process ${fullPath}`, e);
    let err = new Error(`Internal Server Error`);
    err.status = 500;
    err.error = e;
    return _handleRequestError(req, res, err);
  }
}

/**
 * Handles sending a HTTP response when errors occur.
 * */
function _handleRequestError(req, res, err) {
  try {
    if (err.status) {
      res.statusCode = err.status;
    } else {
      res.statusCode = 400;
    }
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'text/plain');
    }
    res.end(err.message || '');
  } catch (e) {
    log.error(`Quty server: failed to send error to HTTP Response`, err);
  }
}


/**
 * Handles an incoming HTTP Upgrade event
 * */
function _handleUpgrade(isNew, req, socket, head) {
  const pathname = url.parse(req.url).pathname;
  if (pathname !== this[config].path) {
    if (isNew) socket.destroy();
    log.trace(`[${this.name}] socket connected on wrong path: ${pathname}`);
    return;
  }
  this._authoriseClient(req, socket, (ok) => {
    if (!ok) {
      this.emit('failed', req, socket);
      req.destroy();
      log.trace(`[${this.name}] socket failed authorisation`);
      return;
    }
    this[ws].handleUpgrade(req, socket, head, (wsc) => {
      // We will copy data from socket.quty, to wsc.quty
      let socketDataKeys = Object.keys(socket.quty || {});
      for (let i = 0, len = socketDataKeys.length; i < len; i++) {
        wsc[socketDataKeys[i]] = socket.quty[socketDataKeys[i]];
      }
      let ip = req.connection.remoteAddress;
      if (ip.indexOf(':') !== -1) {
        ip = ip.split(':').pop();
      }
      wsc.remoteAddress = ip;
      delete socket.quty;
      this[ws].emit('connection', wsc, req);
    });
  });
}

/**
 * Creates the Websocket server and starts listening on connections.
 * */
function _createWebsocketServer() {
  let server = new Ws.Server({
    noServer: true
  });
  // Handle an incoming connection.
  server.on('connection', _handleWsConnection.bind(this));
  server.once('close', () => {
    server.clients.forEach((s) => {
      clearInterval(s.__heartbeat);
    });
  });
  return server;
}

/**
 * Handles an incoming websocket connection.
 * */
function _handleWsConnection(socket) {
  this.emit('client', socket);
  // Handle heartbeat on our own internal connections
  if (socket.sid || socket.pid) {
    if (socket.__heartbeat) clearInterval(socket.__heartbeat);
    socket.isAlive = true;
    socket.__heartbeat = setInterval(() => {
      if (socket.isAlive) {
        socket.isAlive = false;
        try {
          socket.ping(noop);
        } catch (e) {
        }
        return;
      }
      socket.terminate();
    }, util.HEARTBEAT_TIMER);
  }

  function onPong() {
    socket.isAlive = true;
  }

  socket.on('pong', onPong);

  function noop() {
  }

  function cleanup() {
    clearInterval(socket.__heartbeat);
    socket.isAlive = false;
    try {
      socket.close();
      socket.terminate();
    } catch (e) {
    }
    socket.removeAllListeners('close');
    socket.removeAllListeners('message');
    socket.removeAllListeners('open');
    socket.removeListener('pong', onPong);
  }

  socket.once('close', () => {
    cleanup();
    this.emit('disconnect', socket);
  });
  socket.on('error', (e) => {
    log.trace(`[${this.name}]: socket encountered error: ${e.message}`);
    cleanup();
    this.emit('disconnect', socket);
  });
  socket.on('message', (data) => {
    socket.isAlive = true;
    let p = util.parseSocketEvent(data);
    if (!p) return;
    if (this.listenerCount(p.event) > 0) {
      this.emit(p.event, p.data);
    }
    this.emit('event', p, socket);
  });
}

module.exports = Server;
