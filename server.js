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

  // tests TODO remove:
  try {
    let token = cluster.createToken({
      dc: 'europe'
    });
    let cObj = new quty.Client({
      url: 'ws://localhost:23032',
      token
    });
    console.log(token);
    await cObj.connect();
    console.log("All done bro, Connected");
  } catch (e) {
    console.log(e);
  }
})();
