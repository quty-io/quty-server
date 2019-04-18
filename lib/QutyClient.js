'use strict';
const EventEmitter = require('events').EventEmitter,
  Ws = require('ws'),
  url = require('url'),
  util = require('./util'),
  log = require('./logger');

/**
 * This is a QutyCluster Client that connects to other
 * servers in the cluster.
 * The client also emits the following events:
 *  - connect -> when the client is connected and successfully authenticated
 *  - disconnect -> when the client disconnected from the server.
 *  - destroy -> when the client will be destroyed.
 *  - event({event, data}) -> when an incoming event is coming from the socket.
 *
 *  ** See available events from lib/evens.js, depending on the type of client.
 * */

const config = Symbol('config'),
  queue = Symbol('queue'),
  reconnectTimer = Symbol('reconnectTimer'),
  reconnectCount = Symbol('reconnectCount'),
  client = Symbol('client');

class QutyClient extends EventEmitter {

  /**
   * Initialize the quty client using the following configuration:
   * @Arguments
   *  - config.url - the Websocket server URL to connect to
   *  - config.buffer - if set to true, buffer all event sendings, enqueue them and flush when re-connected
   *  - config.token - the Authorisation token to use (optional) OR a callback function that returns the token
   *  - config.reconnect - the number of milliseconds to delay reconnect
   *  - config.maxReconnect - the maximum number of reconnect attempts
   * */
  constructor(_config = {}) {
    super();
    this.setMaxListeners(0);
    if (typeof _config !== 'object' || !_config) throw new Error('Quty client: configuration must be an object');
    if (typeof _config.url !== 'string' || !_config.url) throw new Error(`Quty client: configuration requires url`);
    this[config] = _config;
    if (_config.reconnect === true) {
      _config.reconnect = 1000;
    }
    this[client] = null;
    this[reconnectCount] = 0;
    this.connected = false;
  }

  get socket() {
    return this[client];
  }

  /* Returns the ip:port string with no protocol. */
  get url() {
    let u = this[config].url;
    if (u.indexOf('://') !== -1) {
      u = u.split('://')[1].split('/')[0];
    }
    return u;
  }

  /**
   * Destroys the client object instance, terminating the socket if it exists.
   * */
  destroy() {
    this.emit('destroy');
    this.removeAllListeners();
    this.connected = false;
    if (this[client]) {
      try {
        this[client].close();
        this[client].terminate();
      } catch (e) {
      }
      this[client].removeAllListeners('open');
      this[client].removeAllListeners('close');
      this[client].removeAllListeners('message');
      this[client].removeAllListeners('error');
      this[client] = null;
    }
  }

  /**
   * Initializes a websocket connection with the specified target.
   * @Arguments
   *  - verifyFn - a callback function that will be called with the (resolve) function, instead of using resolve() directly.
   * */
  async connect(verifyFn) {
    if (this[client]) return true;
    const _opt = {};
    let curl = url.parse(this[config].url);
    if (!curl.pathname) curl.pathname = '/';
    curl.hash = null;
    let token;
    if (typeof this[config].token === 'function') {
      token = this[config].token();
    } else if (typeof this[config].token === 'string') {
      token = this[config].token;
    }
    if (token) {
      if (!curl.query) curl.query = {};
      curl.query.token = token;
    }
    curl = curl.format();
    let isReconnect = !!this[reconnectTimer];
    if (isReconnect) {
      this[reconnectCount]++;
    }
    if (this[reconnectTimer]) {
      clearTimeout(this[reconnectTimer]);
      delete this[reconnectTimer];
    }
    let socket = new Ws(curl, _opt);
    this[client] = socket;
    return new Promise((resolve, reject) => {
      let isDone = false;

      function cleanup() {
        try {
          socket.close();
          socket.terminate();
        } catch (e) {
        }
        socket.removeAllListeners('open');
        socket.removeAllListeners('close');
        socket.removeAllListeners('message');
        socket.removeAllListeners('error');
      }

      /**
       * Handle on-open functionality
       * */
      socket.once('open', () => {
        this.connected = true;
        if (isReconnect) {
          log.trace(`(Quty client) reconnected to: ${this[config].url}`);
        } else {
          log.trace(`(Quty client) connected to: ${this[config].url}`);
        }
        // Flush any waiting events.
        if (this[queue]) {
          let events = this[queue];
          this[queue] = [];
          for (let i = 0, len = events.length; i < len; i++) {
            let item = events[i];
            this.send(item.event, item.data, item.fn);
          }
        }
        this.emit('connect');
        if (verifyFn) {
          return verifyFn(function resolveFn() {
            if (isDone) return;
            isDone = true;
            resolve();
          }, function rejectFn(err) {
            if (isDone) return;
            isDone = true;
            cleanup();
            reject(err);
          });
        }
        if (isDone) return;
        isDone = true;
        resolve();
      });
      /**
       * Handle on-close functionality and re-connect
       * */
      socket.once('close', () => {
        cleanup.call(this);
        this.connected = false;
        if (!isDone) {
          isDone = true;
          if (isReconnect) {
            resolve();  // we have to resolve if it was from a reconnect
          } else {
            this[client] = null;
            return reject(new Error('Quty client: cannot connect to server'));
          }
        }
        log.trace(`(Quty client) disconnected from: ${this[config].url}`);
        this.emit('disconnect');
        if (typeof this[config].reconnect === 'number') {
          this[reconnectTimer] = setTimeout(() => {
            this.connect(verifyFn).catch((e) => {
              log.trace(`(Quty client) reconnect failed to: ${this[config].url} [${e.message}]`);
            });
          }, this[config].reconnect);
        }
        this[client] = null;
      });
      /**
       * Handle error
       * */
      socket.on('error', (err) => {
        if (isDone) return;
        isDone = true;
        cleanup.call(this);
        err.message = `Quty client: cannot connect to server: ${err.message}`;
        this[client] = null;
        reject(err);
      });
      /**
       * Handle incoming messages
       * */
      socket.on('message', (data) => {
        let p = util.parseSocketEvent(data);
        if (!p) return;
        if (this.listenerCount(p.event) > 0) {
          this.emit(p.event, p.data);
        }
        this.emit('event', p);
      });
    });
  }


  /**
   * Generic function that sends some data to the server
   * This is a simple wrapper over socket.send()
   * */
  send(event, data, fn) {
    if (!this.connected) {
      if (this[config].buffer) {
        if (!this[queue]) this[queue] = [];
        this[queue].push({
          event,
          data,
          fn
        });
      }
      return false;
    }
    return util.sendSocketEvent(this[client], event, data, fn);
  }
}

module.exports = QutyClient;
