'use strict';
/**
 * This is an example Quty server working in cluster mode with
 * other quty servers.
 * */

/* TEMPORARY OVERRIDES */
//process.env.CLUSTER_DISCOVERY_NODES = "127.0.0.1:23032,127.0.0.1:23033";
process.env.CLUSTER_DISCOVERY_SERVICE = 'localhost';
//process.env.CLUSTER_DISCOVERY_FETCH = 'http://localhost:8678/quty-discovery?test=1';

const config = require('./config/app');
const quty = require('./index.js'); // change this with require('quty');
if (config.debug) quty.log.setLevel(config.debug);


(async () => {
  const cluster = new quty.Cluster(config.cluster);

  /* Start the internal cluster server */
  try {
    await cluster.listen();
  } catch (e) {
    console.error(e);
    return process.exit(1);
  }
  cluster.on('ready', async () => {
    console.log('Quty started');
  });
})();
