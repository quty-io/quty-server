'use strict';
const EventEmitter = require('events').EventEmitter,
  Ws = require('ws'),
  events = require('./events'),
  util = require('./util'),
  log = require('./logger');

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

  /**
   * Initiates a connection with the Quty cluster
   * Returns a promise.
   * */
  connect() {
    if (this.connected || this[client]) return Promise.resolve(true);
    return new Promise((resolve, reject) => {
      let isDone = false;
      let socket = new Ws(this[config].url)
      // TODO
    });
  }

}

module.exports = Publisher;
