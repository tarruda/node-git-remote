var util = require('util')
  , events = require('events')
  , binary = require('binary')
  , git = require('git-core')
  , EMPTY_SHA1 = new Buffer(40)
  , CAPS = ' capabilities^{} '
  , NULL = new Buffer([0])
  , NACK = new Buffer('0008NAK\n')
  , PACK = new Buffer('PACK');

EMPTY_SHA1.fill('0');
EMPTY_SHA1 = EMPTY_SHA1.toString('utf8');


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


function parseDiscovery(conversation) {
  var discoveryParser, capabilities, head, refCls
    , inStream = conversation._inStream
    , outStream = conversation._outStream
    , refs = {};

  conversation.state = 'discovering'

  if (conversation instanceof Push)
    refCls = PushDiscoveredRef;
  else
    refCls = FetchDiscoveredRef;

  discoveryParser = binary().loop(function(end) {

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
              var match;

              refName = refName.toString('utf8');

              if (match = /refs\/((?:heads|tags)\/.+)\s*$/.exec(refName)) {
                refName = match[1];
                if (/\^\{\}$/.test(refName)) {
                  refName = refName.slice(0, refName.length - 3);
                  if (refs[refName])
                    refs[refName].peeled = sha1;               
                } else {
                  refs[refName] = new refCls(
                    conversation, sha1, refName);
                  if (head === sha1) {
                    refs['HEAD'] = refs[refName];
                  }
                }
              } else if (/HEAD/.test(refName)) {
                head = sha1;
              }
            }

            if (sha1 === EMPTY_SHA1) {
              // new repository on push discover
              done = true;
              capabilities = parsed.remaining.slice(CAPS.length)
                .toString().trim().split(' ');
            } else {
              if (!capabilities) {
                // first line, read refname and capabilities
                vars = binary.parse(parsed.remaining)
                  .scan('refName', NULL)
                  .buffer('capabilities', parsed.remaining.length)
                  .vars;
                  parseRef(vars.refName);
                  capabilities = vars.capabilities.toString().trim()
                    .split(' ');
              } else {
                parseRef(parsed.remaining);
              }
            }
          });

      if (done) {
        outStream.removeListener('data', onData);
        end();
        conversation.refs = refs;
        conversation._capabilities = capabilities;
        conversation.state = 'discovered';
        conversation.emit('discover', refs);
      }
          
    });
  });

  function onData(data) {
    discoveryParser.write(data);
  }

  outStream.on('data', onData);
}


