'use strict';
const Server = require('./Server'),
  QutyClient = require('./QutyClient'),
  url = require('url'),
  qs = require('querystring'),
  token = require('./token'),
  log = require('./logger');

const nodes = Symbol('nodes');

class QutyCluster extends Server {

  constructor(config) {
    if (typeof config !== 'object' || !config) config = {};
    super(config);
    this.name = 'cluster';
    this[nodes] = {}; // a map of {nodeId:socketObj}
    this.setAuthorization(this.authorizeClient.bind(this));
    // Once the cluster is ready, we will self-connect.
    this.once('ready', async () => {
      let authToken = token.create({}, {
        secret: config.auth,
        type: token.TYPE.CLUSTER,
        id: this.id
      });
      let cObj = new QutyClient({
        url: `ws://127.0.0.1:${config.port}${config.path || '/'}`,
        token: authToken
      });
      try {
        await cObj.connect();
        this[nodes][this.id] = cObj.socket;
      } catch (e) {
        log.error(`Quty cluster: could not self-connect to node`);
        log.error(e);
      }
    });
  }

  /**
   * Handles cluster client authorisation on connection.
   * */
  authorizeClient(request, socket) {
    log.trace(`Client connected:`);
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
    socket.sid = tokenData._i;
    delete tokenData._i;
    socket.data = tokenData || {};
    return true;
  }

}

module.exports = QutyCluster;
