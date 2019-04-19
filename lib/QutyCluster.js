'use strict';
const Server = require('./Server'),
  QutyClient = require('./QutyClient'),
  ChannelHub = require('./ChannelHub'),
  url = require('url'),
  qs = require('querystring'),
  events = require('./events'),
  token = require('./token'),
  util = require('./util'),
  log = require('./logger');

const DISCOVERY_CHECK_TIMER = 3000; // we check for new nodes once every few seconds

const nodes = Symbol('nodes'),
  nodeIps = Symbol('nodeIps'),
  pendingNodes = Symbol('pendingNodes'),
  discovery = Symbol('discovery');

/**
 * This is the Quty Cluster component that handles cluster-node-communication.
 * It makes sure it correctly routes room-events through different
 * servers within the mesh.
 *
 * Events: (see: lib/Server.js events also)
 *  - message(channel, cid, message) -> proxies client.message requests from our ChannelHub
 *  - node.add(socket) -> fired when a node connects to the server
 *  - node.remove(socket) -> fired when a node is removed from the server.
 * */

class QutyCluster extends Server {

  constructor(config, channelHub) {
    if (typeof config !== 'object' || !config) config = {};
    super(config);
    this.name = 'cluster';
    this[nodes] = {}; // a map of {nodeId:socketObj}
    this[nodeIps] = {}; // a map of {nodeIp+nodePort:nodeId}
    this[pendingNodes] = {}; // a map of {nodeIp+nodePort} that are in pending state
    this.setAuthorization(this.authorizeClient.bind(this));
    if (!channelHub) channelHub = new ChannelHub();
    this.hub = channelHub;
    this.hub.on('client.message', (channel, cid, msg) => {
      this.emit('message', channel, cid, msg);
    });
    // Once the cluster is ready, we will self-connect.
    this.once('listen', async () => {
      _bindServer.call(this);
      _bindChannelHub.call(this, this.hub);
      try {
        await this.discover();
      } catch (e) {
      }
      let nodeCount = this.nodes.length;
      if (nodeCount === 0) {
        log.info(`(Quty cluster) is now ready`);
      } else {
        log.info(`(Quty cluster) is now connected to ${nodeCount} node(s) and ready`);
      }
      this.emit('ready');
      this.startDiscovery();
    });
  }

  /**
   * Broadcasts an event to all connected nodes.
   * @Arguments
   * - event - the event we want to send
   * - data - the data we want to send
   * - excludeSelf(bool) - if set to true, we do not send to our own client.
   * */
  broadcast(event, data, excludeSelf) {
    let nodeIds = Object.keys(this[nodes]);
    for (let i = 0, len = nodeIds.length; i < len; i++) {
      let socket = this[nodes][nodeIds[i]];
      if (excludeSelf === true && socket.sid === this.id) continue;
      util.sendSocketEvent(socket, event, data);
    }
  }

  /**
   * Initiates the discovery process, looking for other cluster-nodes.
   * */
  async startDiscovery() {
    if (this[discovery]) {
      clearTimeout(this[discovery]);
    }
    let config = this.config;
    this[discovery] = setTimeout(async () => {
      try {
        await this.discover();
      } catch (e) {
        log.warn(`Quty cluster: could not perform discovery: ${e.message}`);
      }
      this.startDiscovery();
    }, config.discovery.timer || DISCOVERY_CHECK_TIMER);
  }

