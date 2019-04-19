'use strict';
const EventEmitter = require('events').EventEmitter;

/**
 * A ChannelHub class is responsible for keeping track of:
 * - what server is in which channel
 * - what client is subscribed to which channels
 * The hub acts as a distributed in-memory map, that all cluster nodes
 * will eventually have access to.
 * EVENTS triggered:
 *  - channel.add(channel)
 *  - channel.message(channel, message)
 *  - channel.remove(channel)
 *  - node.join(channel, sid)
 *  - node.message(channel, sid, message)
 *  - node.leave(channel, sid)
 *  - client.join(channel, cid)
 *  - client.message(channel, cid, message)
 *  - client.leave(channel, cid)
 * */

class ChannelHub extends EventEmitter {

  constructor() {
    super();
    this.setMaxListeners(0);
    this.nodeChannels = {}; // a map of {channelName: [serverIds]}
    this.clientChannels = {}; // a map of {channelName: [clientIds]}
  }

  /**
   * Subscribes the specified server id to the specified channel.
   * If the channel does not exist, auto-create it
   * @Arguments
   *  sid - the server id to use
   *  channel - the channel name
   * */
  subscribeNode(sid, channel) {
    if (typeof this.nodeChannels[channel] === 'undefined') {
      this.nodeChannels[channel] = [];
      this.emit('channel.add', channel);
    }
    let cidx = this.nodeChannels[channel].indexOf(sid);
    if (cidx === -1) {
      this.nodeChannels[channel].push(sid);
      this.emit('node.join', channel, sid);
    }
  }

  /**
   * Unsubscribes the given server id from the specified channel
   * @Arguments
   *  sid - the server id to use
   *  channel - the channel name
   * */
  unsubscribeNode(sid, channel) {
    if (typeof this.nodeChannels[channel] === 'undefined') return;
    let cidx = this.nodeChannels[channel].indexOf(sid);
    if (cidx !== -1) {
      this.nodeChannels[channel].splice(cidx, 1);
      this.emit('node.leave', channel, sid);
    }
    if (this.nodeChannels[channel].length === 0) {
      delete this.nodeChannels[channel];
      this.emit('channel.remove', channel);
    }
  }

  /**
   * Verifies if the specified node is in a channel
   * @Arguments
   *  sid - the server id to use
   *  channel - the channel name
   * */
  isNodeSubscribed(sid, channel) {
    if (typeof this.nodeChannels[channel] === 'undefined') return false;
    let idx = this.nodeChannels[channel].indexOf(sid);
    return (idx !== -1);
  }

  /**
   * Returns an array with all the node's active subscriptions
   * @Arguments
   *  sid - the server id to use
   * */
  getNodeSubscriptions(sid) {
    let items = [];
    let channels = Object.keys(this.nodeChannels);
    for (let i = 0, len = channels.length; i < len; i++) {
      let c = channels[i];
      if (this.nodeChannels[c].indexOf(sid) !== -1) {
        items.push(c);
      }
    }
    return items;
  }

  /**
   * Completely removes a node from all channels
   * @Arguments
   *  sid - the server id to use
   * */
  removeNode(sid) {
    let channels = Object.keys(this.nodeChannels);
    for (let i = 0, len = channels.length; i < len; i++) {
      let c = channels[i];
      this.unsubscribeNode(sid, c);
    }
    return true;
  }

  /**
   * Subscribes a client to a channel.
   * If the channel does not exist, auto-create it.
   * This operation also requires the source node (that owns the client)
   * @Arguments
   *  sid - the server id that has the client
   *  cid - the client id
   *  channel - the target channel
   * */
  subscribeClient(sid, cid, channel) {
    this.subscribeNode(sid, channel);
    if (typeof this.clientChannels[channel] === 'undefined') {
      this.clientChannels[channel] = [];
    }
    let idx = this.clientChannels[channel].indexOf(cid);
    if (idx === -1) {
      this.clientChannels[channel].push(cid);
      this.emit('client.join', channel, cid);
    }
    return true;
  }

  /**
   * Unsubscribes the given client id from the specified channel
   * @Arguments
   *  - cid - the client id to use
   *  - channel - the channel name
   * */
  unsubscribeClient(cid, channel) {
    if (typeof this.clientChannels[channel] === 'undefined') return false;
    let cidx = this.clientChannels[channel].indexOf(cid);
    if (cidx === -1) return false;
    this.clientChannels[channel].splice(cidx, 1);
    this.emit('client.leave', channel, cid);
    if (this.clientChannels[channel].length === 0) {
      delete this.clientChannels[channel];
      this.removeChannel(channel);
    }
    return true;
  }

  /**
   * Checks if a client is subscribed to a specific channel
   * @Arguments
   *  cid - the client id to use
   *  channel - the channel name
   * */
  isClientSubscribed(cid, channel) {
    if (typeof this.clientChannels[channel] === 'undefined') return false;
    let idx = this.clientChannels[channel].indexOf(cid);
    return (idx !== -1);
  }

  /**
   * Completely removes a client from all channels
   * @Arguments
   *  cid - the client id to use
   * */
  removeClient(sid) {
    let channels = Object.keys(this.clientChannels);
    for (let i = 0, len = channels.length; i < len; i++) {
      let c = channels[i];
      this.unsubscribeClient(sid, c);
    }
    return true;
  }

  /**
   * Returns an array with all the client's active subscriptions
   * @Arguments
   *  cid - the client id to use
   * */
  getClientSubscriptions(cid) {
    let items = [];
    let channels = Object.keys(this.clientChannels);
    for (let i = 0, len = channels.length; i < len; i++) {
      let c = channels[i];
      if (this.clientChannels[c].indexOf(cid) !== -1) {
        items.push(c);
      }
    }
    return items;
  }

  /**
   * Destroys a channel
   * */
  removeChannel(channel) {
    if (typeof this.nodeChannels[channel] !== 'undefined') {
      let len = this.nodeChannels[channel].length - 1;
      while (len >= 0) {
        let sid = this.nodeChannels[channel][len];
        this.unsubscribeNode(sid, channel);
        len = (this.nodeChannels[channel] || []).length - 1;
      }
    }
    if (typeof this.clientChannels[channel] !== 'undefined') {
      let len = this.clientChannels[channel].length - 1;
      while (len >= 0) {
        let cid = this.clientChannels[channel][len];
        this.unsubscribeClient(cid, channel);
        len = (this.clientChannels[channel] || []).length - 1;
      }
    }
  }


  /**
   * Sends a message to the specified channel
   * */
  sendMessage(channel, message, senderSid, ignoreNodes) {
    if (typeof message === 'object' && message) message = JSON.stringify(message);
    let hasNodes = false,
      hasClients = false;
    if (typeof this.nodeChannels[channel] !== 'undefined') {
      hasNodes = true;
      if (!ignoreNodes) {
        for (let i = 0, len = this.nodeChannels[channel].length; i < len; i++) {
          let sid = this.nodeChannels[channel][i];
          this.emit('node.message', channel, sid, message);
        }
      }
    } else {
      // we need to broadcast the message.
      this.emit('node.broadcast', channel, message);
    }
    if (typeof this.clientChannels[channel] !== 'undefined') {
      hasClients = true;
      for (let i = 0, len = this.clientChannels[channel].length; i < len; i++) {
        let cid = this.clientChannels[channel][i];
        this.emit('client.message', channel, cid, message);
      }
    }
    if (!hasNodes && !hasClients) return false;
    if (!senderSid || (senderSid && this.isNodeSubscribed(senderSid, channel))) {
      this.emit('channel.message', channel, message);
    }
    return true;
  }

}

module.exports = ChannelHub;
