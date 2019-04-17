'use strict';
/**
 * This is an example Quty server working in cluster mode with
 * other quty servers.
 * */
const config = require('./config/app');
const quty = require('./index.js'); // change this with require('quty');
if (config.debug) quty.log.setLevel(config.debug);
const cluster = new quty.Cluster(config.cluster);

(async () => {
  try {
    await cluster.listen();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
