'use strict';
const EventEmitter = require('events').EventEmitter,
  Ws = require('ws'),
  url = require('url'),
  Http = require('http'),
  qutyUtil = require('./util'),
  token = require('./token'),
  log = require('./logger');

/**
 * The server class abstracts away ws-specific functionality
 * and is used by both the cluster and the clients
 * The server is also an event emitter and will be emitting the following events:
 *  - ready -> when the server is ready and listening
 *  - connect -> when a client is trying to connect
 *  - client -> when a client is connected and passed the authorisation step.
 *  - failed -> when a client failed the authorisation check.
 *  - disconnect -> when a client has disconnected
 * */
const http = Symbol('http'),
  config = Symbol('config'),
  authFn = Symbol('auth'),
  paths = Symbol('paths'),
  ws = Symbol('ws');

class Server extends EventEmitter {

  /**
   * Start the server using the following required configuration:
   * @Arguments
   *  config.server - a HTTP server instance to bind to and listen to the upgrade event
   *    OR
   *  config.port - the port to listen to, after creating the HTTP server.
   *  config.path - the path to listen to, after creating the HTTP server.
   * */
  constructor(_config = {}) {
    super();
    this.name = 'server';
    this.setMaxListeners(0);
    if (typeof _config !== 'object' || !_config) throw new Error('Quty server: configuration must be an object');
    this.id = `${_config.namespace || 'quty'}-${token.TYPE.CLUSTER}-${qutyUtil.randomString(4)}${Date.now().toString().substr(-4)}`;
    if (typeof _config.server === 'object' && _config.server) {
      this[http] = _config.server;
    } else {
      this[http] = null;
      if (typeof _config.port !== 'number') throw new Error('Quty server: configuration must contain a port to listen to');
      if (typeof _config.path !== 'string' || !_config.path) _config.path = '/';
      if (_config.path.charAt(0) !== '/') _config.path = `/${_config.path}`;
    }
    this[ws] = null;
    this[authFn] = null;
    this[paths] = {}; // a map of http paths
    this[config] = _config;
  }

  get config() {
    return this[config];
  }

  get ws() {
    return this[ws];
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
      t.then((ok) => done(ok === true))
      t.catch((err) => done(false));
      return;
    }
    return done(false);
  }

  /**
   * Starts listening to the HTTP Server.
   * If the server is not passed, we create a simple HTTP Server to use.
   * Otherwise, we attach ourselves to the upgrade
   * */
  async listen() {
    let isNew = false;
    this[ws] = _createWebsocketServer.call(this);
    if (!this[http]) {
      isNew = true;
      this[http] = Http.createServer();
    }
    this[http].on('upgrade', _handleUpgrade.bind(this, isNew));
    this[http].on('request', _handleRequest.bind(this));
    if (!isNew) {
      log.info(`(${this.name} server) listening`);
      return true;
    }
    return new Promise((resolve, reject) => {
      this[http].listen(this[config].port, (err) => {
        if (err) {
          log.error(`(${this.name} server) cannot listen on port: ${this[config].port}`);
          return reject(err);
        }
        log.info(`(${this.name} server) listening on port: ${this[config].port}`);
        resolve();
        this.emit('ready');
      });
    });
  }

}

/**
 * Private functionality not exposed in the class.
 * */

/**
 * Handles an incoming HTTP Request
 * */
function _handleRequest(req, res) {
  const reqUrl = url.parse(req.url);
  console.log("URL:", reqUrl);
}

/**
 * Handles an incoming HTTP Upgrade event
 * */
function _handleUpgrade(isNew, req, socket, head) {
  const pathname = url.parse(req.url).pathname;
  if (pathname !== this[config].path) {
    if (isNew) socket.destroy();
    log.trace(`(${this.name} server) socket connected on wrong path: ${pathname}`);
    return;
  }
  this._authoriseClient(req, socket, (ok) => {
    if (!ok) {
      this.emit('failed', req, socket);
      req.destroy();
      log.trace(`(${this.name} server) socket failed authorisation`);
      return;
    }
    this[ws].handleUpgrade(req, socket, head, (wsc) => {
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
  return server;
}

/**
 * Handles an incoming websocket connection.
 * */
function _handleWsConnection(socket) {
  console.log('Connected');
}


module.exports = Server;
