'use strict';
/**
 * This is an example Quty server working in cluster mode with
 * other quty servers.
 * */

/* TEMPORARY OVERRIDES */
process.env.CLUSTER_DISCOVERY_NODES = "127.0.0.1:23032,127.0.0.1:23033";
process.env.CLUSTER_DISCOVERY_SERVICE = 'localhost';
//process.env.CLUSTER_DISCOVERY_FETCH = 'http://localhost:8678/quty-discovery?test=1';

const config = require('./config/app');
const quty = require('./index.js'); // change this with require('quty');
if (config.debug) quty.log.setLevel(config.debug);


(async () => {
  const cluster = new quty.Cluster(config.cluster);


  const channelHub = cluster.hub;
  const log = quty.log;

  /** DEBUGGING/TESTING */

  channelHub
    .on('channel.add', (name) => {
      log.info(`Adding channel: ${name}`);
    })
    .on('channel.message', (channel, msg) => {
      log.info(`Message in ${channel}: ${msg}`);
    })
    .on('channel.remove', (name) => {
      log.info(`Removing channel: ${name}`);
    })
    .on('node.join', (c, sid) => {
      log.info(`Node ${sid} joined: ${c}`);
    })
    .on('node.leave', (c, sid) => {
      log.info(`Node ${sid} left: ${c}`);
    })
    .on('client.join', (c, cid) => {
      log.info(`Client ${cid} joined: ${c}`);
    })
    .on('client.message', (channel, clientId, message) => {
      log.info(`=> SEND TO ${channel}.${clientId}: ${message}`);
    })
    .on('client.leave', (c, cid) => {
      log.info(`Client ${cid} left: ${c}`);
    });

  /* Start the internal cluster server */
  try {
    await cluster.listen();
  } catch (e) {
    console.error(e);
    return process.exit(1);
  }
  cluster.on('ready', () => {
    console.log("WE'RE READY NOW");
    let ok = cluster.sendMessage('channel1', 'Hello world!');
  });
})();