  /**
   * Performs a discovery check. The server will:
   * 1. Look for DNS resolutions of a specific service (used in Kubernetes mode)
   * 2. Manually connect to the specified nodes in the configuration
   * 3. Perform an HTTP Call to the specified discovery endpoint and expect to connect to those nodes.
   * */
  async discover() {
    const config = this.config;
    if (!config.discovery) return; // no discovery set.
    let discoveredNodes = [],
      nodeMap = {}; // for uniqueness

    function parseItem(item) {
      if (typeof item === 'object' && item && item.ip) {
        item = `${item.ip}:${item.port || config.port}`;
      }
      if (typeof item === 'string' && item) {
        if (nodeMap[item]) return;
        nodeMap[item] = true;
        return item;
      }
    }

    // Perform DNS-based service discovery
    if (config.discovery.service) {
      try {
        let ips = await util.resolveHostname(config.discovery.service);
        ips.forEach((ip) => {
          let c = parseItem(`${ip}:${config.port}`);
          if (c) discoveredNodes.push(c);
        });
      } catch (e) {
        log.warn(`(Quty cluster) could not resolve discovery hostname: ${config.discovery.service} [${e.message}]`);
      }
    }
    // Use the specified node list
    if (config.discovery.nodes instanceof Array) {
      for (let i = 0, len = config.discovery.nodes.length; i < len; i++) {
        let item = config.discovery.nodes[i];
        // Check if we have {ip, port}
        let c = parseItem(item);
        if (c) discoveredNodes.push(c);
      }
    }
    // Perform a FETCH to the specified API endpoint
    if (config.discovery.fetch) {
      try {
        let res = await util.fetch(config.discovery.fetch, {
          method: 'GET',
          data: {
            id: this.id
          }
        });
        if (!(res instanceof Array)) throw new Error('Result is not an array');
        for (let i = 0, len = res.length; i < len; i++) {
          let c = parseItem(res[i]);
          if (c) discoveredNodes.push(c);
        }
      } catch (e) {
        log.trace(`(Quty cluster) could not fetch nodes from endpoint: ${config.discovery.fetch} [${e.message}]`);
      }
    }
    if (discoveredNodes.length === 0) {
      discoveredNodes.push(`127.0.0.1:${config.port}`);
      return false;
    }
    for (let i = 0, len = discoveredNodes.length; i < len; i++) {
      let addr = discoveredNodes[i];
      try {
        await this.addNode(addr);
      } catch (e) {
        log.warn(`Quty cluster: could not add node: ${addr} [${e.message}]`);
      }
    }
    return true;
  }

  /**
   * Adds the specified node to the cluster, by connecting to it.
   * @Arguments
   *  address - a string with "{ws}://{ip}:{port}
   *            OR
   *          - a string with "{ip}:{port}
   *            OR
   *          - a string with "ip"
   *            OR
   *          - an object with {ip, port, proto}
   * */
  async addNode(address) {
    let proto, ip, port,
      config = this.config;
    let aType = (typeof address);
    if (aType === 'object' && address && typeof address.ip === 'string') {
      ip = address.ip;
      port = (typeof address.port === 'number' ? address.port : config.port);
      proto = (typeof address.proto === 'string' ? address.proto : 'ws');
    } else if (aType === 'string') {
      if (address.indexOf('://') !== -1) {
        let tmp = address.split('://');
        proto = tmp[0];
        address = tmp[1];
      }
      if (address.indexOf(':') !== -1) {
        let tmp = address.split(':');
        ip = tmp[0];
        port = parseInt(tmp[1]);
      } else {
        ip = address;
        port = config.port;
      }
      if (!proto) proto = 'ws';
    }
    if (!ip || !port || !proto) return false;
    let url = `${proto}://${ip}:${port}`,
      nodeKey = `${ip}:${port}`;
    if (this[nodeIps][nodeKey]) return true;  // already added.
    if (this[pendingNodes][nodeKey]) return false; // pending connect
    this[pendingNodes][nodeKey] = true;
    let clientObj = new QutyClient({
      url,
      token: () => token.create({
        port: config.port
      }, {
        secret: config.auth,
        type: token.TYPE.CLUSTER,
        id: this.id
      })
    });
    try {
      await clientObj.connect((resolve, reject) => {
        let _t = setTimeout(() => {
          reject(new Error('Quty client: server failed to provide info in a timely manner'));
        }, 3000);
        clientObj.once(events.CLUSTER.NODE_INFO, (data) => {
          clearTimeout(_t);
          let socket = clientObj.socket;
          socket.sid = data._i;
          clientObj.sid = socket.sid;
          if (data.c instanceof Array) {
            // Try to subscribe this node to its channels.
            for (let i = 0, len = data.c.length; i < len; i++) {
              this.hub.subscribeNode(socket.sid, data.c[i]);
            }
          }
          resolve();
        });
      });
      if (clientObj.socket.sid === this.id) {
        // self-connected
        _bindClientNode.call(this, clientObj);
        delete this[pendingNodes][nodeKey];
        return true;
      }
      if (this[nodes][clientObj.socket.sid]) {
        log.trace(`Quty cluster: node ${clientObj.socket.sid} is already present`);
        clientObj.destroy();
        return false;
      }
      this[nodes][clientObj.socket.sid] = clientObj.socket;
      this[nodeIps][clientObj.url] = clientObj.socket.sid;
      _bindClientNode.call(this, clientObj);
      this.emit('node.add', clientObj.socket);
      delete this[pendingNodes][nodeKey];
      return true;
    } catch (e) {
      log.debug(`Quty cluster: could not connect to node: ${url} [${e.message}]`);
      delete this[pendingNodes][nodeKey];
      return false;
    }
  }

  /**
   * Returns the socket of a node given the node sid
   * @Arguments
   *  sid - the node id
   * */
  getNode(sid) {
    return this[nodes][sid] || null;
  }

