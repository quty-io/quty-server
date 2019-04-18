'use strict';
/**
 * Utility functions.
 * */
const safeJsonStringify = require('safe-json-stringify'),
  crypto = require('crypto'),
  dns = require('dns');
let ALPHA_NUMERIC_CHARS = "AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz1234567890",
  RANDOM_STRING = '';
for (var i = 0; i <= 255; i++) {
  let q = Math.floor(Math.random() * ALPHA_NUMERIC_CHARS.length);
  RANDOM_STRING += ALPHA_NUMERIC_CHARS[q];
}

const util = {};

/**
 * Perform safe JSON Stringify
 * */
util.safeStringify = safeJsonStringify;

util.toBase64 = (data) => {
  return Buffer.from(data).toString('base64');
};

util.randomString = (length) => {
  if (typeof length !== 'number') length = 16; // random 16 by default.
  let gen = Math.abs(parseInt(length));
  let res = '';
  try {
    let buf = crypto.randomBytes(gen);
    for (let i = 0; i < gen; i++) {
      res += RANDOM_STRING[buf.readUInt8(i)];
    }
  } catch (e) {
    console.warn('Quty.randomString: failed to generate crypto random buffer: ', e);
    return null;
  }
  return res;
};

/**
 * Lookup the given hostname, returning an array of all the IP addresses
 * Note:
 * - It will only take into consideration IPv4 addresses
 * */
util.resolveHostname = (hostname) => {
  return new Promise((resolve, reject) => {
    dns.lookup(hostname, {
      all: true
    }, (err, res) => {
      if (err) return reject(err);
      let items = [];
      for (let i = 0, len = res.length; i < len; i++) {
        let item = res[i];
        if (typeof item === 'string' && item) {
          items.push(item);
        } else if (typeof item === 'object' && item) {
          if (item.family === 4 && item.address) {
            items.push(item.address);
          }
        }
      }
      resolve(items);
    });
  });
};


/**
 * Utility function that will send an event to the specific scoket,
 * with the specified data.
 * The protocol we use to send data is:
 * "{event}|{stringData}"
 * In the case of data being an object, it will be stringified.
 * @Arguments
 *  - socket - the raw socket object
 *  - event - an event name/number
 *  - data - the data object/string we want to send
 *  - fn - the callback function to use (optional)
 * */
util.sendSocketEvent = (socket, event, data, fn) => {
  if (typeof event === 'number') event = event.toString();
  if (typeof event !== 'string' || !event) return false;
  if (typeof data === 'object' && data) {
    data = JSON.stringify(data);
  } else if (typeof data === 'undefined') data = '';
  let payload = `${event}|${data}`;
  try {
    socket.send(payload, fn);
    return true;
  } catch (e) {
    return false;
  }
};

/**
 * Function that parses the message coming from a socket, using our protocol.
 * We are looking for strings that have the following pattern:
 * "{event}|{payload}"
 * WHERE
 * - event - the number/string representing the incoming event
 * - payload - a stringified object/ raw string/number
 * RETURNS:
 *  {
 *    "event": "",  // the event name
 *    "data": {}|"" // the data payload
 *  }
 *  OR
 *  returns false for invalid event
 * */
util.parseSocketEvent = (data) => {
  if (typeof data !== 'string' || !data) return false;
  try {
    let barIdx = data.indexOf('|');
    if (barIdx === -1) return false;
    let eventName = data.substr(0, barIdx);
    data = data.substr(barIdx + 1);
    let res = {
      event: eventName
    };
    // We try to parse the json.
    if (data.charAt(0) === '{' || data.charAt(0) === '[') {
      data = JSON.parse(data);
    }
    res.data = data || '';
    return res;
  } catch (e) {
    return false;
  }
};

module.exports = util;
