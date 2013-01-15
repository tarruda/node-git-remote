var util = require('util')
  , events = require('events')
  , binary = require('binary')
  , git = require('git-core')
  , NULL = new Buffer([0])
  , NACK = new Buffer('0008NAK\n')
  , PACK = new Buffer('PACK');


function parseFetchDiscovery(fetch) {
  var discoveryParser, capabilities
    , inStream = fetch._inStream
    , outStream = fetch._outStream
    , refs = {};

  fetch.state = 'discovering'
  discoveryParser = binary().loop(function(end) {

    /*
    TODO: Fully implement
    ABNF

    advertised-refs  =  (no-refs / list-of-refs)
                        flush-pkt

    no-refs          =  PKT-LINE(zero-id SP "capabilities^{}"
                        NUL capability-list LF)

    list-of-refs     =  first-ref *other-ref
    first-ref        =  PKT-LINE(obj-id SP refname
                        NUL capability-list LF)

    other-ref        =  PKT-LINE(other-tip / other-peeled)
    other-tip        =  obj-id SP refname LF
    other-peeled     =  obj-id SP refname "^{}" LF

    capability-list  =  capability *(SP capability)
    capability       =  1*(LC_ALPHA / DIGIT / "-" / "_")
    LC_ALPHA         =  %x61-7A
    */
    this.buffer('length', 4).tap(function(parsed) {
      var done = false
        , remaining = parseInt(parsed.length.toString(), 16);

      if (remaining === 0) // flush-pkt
        done = true;

      remaining -= 44; // 40 chars from sha1, 4 chars from length

      this.buffer('sha1', 40)
          .buffer('remaining', remaining)
          .tap(function(parsed) {
            var vars
              , sha1 = parsed.sha1.toString('utf8');

            function parseRef(refName) {
              var match, type;

              refName = refName.toString('utf8');

              if (match = /refs\/(heads|tags)\/(.+)\s*$/.exec(refName)) {
                refName = match[2];
                if (/\^\{\}$/.test(match[2])) {
                  refName = refName.slice(0, refName.length -3);
                  if (refs[refName])
                    refs[refName].peeled = sha1;               
                } else {
                  type = 'tags' ? 'tag' : 'branch';
                  refs[refName] = new FetchDiscoveredRef(
                    fetch, sha1, refName, type);
                }
              } else if (/HEAD/.test(refName)) {
                refs['HEAD'] = new FetchDiscoveredRef(
                  fetch, sha1, 'HEAD', 'HEAD');
              }
            }

            if (!capabilities) {
              // first line, read refname and capabilities
              vars = binary.parse(parsed.remaining)
                .scan('refName', NULL)
                .buffer('capabilities', parsed.remaining.length)
                .vars;

                parseRef(vars.refName);
                capabilities = vars.capabilities.toString().trim().split(' ');
            } else {
              parseRef(parsed.remaining);
            }
          });

      if (done) {
        outStream.removeListener('data', onData);
        end();
        fetch.refs = refs;
        fetch._capabilities = capabilities;
        fetch.state = 'discovered';
        fetch.emit('discover', refs);
      }
          
    });
  });

  function onData(data) {
    discoveryParser.write(data);
  }

  outStream.on('data', onData);
}

function parseReceivingData(fetch) {
  var receivingDataParser, k, v
    , inStream = fetch._inStream
    , outStream = fetch._outStream
    , fetched = {}
    , packData = [];

  fetch.state = 'receiving';

  if (fetch.maxDepth > 0) {
    sendPktLine(inStream, 'deepen ' + fetch.maxDepth.toString() + '\n');
  }
  inStream.write('00000000', 'utf8');

  receivingDataParser = binary().scan('acḱ', NACK).tap(function(parsed) {
    var done = false;

    inStream.write('0009done\n');

    // read the final ack and start looping for pktlines
    this.scan('ack', NACK).loop(function(end, parsed) {
      // TODO test if sideband is in use
      this.buffer('length', 4).tap(function(parsed) {
        var remaining = parseInt(parsed.length.toString(), 16);

        if (remaining > 0) {
          this.buffer('data', remaining - 4).tap(function(parsed) {
            var type = parsed.data.readUInt8(0)
              , data = parsed.data.slice(1);

            if (type === 1) {
              // pack data
              packData.push(data);
            } else if (type === 2) {
              // progress data
              fetch.emit('progress', data.toString());
            } else if (type === 3) {
              // error data
              fetch.emit('error', data);
            } else {
              // Discard this
              throw new Error('Unexpected pktline control code');
            }
          });
        } else {
          done = true;
        }

      });

      if (done) {
        end();
        packData = git.Pack.deserialize(Buffer.concat(packData));
        for (k in fetch.refs) {
          v = fetch.refs[k];
          if (v.sha1 in packData.objectsById && v.sha1 in fetch._wanted &&
             k !== 'HEAD') {
            fetched[k] = packData.objectsById[v.sha1]
          }
        }
        outStream.removeListener('data', onData);
        fetch.fetched = fetched;
        fetch.state = 'fetched';
        fetch.emit('fetched', fetched);
        fetch.emit('end');
      }

    });
  });

  function onData(data) {
    receivingDataParser.write(data);
  }

  outStream.on('data', onData);
}

function fetchCapabilities(serverCapabilities) {
  var rv = [];

  if (serverCapabilities.indexOf('side-band-64k') !== -1)
    rv.push('side-band-64k');
  else if (serverCapabilities.indexOf('side-band-64k') !== -1)
    rv.push('side-band');

  if (serverCapabilities.indexOf('ofs-delta') !== -1)
    rv.push('ofs-delta');

  if (serverCapabilities.indexOf('shallow') !== -1)
    rv.push('shallow');

  // TODO no-progress should be added if no listeners were added for progress

  if (serverCapabilities.indexOf('include-tag') !== -1)
    rv.push('include-tag');

  return rv.join(' ');
}

function sendPktLine(inStream, data) {
  var len, hexLen;

  if (typeof data === 'string')
    data = new Buffer(data, 'utf8');

  len = data.length + 4;
  hexLen = new Buffer([0, 0]);
  hexLen.writeUInt16BE(len, 0);
  hexLen = hexLen.toString('hex');
  inStream.write(hexLen, 'utf8');
  inStream.write(data);
}

function FetchDiscoveredRef(fetch, sha1, name, type) {
  this._fetch = fetch;
  this.sha1 = sha1;
  this.name = name;
  this.type = type;
}

FetchDiscoveredRef.prototype.want = function() {
  var inStream = this._fetch._inStream;

  if (!this._fetch._capabilitiesSent) {
    sendPktLine(inStream, 'want ' + this.sha1 + ' ' + fetchCapabilities(
      this._fetch._capabilities) + '\n');
    this._fetch._capabilitiesSent = true;
  } else {
    sendPktLine(inStream, 'want ' + this.sha1 + '\n');
  }

  if (!this._fetch._wanted)
    this._fetch._wanted = {};

  this._fetch._wanted[this.sha1] = null;
};

function Fetch(inStream, outStream, errStream) {
  var _this = this;

  this._inStream = inStream;
  this._outStream = outStream;
  this._errStream = errStream;
  parseFetchDiscovery(this);

  outStream.once('close', function() {
    // do not emit end when fetching and leave that job to the 'fetched'
    // event
    if (_this.state === 'discovered') _this.emit('end');
  });
}
util.inherits(Fetch, events.EventEmitter);

Fetch.prototype.flush = function() {
  if (this.state === 'discovered' && this._wanted)
    parseReceivingData(this);
  else
    this._inStream.write('0000', 'utf8');
};

exports.Fetch = Fetch;