  /**
   * Getter function that returns an array of all connected notes as {url,sid}
   * */
  get nodes() {
    let items = [];
    let keys = Object.keys(this[nodeIps]);
    for (let i = 0, len = keys.length; i < len; i++) {
      let url = keys[i],
        sid = this[nodeIps][url];
      items.push({
        url,
        sid
      });
    }
    return items;
  }

  /**
   * Handles cluster client authorisation on connection.
   * Since the QutyCluster uses the auth token/token creation to handle new client connections
   * within the cluster, it registers itself here.
   * */
  authorizeClient(request, socket) {
    let rurl = url.parse(request.url);
    if (!rurl.query) return false;
    let data = qs.parse(rurl.query);
    if (!data.token) return false;
    let tokenData = token.verify(data.token, {
      type: token.TYPE.CLUSTER,
      secret: this.config.auth
    });
    if (!tokenData) return false;
    if (!tokenData._i) return false;
    // We place our data in socket.quty, so that we can transfer it to the websocket socket, from the http socket.
    socket.quty = {
      sid: tokenData._i
    };
    delete tokenData._i;
    socket.quty.data = tokenData || {};
    return true;
  }


  /**
   * Sends a message to the specified channel. This uses the cluster's ChannelHub
   * object and abstracts-away the channel-specific functionality
   * @Arguments
   *  - channel - the channel to send the message to
   *  - message - the message to send
   * */
  sendMessage(channel, message) {
    return this.hub.sendMessage(channel, message, this.id);
  }

  /**
   * Subscribes the specified client to the specified channel. This uses the cluster's ChannelHub
   * and is a proxy function for adding a client to a channel.
   * @Arguments
   *  - cid - the client id
   *  - channel - the target channel
   * */
  subscribeClient(cid, channel) {
    if (typeof cid === 'number') cid = cid.toString();
    if (typeof channel !== 'string' || !channel) return false;
    if (typeof cid !== 'string' || !cid) return false;
    return this.hub.subscribeClient(this.id, cid, channel);
  }

  /**
   * Unsubscribes the specified client from the specified channel. This is a proxy
   * function that uses the internal ChannelHub object
   *  @Arguments
   *  - cid - the client id
   *  - channel - the target channel(optional)
   *  Note:
   *  if channel is not specified, remove the client completely.
   * */
  unsubscribeClient(cid, channel) {
    if (typeof cid === 'number') cid = cid.toString();
    if (typeof cid !== 'string' || !cid) return false;
    if (typeof channel !== 'string' || !channel) {
      return this.hub.removeClient(cid);
    }
    return this.hub.unsubscribeClient(cid, channel);
  }

  /**
   * Checks if a client is subscribed to a channel. This is a proxy function call that
   * uses the internal ChannelHub object
   * @Arguments
   *  - cid - the client id
   *  - channel - the target channel name.
   * */
  isClientSubscribed(cid, channel) {
    if (typeof cid === 'number') cid = cid.toString();
    if (typeof cid !== 'string' || !cid) return false;
    return this.hub.isClientSubscribed(cid, channel);
  }

}

/**
 * Starts listening to events from a client node.
 * */
function _bindClientNode(clientObj) {
  let removed = false,
    self = this;

  function remove() {
    delete self[nodes][clientObj.sid];
    delete self[pendingNodes][clientObj.url];
    delete self[nodeIps][clientObj.url];
    try {
      clientObj.destroy();
    } catch (e) {
    }
    if (!removed) {
      removed = true;
      self.emit('node.remove', clientObj.socket);
    }
  }

  clientObj.on('destroy', remove);
  clientObj.on('disconnect', remove);
  let socket = clientObj.socket;
  clientObj.on('event', (e) => {
    this.emit('event', e, socket);
  });
}

/**
 * Binds the server to listen to specific events that are coming from the parent server class.
 * */
