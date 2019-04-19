'use strict';
/**
 * This is an example of a engine.io client working with the Quty server + engine.io
 * It simulates a browser/client connection to engine.io and distribution of messages
 * NOTE: you need to "npm i engine.io-client"
 * Run the example:
 * node engine-io.client --host=127.0.0.1:24001
 * node engine-io.client --host=127.0.0.1:24000
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

const eio = require('engine.io-client');
const EIO_SERVER = arg.host || `ws://127.0.0.1:23000`;

(async () => {
  // Define our helper send function.
  function send(socket, event, data) {
    return new Promise((resolve, reject) => {
      socket.send(JSON.stringify({
        event,
        data
      }), (e) => {
        if (e) return reject(e);
        resolve();
      });
    });
  }

  let socket = new eio.Socket(EIO_SERVER);
  socket.on('open', () => {
    console.log(`Connected to ${EIO_SERVER}`);

    socket.on('message', (d) => {
      d = JSON.parse(d);
      if (d.event === 'message') {
        let msg = d.data.message;
        console.log(`=> [${d.data.channel} - ${msg.from}] : ${msg.message}`);
      }
    });

    // Wait a bit till we start subscribing/sending.

    setTimeout(async () => {
      // Simulate our join event
      console.log('Joining channel1');
      await send(socket, 'join', {
        channel: 'channel1'
      });

      console.log('Sending messages to channel1');
      await send(socket, 'message', {
        channel: 'channel1',
        message: `Hello world! [${EIO_SERVER} - ${new Date().toISOString()}]`
      });
      setTimeout(async () => {
        return; // Remove this to leave the channel.
        console.log('Leaving channel1');
        await send(socket, 'leave', {
          channel: 'channel1'
        });
      }, 10000);

    }, 1000);

    // Test 2
    setTimeout(async () => {
      console.log('Joining welcome');
      await send(socket, 'join', {
        channel: 'welcome'
      });
      await send(socket, 'message', {
        channel: 'welcome',
        message: 'Welcome myself.'
      })
    }, 3000);
  });
})();
