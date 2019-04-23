'use strict';
const EventEmitter = require('events').EventEmitter,
  Ws = require('ws'),
  url = require('url'),
  events = require('./events'),
  util = require('./util'),
  token = require('./token'),
  log = require('./logger');
const RECONNECT_TIMEOUT = 500; // Time to wait till reconnect
/**
 * The Quty publisher is a client that connects to a Quty cluster
 * and sends out messages to specific channels.
 * It does not process events, it simply sends them.
 * Events triggered:
 *  - connect -> when the client is connected to the Quty cluster
 *  - disconnect -> when the client got disconnected from the Quty cluster
 *  - fail -> when the client failed to authenticate with the cluster.
 * */
const config = Symbol('config'),
  client = Symbol('client'),
  reconnect = Symbol('reconnect'),
  reconnectTimer = Symbol('reconnectTimer'),
  reconnectCount = Symbol('reconnectCount'),
  queue = Symbol('queue');

class Publisher extends EventEmitter {

  /**
   * Initialize the publisher class with some configuration.
   * @Arguments
   *  - config.url - the Quty websocket server URL to connect to
   *  - config.auth - the Quty auth token to use.
   *  - config.reconnect=true - if set to false, do not attempt to reconnect on disconnect.
   *  - config.buffer=true - if set to false, do not queue up messages till we're reconnected.
   * */
  constructor(_config = {}) {
    super();
    this.setMaxListeners(0);
    if (!_config.url) throw new Error('Quty publisher: requires config.url');
    if (typeof _config.reconnect !== 'boolean') _config.reconnect = true;
    if (typeof _config.buffer !== 'boolean') _config.buffer = true;
    this.connected = false;
    this[config] = _config;
    this[queue] = [];
  }

  get config() {
    return this[config];
  }

  /**
   * Send a specific message to the cluster, that will be routed by the cluster
   * @Arguments
   *  - channel - the channel we want to send to
   *  - message - the message we want to send.
   * */
  send(channel, message) {
    if (typeof channel === 'number') channel = channel.toString();
    if (typeof channel !== 'string' || !channel) throw new Error(`Quty publisher: channel is required as string`);
    if (!this.connected) {
      if (!this[config].buffer) return false; // drop message.
      this[queue].push({  // enqueue for later sending.
        channel,
        message
      });
      return false;
    }
    return util.sendSocketEvent(this[client], events.CLUSTER.CHANNEL_MESSAGE, {
      c: channel,
      m: message
    });
  }

  /**
   * Flush all pending messages.
   * */
  flush() {
    if (!this.connected) return false;
    if (this[queue].length === 0) return true;
    let items = this[queue].concat([]);
    this[queue] = [];
    for (let i = 0, len = items.length; i < len; i++) {
      let item = items[i];
      this.send(item.channel, item.message);
    }
    return true;
  }

  [reconnect]() {
    if (this[reconnectTimer]) clearTimeout(this[reconnectTimer]);
    this.connected = false;
    this[reconnectTimer] = setTimeout(async () => {
      if (typeof this[reconnectCount] === 'undefined') this[reconnectCount] = 0;
      this[reconnectCount]++;
      if (this[reconnectCount] === 1) {
        log.trace(`(Quty publisher) trying to reconnect`);
      }
      try {
        await this.connect();
        log.trace(`(Quty publisher) reconnected to cluster [${this[reconnectCount]} attempts]`);
        this[reconnectCount] = 0;
      } catch (e) {
        this[reconnect]();
      }
    }, RECONNECT_TIMEOUT);
  }

  /**
   * Initiates a connection with the Quty cluster
   * Returns a promise.
   * */
  connect() {
    if (this.connected || this[client]) return Promise.resolve(true);
    return new Promise((resolve, reject) => {
      let isDone = false;
      let curl = this[config].url;
      if (curl.indexOf('://') === -1) curl = 'ws://' + curl;
      let copt = url.parse(curl);
      if (!copt.query) copt.query = {};
      copt.query.token = token.create({}, {
        secret: this[config].auth,
        type: token.TYPE.CLUSTER_CLIENT
      });
      curl = copt.format();
      let _opt = {};
      let socket = new Ws(curl, _opt),
        self = this,
        isAlive = false,
        pingTimeout = null;

      function heartbeat() {
        if (pingTimeout) clearTimeout(pingTimeout);
        pingTimeout = setTimeout(() => {
          if (isAlive) {
            isAlive = false;
            return heartbeat();
          }
          cleanup();// ping failed
        }, util.HEARTBEAT_TIMER + util.HEARTBEAT_TIMER / 2);
      }

      function onOpen() {
        heartbeat();
        if (isDone) return;
        isDone = true;
        self.connected = true;
        self.flush();
        resolve();
      }

      function onClose() {
        cleanup();
        if (isDone) return self[reconnect]();
        isDone = true;
        self.connected = false;
        return reject(new Error('Quty client: could not connect to cluster'));
      }

      function onError(err) {
        cleanup();
        if (isDone) return self[reconnect]();
        isDone = true;
        self.connected = false;
        reject(new Error('Quty client: could not connect to cluster: ' + err.message));
      }

      function onMessage(msg) {
        isAlive = true;
        console.log("MSG", msg);
      }

      function cleanup() {
        try {
          socket.terminate();
        } catch (e) {
        }
        clearTimeout(pingTimeout);
        socket.removeAllListeners('open');
        socket.removeAllListeners('close');
        socket.removeAllListeners('message');
        socket.removeAllListeners('ping');
        socket.removeAllListeners('error');
        self[client] = null;
      }

      socket.on('ping', heartbeat);
      socket.once('open', onOpen);
      socket.once('close', onClose);
      socket.on('error', onError);
      socket.on('message', onMessage);
      this[client] = socket;
    });
  }

}

module.exports = Publisher;