async function _bindServer() {
  /**
   * Handle a new client connection
   * */
  this.on('client', (socket) => {
    // First, we send the client our information
    let clusterInfo = {
      _t: token.TYPE.CLUSTER,
      _i: this.id,
      c: this.hub.getNodeSubscriptions(this.id)
    };
    this.sendEvent(socket, events.CLUSTER.NODE_INFO, clusterInfo);
    // Next, we try adding this server to our local connections.
    let ip = `${socket.remoteAddress}`,
      port = socket.data.port;
    if (!ip || !port) return;
    let nodeKey = `${ip}:${port}`;
    // IF we already have an active connection with this node, we drop this one.
    if (this[nodeIps][nodeKey]) {
      log.trace(`Quty cluster: node ${socket.sid} is already present`);
      try {
        socket.close();
      } catch (e) {
      }
      return;
    }
    this[nodes][socket.sid] = socket;
    this[nodeIps][nodeKey] = socket.sid;
    socket.url = nodeKey;
    this.emit('node.add', socket);
  });

  /**
   * Handle the client disconnect
   * */
  this.on('disconnect', (socket) => {
    if (!socket.sid || !socket.url) return;
    delete this[nodes][socket.sid];
    delete this[nodeIps][socket.url];
    this.emit('node.remove', socket);
  });

  /**
   * Handle the adding of a node
   * */
  this.on('node.add', (socket) => {
    let surl = socket.url;
    if (surl.indexOf('://') !== -1) {
      surl = socket.url.split('://')[1].split('/')[0];
    }
    log.debug(`(Quty server) added node: ${socket.sid} [${surl}]`);
    let data = {
      s: this.id,
      n: this.nodes,
      c: this.hub.getNodeSubscriptions(this.id)
    };
    this.broadcast(events.CLUSTER.NODE_STATE, data);
  });
  /**
   * Handle the removing of a node
   * */
  this.on('node.remove', (socket) => {
    let surl = socket.url;
    if (surl.indexOf('://') !== -1) {
      surl = socket.url.split('://')[1].split('/')[0];
    }
    log.debug(`(Quty server) removed node: ${socket.sid} [${surl}]`);
    let data = {
      s: this.id,
      n: this.nodes,
      c: this.hub.getNodeSubscriptions(this.id)
    };
    this.hub.removeNode(socket.sid);
    this.broadcast(events.CLUSTER.NODE_STATE, data);
  });

  /**
   * Handle an incoming message from a server.
   * */
  this.on('event', (e, socket) => {
    /* Check the cluster state, and see if we can connect to other nodes */
    let sid = e.data.s;
    if (e.event === events.CLUSTER.NODE_STATE) {
      if (sid === this.id) return;
      if (e.data.n instanceof Array) {
        // Try to discover new nodes
        for (let i = 0, len = e.data.n.length; i < len; i++) {
          let node = e.data.n[i];
          if (node.sid === this.id) continue;
          if (this[nodes][node.sid] || this[nodeIps][node.url]) continue;
          this.addNode(node.url); // async but will never fail.
        }
      }
      if (e.data.c instanceof Array) {
        // Try to subscribe this node to its channels.
        for (let i = 0, len = e.data.c.length; i < len; i++) {
          this.hub.subscribeNode(sid, e.data.c[i]);
        }
      }
      return;
    }
    /* Handle when a node wants to join a channel */
    if (e.event === events.CLUSTER.CHANNEL_JOIN) {
      if (!e.data.c) return;
      return this.hub.subscribeNode(socket.sid, e.data.c);
    }
    /* Handle when a node wants to leave a channel */
    if (e.event === events.CLUSTER.CHANNEL_LEAVE) {
      if (!e.data.c) return;
      return this.hub.unsubscribeNode(socket.sid, e.data.c);
    }
    /* Handles the propagation of a message from another node */
    if (e.event === events.CLUSTER.CHANNEL_MESSAGE) {
      if (!e.data.c) return;
      return this.hub.sendMessage(e.data.c, e.data.m, sid, true);
    }
  });
}

/**
 * Starts listening to Channel hub events, so that we can
 * propagate the channel-state to other nodes
 * */
function _bindChannelHub(hub) {

  hub.on('node.join', (channel, sid) => {
    if (sid !== this.id) return;  // we only broadcast on current sid.
    this.broadcast(events.CLUSTER.CHANNEL_JOIN, {
      c: channel
    }, true);
  });
  hub.on('node.message', (channel, sid, message) => {
    if (sid === this.id) return;
    let targetNode = this.getNode(sid);
    if (!targetNode) return;
    util.sendSocketEvent(targetNode, events.CLUSTER.CHANNEL_MESSAGE, {
      c: channel,
      s: sid,
      m: message
    });
  });
  hub.on('node.broadcast', (channel, message) => {
    Object.keys(this[nodes]).forEach((sid) => {
      let socket = this[nodes][sid];
      util.sendSocketEvent(socket, events.CLUSTER.CHANNEL_MESSAGE, {
        c: channel,
        s: this.id,
        m: message
      });
    });
  });

  hub.on('node.leave', (channel, sid) => {
    if (sid !== this.id) return;  // we only broadcast on current sid.
    this.broadcast(events.CLUSTER.CHANNEL_LEAVE, {
      c: channel,
      s: sid
    }, true);
  });

}


module.exports = QutyCluster;
