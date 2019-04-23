'use strict';
/**
 * This example shows a simple Quty cluster and a separate Quty Client that connects to the cluster
 * to send messages only (it does not process messages, just publish messages)
 * Run the example:
 * node quty-publisher.js --host=127.0.0.1:23032
 * Note: the Port must be the Quty-cluster port, and NOT the external QutyHub (or ws engine) port
 * */
// Parse our argv variables
let arg = {};
(() => {
  process.argv.forEach((k) => {
    if (k.substr(0, 2) !== '--') return;
    let tmp = k.substr(2).split('=');
    arg[tmp[0]] = tmp[1];
  });
})();

const quty = require('../index.js');  // require('quty');
quty.log.setLevel('TRACE');
const pub = new quty.Publisher({
  url: arg.host || '127.0.0.1:23032',
  auth: ''
});

(async () => {

  try {
    await pub.connect();
    console.log('Connected');
    let id = 0;
    setInterval(() => {
      id++;
      console.log("Sending to welcome: " + id);
      pub.send('welcome', {
        "message": "From an external publisher : " + id,
        "from": "System"
      });
    }, 2000);
  } catch (e) {
    return console.log(e);
  }
})();
