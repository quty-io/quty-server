'use strict';
/**
 * Utility functions.
 * */
const safeJsonStringify = require('safe-json-stringify'),
  crypto = require('crypto'),
  dns = require('dns'),
  url = require('url'),
  qs = require('querystring'),
  http = require('http'),
  https = require('https');
const HTTP_TIMEOUT = 3000;
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
 * Performs a HTTP(s) request to the specified URL, expects JSON result
 * and returns a promise resolving with the result.
 * @Arguments
 *  - url - the URL to use.
 *  - opt.method - the method to use, defaults GET
 *  - opt.data - additional data to send.
 *  - opt.timeout - the default timeout
 * */
util.fetch = (target, opt = {}) => {
  let tOpt;
  if (!opt.method) opt.method = 'GET';
  let options = {
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  };
  let httpClient;
  try {
    tOpt = url.parse(target);
    if (tOpt.protocol !== 'http:' && tOpt.protocol !== 'https:') throw 1;
    httpClient = tOpt.protocol === 'http:' ? http : https;
    if (opt.data && opt.method === 'GET') {
      if (tOpt.query) {
        opt.data = Object.assign({}, qs.parse(tOpt.query), opt.data);
      } else {
      }
      tOpt.query = qs.stringify(opt.data);
      tOpt.search = `?${tOpt.query}`;
    }
    options.path = (tOpt.pathname || '/') + tOpt.search || '';
    options.method = opt.method;
    options.protocol = tOpt.protocol;
    options.host = tOpt.hostname;
    options.timeout = opt.timeout || HTTP_TIMEOUT;
    if (tOpt.auth) options.auth = tOpt.auth;
    options.port = (tOpt.port ? parseInt(tOpt.port) : (tOpt.protocol === 'http:' ? 80 : 443));
  } catch (e) {
    throw new Error(`Quty: invalid URL provided: ${target}`);
  }
  return new Promise((resolve, reject) => {
    let isDone = false;
    let postData;
    if (opt.method !== 'GET' && opt.data) {
      postData = JSON.stringify(opt.data);
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    }
    let req = httpClient.request(options, (res) => {
      // Check status code
      if (res.statusCode < 200 || res.statusCode >= 300) {
        if (isDone) return;
        isDone = true;
        return reject(new Error('Quty: invalid response status code: ' + res.statusCode));
      }
      // Check content type
      let contentType = res.headers['content-type'] || '';
      if (contentType.indexOf('/json') === -1) {
        if (isDone) return;
        isDone = true;
        return reject(new Error('Quty: invalid response content type: ' + contentType));
      }
      res.setEncoding('utf8');
      res.on('error', (e) => {
        if (isDone) return;
        isDone = true;
        reject(e);
      });
      let resultData = '';
      res.on('data', (d) => {
        resultData += d.toString();
      });
      res.on('end', () => {
        if (isDone) return;
        isDone = true;
        if (resultData.trim() === '') return resolve();
        try {
          let res = JSON.parse(resultData);
          resolve(res);
        } catch (e) {
          let err = new Error('Quty: invalid response JSON');
          err.data = resultData;
          return reject(err);
        }
      });
    });
    req.on('error', (e) => {
      if (isDone) return;
      isDone = true;
      reject(e);
    });
    if (postData) {
      req.write(postData);
    }
    req.end();
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
let sendSeq = 0;

util.sendSocketEvent = (socket, event, data, fn) => {
  if (typeof event === 'number') event = event.toString();
  if (typeof event !== 'string' || !event) return false;
  if (typeof data === 'object' && data) {
    data._q = sendSeq;// We attach our sequence counter.
    sendSeq++;
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
      if (typeof data._q === 'number') {
        res.seq = data._q;
        delete data._q;
      }
    }
    res.data = data || '';
    return res;
  } catch (e) {
    return false;
  }
};

module.exports = util;
