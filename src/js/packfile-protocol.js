var util = require('util')
  , events = require('events')
  , binary = require('binary')
  , NULL = new Buffer([0]);

function callback(target, context) {
  if (typeof target._cb === 'function')
    target._cb.apply(context, Array.prototype.slice.call(arguments, 2));
}

function FetchDiscoveryParser(stream) {
  var parseStream, capabilities
    , refs = {}
    , _this = this;

  parseStream = binary().loop(function(end, parsed) {

    /*
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
              var match;

              refName = refName.toString('utf8');

              if (match = /refs\/(heads|tags)\/(.+)\s*$/.exec(refName)) {
                refName = match[2];
                if (/\^\{\}$/.test(match[2])) {
                  refName = refName.slice(0, refName.length -3);
                  if (refs[refName])
                    refs[refName].peeled = sha1;               
                } else {
                  refs[refName] = {
                      sha1: sha1
                    , type: match[1] === 'tags' ? 'tag' : 'branch'
                  };
                }
              } else if (/HEAD/.test(refName)) {
                refs['HEAD'] = {
                    sha1: sha1
                  , type: 'HEAD'
                };
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
        end();
        var discovery = new FetchDiscovery(stream, refs, capabilities);

        stream.removeListener('data', onData);
        _this.emit('parsed', discovery);
      }
          
    });
  });

  function onData(data) {
    parseStream.write(data);
  }

  stream.on('data', onData);
}
util.inherits(FetchDiscoveryParser, events.EventEmitter);

function FetchDiscovery(stream, refs, capabilities) {
  this.refs = refs;
  this.stream = stream;
  this._capabilities = capabilities;
}
 
exports.FetchDiscoveryParser = FetchDiscoveryParser;

