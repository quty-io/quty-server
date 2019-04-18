'use strict';
const EventEmitter = require('events').EventEmitter;

/**
 * A ChannelHub class is responsible for keeping track of:
 * - what server is in which channel
 * - what client is subscribed to which channels
 * The hub acts as a distributed in-memory map, that all cluster nodes
 * will eventually have access to.
 * Events triggered:
 *  - channel.add(channel)
 *  - channel.message(channel, message)
 *  - channel.remove(channel)
 *  - node.join(channel, sid)
 *  - node.message(channel, sid, message)
 *  - node.leave(channel, sid)
 *  - client.join(channel, cid)
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
   * Destroys a channel
   * */
  removeChannel(channel) {
    if (typeof this.nodeChannels[channel] === 'undefined') return;
    let len = this.nodeChannels[channel].length - 1;
    while (len >= 0) {
      let sid = this.nodeChannels[channel][len];
      this.unsubscribeNode(sid, channel);
      len = (this.nodeChannels[channel] || []).length - 1;
    }
  }

  /**
   * Completely removes a node from all channels
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
    }
    if (typeof this.clientChannels[channel] !== 'undefined') {
      hasClients = true;
      // TODO
    }
    if (!hasNodes && !hasClients) return false;
    if (!senderSid || (senderSid && this.isNodeSubscribed(senderSid, channel))) {
      this.emit('channel.message', channel, message);
    }
    return true;
  }

}

module.exports = ChannelHub;