function parseFetchData(fetch) {
  var receivingDataParser, k, v
    , inStream = fetch._inStream
    , outStream = fetch._outStream
    , fetched = {}
    , packData = [];

  fetch.state = 'fetching';

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


function parseStatus(push) {
  var statusParser, done
    , inStream = push._inStream
    , outStream = push._outStream
    , statusReport = [];

  push.state = 'pushing';

  statusParser = binary().buffer('length', 4).tap(function(parsed) {
    var remaining = parseInt(parsed.length.toString(), 16);

    this.buffer('unpackStatus', remaining - 4).tap(function(parsed) {
      statusReport.push(parsed.unpackStatus.toString('utf8').trim());
    });

    this.loop(function(end) {

      this.buffer('length', 4).tap(function(parsed) {
        var remaining = parseInt(parsed.length.toString(), 16);

        if (remaining > 0) {
          this.buffer('commandStatus', remaining - 4).tap(function(parsed) {
            statusReport.push(parsed.commandStatus.toString('utf8').trim());
          });
        } else {
          done = true;
        }

      });

      if (done) {
        end();
        outStream.removeListener('data', onData);
        push.statusReport = statusReport;
        push.state = 'pushed';
        push.emit('pushed', statusReport);
        push.emit('end');
      }
    
    });
    
  });
  
  function onData(data) {
    statusParser.write(data);
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


function pushCapabilities(serverCapabilities) {
  var rv = [];

  if (serverCapabilities.indexOf('report-status') !== -1)
    rv.push('report-status');

  if (serverCapabilities.indexOf('delete-refs') !== -1)
    rv.push('delete-refs');

  if (serverCapabilities.indexOf('ofs-delta') !== -1)
    rv.push('ofs-delta');

  return rv.join(' ');
}


function setHistoryBase(baseSha1, history) {
  var i;

  if (history.parents && history.parents.length) {
    for (i = 0;i < history.parents.length;i++) {
      if (history.parents[i] instanceof git.Commit)
        setHistoryBase(baseSha1, history.parents[i]);
    }
  } else {
    if (!history.parents)
      history.parents = [];
    history.parents.push(baseSha1);
  }
}


function Conversation(inStream, outStream, errStream) {
  var _this = this;

  this._inStream = inStream;
  this._outStream = outStream;
  this._errStream = errStream;
  parseDiscovery(this, this instanceof Push);

  outStream.once('close', function() {
    // do not emit 'end' when fetching/pushing, that should be handled
    // later
    if (_this.state === 'discovered') _this.emit('end');
  });
}
util.inherits(Conversation, events.EventEmitter);


function DiscoveredRef(conversation, sha1, name) {
  this._conversation = conversation;
  this.sha1 = sha1;
  this.name = name;
}


function FetchDiscoveredRef() {
  this.constructor.super_.apply(this, arguments);
}
util.inherits(FetchDiscoveredRef, DiscoveredRef);

FetchDiscoveredRef.prototype.want = function() {
  var inStream = this._conversation._inStream;

  if (!this._conversation._capabilitiesSent) {
    sendPktLine(inStream, 'want ' + this.sha1 + ' ' + fetchCapabilities(
      this._conversation._capabilities) + '\n');
    this._conversation._capabilitiesSent = true;
  } else {
    sendPktLine(inStream, 'want ' + this.sha1 + '\n');
  }

  if (!this._conversation._wanted)
    this._conversation._wanted = {};

  this._conversation._wanted[this.sha1] = null;
};


function PushDiscoveredRef() {
  this.constructor.super_.apply(this, arguments);
}
util.inherits(PushDiscoveredRef, DiscoveredRef);

PushDiscoveredRef.prototype.update = function(history) {
  var line
    , refName = 'refs/' + this.name
    , inStream = this._conversation._inStream;

  if (this.sha1 !== EMPTY_SHA1 && history !== EMPTY_SHA1) {
    setHistoryBase(this.sha1, history);
  }

  if (history !== EMPTY_SHA1) {
    line = this.sha1 + ' ' + history.serialize().getHash() + ' ' + refName;
    this._conversation.pack.objects.push(history);
  } else {
    line = this.sha1 + ' ' + EMPTY_SHA1 + ' ' + refName;
  }

  if (!this._conversation._capabilitiesSent) {
    line = Buffer.concat([
        new Buffer(line)
      , NULL
      , new Buffer(' ' + pushCapabilities(this._conversation._capabilities))
    ]);
    this._conversation._capabilitiesSent = true;
  } else {
    line += '\n';
  }

  sendPktLine(inStream, line);
  this._conversation._commandSent = true;
};

PushDiscoveredRef.prototype.del = function() {
  this.update(EMPTY_SHA1);
};


function Fetch() {
  this.constructor.super_.apply(this, arguments);
}
util.inherits(Fetch, Conversation);

Fetch.prototype.flush = function() {
  if (this.state === 'discovered' && this._wanted)
    parseFetchData(this);
  else
    this._inStream.write('0000', 'utf8');
};


function Push() {
  this.constructor.super_.apply(this, arguments);
  this.pack = new git.Pack()
}
util.inherits(Push, Conversation);

Push.prototype.flush = function() {
  var inStream = this._inStream;

  inStream.write('0000', 'utf8');

  if (this.state === 'discovered' && this._commandSent) {
    if (this.pack.objects.length)
      inStream.write(this.pack.serialize());
    parseStatus(this);
  }
};

Push.prototype.create = function(name, history) {
  if (name in this.refs)
    throw new Error('Ref already exists');

  this.refs[name] = new PushDiscoveredRef(this, EMPTY_SHA1, name);
  this.refs[name].update(history);
};

exports.Fetch = Fetch;
exports.Push = Push;

