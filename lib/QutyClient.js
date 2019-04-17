'use strict';
const EventEmitter = require('events').EventEmitter,
  Ws = require('ws'),
  url = require('url'),
  log = require('./logger');

/**
 * This is a QutyCluster Client that connects to other
 * servers in the cluster.
 * The client also emits the following events:
 *  - connect -> when the client is connected and successfully authenticated
 *  - disconnect -> when the client disconnected from the server.
 * */

const config = Symbol('config'),
  queue = Symbol('queue'),
  client = Symbol('client');

class QutyClient extends EventEmitter {

  /**
   * Initialize the quty client using the following configuration:
   * @Arguments
   *  - config.url - the Websocket server URL to connect to
   *  - config.buffer - if set to true, buffer all event sendings, enqueue them and flush when re-connected
   *  - config.token - the Authorisation token to use (optional)
   *  - config.reconnect - the number of milliseconds to delay reconnect
   * */
  constructor(_config = {}) {
    super();
    this.setMaxListeners(0);
    if (typeof _config !== 'object' || !_config) throw new Error('Quty client: configuration must be an object');
    if (typeof _config.url !== 'string' || !_config.url) throw new Error(`Quty client: configuration requires url`);
    this[config] = _config;
    this[client] = null;
    this.connected = false;
  }

  get socket() {
    return this[client];
  }

  /**
   * Initializes a websocket connection with the specified target.
   * */
  async connect() {
    if (this[client]) return true;
    const _opt = {};
    let curl = url.parse(this[config].url);
    if (!curl.pathname) curl.pathname = '/';
    curl.hash = null;
    if (this[config].token) {
      if (!curl.query) curl.query = {};
      curl.query.token = this[config].token;
    }
    curl = curl.format();
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
        this[client] = null;
      }

      socket.once('open', () => {
        if (isDone) return;
        isDone = true;
        log.trace(`(client) Connected to: [${this[config].url}]`);
        socket.on('open', _onOpen.bind(this, socket));
        socket.on('close', _onClose.bind(this, socket));
        socket.on('message', _onMessage.bind(this, socket));
        resolve();
      });
      socket
        .once('close', () => {
          cleanup.call(this);
          if (!isDone) {
            isDone = true;
            reject(new Error('Quty client: cannot connect to server'));
          } else if (typeof this[config].reconnect === 'number') {
            // TODO: handle reconnect
          }
        })
        .on('error', (err) => {
          if (isDone) return;
          isDone = true;
          cleanup.call(this);
          err.message = `Quty client: cannot connect to server: ${err.message}`;
          reject(err);
        });

    });
  }


  /**
   * Generic function that sends some data to the server
   * This is a simple wrapper over socket.send()
   * */
  send(data, fn) {
    if (!this.connected) {
      if (this[config].buffer) {
        if (!this[queue]) this[queue] = [];
        this[queue].push({
          data,
          fn
        });
      }
      return false;
    }
    this[client].send(data, fn);
    return true;
  }
}

/**
 * Private functionality
 * */
function _onOpen(socket) {
  this.connected = true;
  log.trace(`(Quty client) connected to: ${this[config].url}`);
  // Flush any waiting events.
  if (this[queue]) {
    let events = this[queue];
    this[queue] = [];
    for (let i = 0, len = events.length; i < len; i++) {
      let item = events[i];
      this.send(item.data, item.fn);
    }
  }
  this.emit('connect');
}

function _onClose(socket) {
  this.connected = false;
  log.trace(`(Quty client) disconnected from: ${this[config].url}`);
  this.emit('disconnect');
}

function _onMessage(socket, data) {

}


module.exports = QutyClient;
