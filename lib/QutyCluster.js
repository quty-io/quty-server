'use strict';
const Server = require('./Server'),
  url = require('url'),
  qs = require('querystring'),
  log = require('./logger');


class QutyCluster extends Server {

  constructor(config) {
    super(config);
    this.name = 'cluster';
    this.setAuthorization(this.authorizeClient.bind(this));
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
    let tokenData = this.verifyToken(data.token);
    if (!tokenData) return false;
    socket.sid = tokenData._s;  // set the server id
    delete tokenData._s;
    socket.data = tokenData || {};
    return true;
  }

}

module.exports = QutyCluster;
