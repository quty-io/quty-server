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
const CLUSTER_READY_TIMEOUT = 5000;
const nodes = Symbol('nodes'),
  nodeIps = Symbol('nodeIps'),
  pendingNodes = Symbol('pendingNodes'),
  clusterReady = Symbol('clusterReady'),
  clusterPendingEvents = Symbol('clusterPendingEvents'),
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
 *  - publisher.add(socket) -> fired when a publisher client is connected
 *  - publisher.remove(socket)  -> fired when a publisher client disconnects.
 *
 *  Additional configuration:
 *    - config.discovery.timer -> the number of milliseconds between new node discovery calls
 *    - config.maxReadyAfter -> the maximum number of milliseconds we are going to trigger the 'ready' event.
 * */

class QutyCluster extends Server {

  constructor(config, channelHub) {
    if (typeof config !== 'object' || !config) config = {};
    // The quty cluster forces port, to use internal ws
    if (config.server) delete config.server;
    if (config.engine) delete config.engine;
    super(config);
    this.name = 'quty-cluster';
    this[clusterReady] = false;
    this[clusterPendingEvents] = []; // an array of pending events that came in before the cluster was ready
    this[nodes] = {}; // a map of {nodeId:socketObj}
    this[nodeIps] = {}; // a map of {nodeIp+nodePort:nodeId}
    this[pendingNodes] = {}; // a map of {nodeIp+nodePort} that are in pending state
    this.setAuthorization(this.authorizeClient.bind(this));
    if (!channelHub) channelHub = new ChannelHub();
    this.hub = channelHub;
    this.ready = false;
    this.hub.on('client.message', (channel, cid, msg) => {
      this.emit('message', channel, cid, msg);
    });
    // Once the cluster is ready, we will self-connect.
    let readyTimeout;
    this.once('ready', () => {
      if (nodes.length > 0) {
        log.info(`[quty-cluster] is now connected to ${nodes.length} node(s) and ready`);
      }
      if (readyTimeout) clearTimeout(readyTimeout);
      this.startDiscovery();
    });
    this.once('listen', async () => {
      _bindServer.call(this);
      _bindChannelHub.call(this, this.hub);
      try {
        await this.discover();
      } catch (e) {
      }
      // If we have zero nodes, we will not perform the delayed 'ready' event
      let nodes = this.getConnectedNodes();
      if (nodes.length === 0 && (!config.discovery.service && !config.discovery.fetch && (!config.discovery.nodes || config.discovery.nodes.length === 0))) {
        log.info(`[quty-cluster] is now ready`);
        _setClusterReady.call(this);
      } else {
        readyTimeout = setTimeout(() => {
          _setClusterReady.call(this);
        }, config.maxReadyAfter || CLUSTER_READY_TIMEOUT);
      }
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
        log.warn(`[quty-cluster] could not resolve discovery hostname: ${config.discovery.service} [${e.message}]`);
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
        log.trace(`[quty-cluster] could not fetch nodes from endpoint: ${config.discovery.fetch} [${e.message}]`);
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
        log.warn(`[quty-cluster]: could not add node: ${addr} [${e.message}]`);
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
      let shouldTriggerReady = false;
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
            if (clientObj.sid !== this.id) {
              shouldTriggerReady = true;
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
      if (shouldTriggerReady) {
        _setClusterReady.call(this);
      }
      return true;
    } catch (e) {
      log.debug(`[quty-cluster]: could not connect to node: ${url} [${e.message}]`);
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
   * Returns an array of connected nodes, exclusind the current server
   * */
  getConnectedNodes() {
    let items = [],
      n = this.nodes;
    for (let i = 0, len = n.length; i < len; i++) {
      if (n[i].sid === this.id) continue;
      items.push(n[i]);
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
      secret: this.config.auth
    });
    if (!tokenData) return false;
    if (tokenData._t === token.TYPE.CLUSTER) {
      if (!tokenData._i) return false;
      // We place our data in socket.quty, so that we can transfer it to the websocket socket, from the http socket.
      socket.quty = {
        sid: tokenData._i
      };
    } else if (tokenData._t === token.TYPE.CLUSTER_CLIENT) {
      if (!tokenData._i) {
        tokenData._i = util.randomString(12);
      }
      // We have a publisher client connecting.
      socket.quty = {
        pid: tokenData._i
      };
    } else {
      return false;
    }
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
   * Kicks a client from the server.
   * @Arguments
   *  - cid - the client id
   * */
  disconnectClient(cid) {
    if (typeof cid === 'number') cid = cid.toString();
    if (typeof cid !== 'string' || !cid) return false;
    this.hub.removeClient(cid);
    this.hub.emit('client.remove', cid);
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
  handleClusterClient = handleClusterClient.bind(this);
  handleClusterPublisher = handleClusterPublisher.bind(this);
  /**
   * Handle a new client connection
   * */
  this.on('client', (socket) => {
    // IF we have a publisher client connected ,we handle it.
    if (socket.pid) {
      return handleClusterPublisher(socket);
    }
    // If we have a cluster client, handle it now
    if (socket.sid) {
      return handleClusterClient(socket);
    }
    // WE don't recognize, close it.
    try {
      socket.close();
    } catch (e) {
    }
  });

  /**
   * Handle the client disconnect
   * */
  this.on('disconnect', (socket) => {
    if (socket.sid) {
      // Handle disconnected node
      if (!socket.sid || !socket.url) return;
      delete this[nodes][socket.sid];
      delete this[nodeIps][socket.url];
      return this.emit('node.remove', socket);
    }
    if (socket.pid) {
      // Handle disconnected publisher
      log.trace(`[quty-cluster] publisher client [${socket.pid}] disconnected from: ${socket.remoteAddress}`);
      return this.emit('publisher.remove', socket);
    }
  });

  /**
   * Handle the adding of a node
   * */
  this.on('node.add', (socket) => {
    let surl = socket.url;
    if (surl.indexOf('://') !== -1) {
      surl = socket.url.split('://')[1].split('/')[0];
    }
    log.debug(`[quty-cluster] added node: ${socket.sid} [${surl}]`);
    let data = {
      s: this.id,
      n: this.nodes,
      c: this.hub.getNodeSubscriptions(this.id)
    };
    this.broadcast(events.CLUSTER.NODE_STATE, data, true);
  });
  /**
   * Handle the removing of a node
   * */
  this.on('node.remove', (socket) => {
    let surl = socket.url;
    if (surl.indexOf('://') !== -1) {
      surl = socket.url.split('://')[1].split('/')[0];
    }
    log.debug(`[quty-cluster] removed node: ${socket.sid} [${surl}]`);
    let data = {
      s: this.id,
      n: this.nodes,
      c: this.hub.getNodeSubscriptions(this.id)
    };
    this.hub.removeNode(socket.sid);
    this.broadcast(events.CLUSTER.NODE_STATE, data, true);
  });

  /**
   * Handle an incoming message from a QutyClient
   * */
  this.on('event', (e, socket) => {
    /** Check the cluster state, and see if we can connect to other nodes */
    if (e.event === events.CLUSTER.NODE_STATE) {
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
          this.hub.subscribeNode(e.data.s, e.data.c[i]);
        }
      }
      // Once we received the first cluster state, we mark the cluster as ready.
      if (!this[clusterReady]) {
        _setClusterReady.call(this);
      }
      return;
    }
    if (!this[clusterReady]) {
      this[clusterPendingEvents].push({
        socket,
        e
      });
      return;
    }
    /** Handles incoming messages from a server */
    if (socket.sid) {
      let sid = e.data.s;
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
        return this.hub.sendMessage(e.data.c, e.data.m, sid, {
          nodes: false,
          broadcast: false
        });
      }
    }

    /** Handle incoming messages from a publisher */
    if (socket.pid) {
      /* Handles the publishing of a message from a publisher */
      if (e.event === events.CLUSTER.CHANNEL_MESSAGE) {
        if (!e.data.c) return;
        return this.hub.sendMessage(e.data.c, e.data.m, this.id);
      }
    }
    /** Common functionality for both publishers/nodes */
    /* Handles kicking a client from the server. */
    if (e.event === events.CLUSTER.CLIENT_KICK) {
      if (!e.data.cid) return;
      this.disconnectClient(e.data.cid);
      if (socket.pid) { // If it comes from a publisher, we broadcast to other nodes.
        this.broadcast(events.CLUSTER.CLIENT_KICK, e.data, true);
      }
      return;
    }
    /* Handles unsubscribing a client from a channel */
    if (e.event === events.CLUSTER.CLIENT_UNSUBSCRIBE) {
      if (!e.data.c || !e.data.cid) return;
      this.unsubscribeClient(e.data.cid, e.data.c);
      if (socket.pid) { // If it comes from a publisher, broadcast.
        this.broadcast(events.CLUSTER.CLIENT_UNSUBSCRIBE, e.data, true);
      }
      return;
    }
  });

  /**
   * Handles simple HTTP-Server status and ping
   * */
  this.$get(['/', '/ping'], (req, res) => {
    if (!this.ready) {
      res.setHeader('Content-Type', 'text/plain');
      res.statusCode = 503;
      return res.end('Service Unavailable');
    }
    res.setHeader('Content-Type', 'text/plain');
    res.statusCode = 200;
    return res.end('Ready');
  });
  this.$get(['/_status', '/health'], (req, res) => {
    let result = {
      ready: this.ready,
      nodes: this.nodes,
      channels: this.hub.channels
    };
    this._sendHttpJson(res, result);
  });
}

/**
 * The function handles an incoming QutyClient connection.
 * This is essentially another cluster-node connecting to us.
 * */
function handleClusterClient(socket) {
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
    log.trace(`[quty-cluster]: node ${socket.sid} is already present`);
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
}

/**
 * This function handles an incoming Publisher connection.
 * Publishers area send-only connections that do not receive node-broadcasts and updates.
 * */
function handleClusterPublisher(socket) {
  log.trace(`[quty-cluster] publisher client [${socket.pid}] connected from: ${socket.remoteAddress}`);
  this.emit('publisher.add', socket);
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
        b: true, //specify it is a broadcast
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

/**
 * Marks the cluster as ready, flushing any pending events
 * */
function _setClusterReady() {
  if (this.ready || this[clusterReady]) return;
  this[clusterReady] = true;
  this.ready = true;
  let pending = this[clusterPendingEvents];
  this[clusterPendingEvents] = [];
  for (let i = 0, len = pending.length; i < len; i++) {
    let t = pending[i];
    if (!t.socket.isAlive) continue;
    this.emit('event', t.e, t.socket);
  }
  this.emit('ready');
}

module.exports = QutyCluster;
