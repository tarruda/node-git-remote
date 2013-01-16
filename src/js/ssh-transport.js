var util = require('util')
  , Stream = require('stream')
  , Connection = require('ssh2')
  , packfile = require('./packfile-protocol')
  , SSH_PORT = 22;


function getStream(command, host, port, path, user, key, password) {
  var conn = new Connection()
    , opts = {
      host: host
    , port: port
    , username: user
  };

  if (key) {
    opts.privateKey = key;
  } else {
    opts.password = password;
  }

  conn.connect(opts);

  return new SSHStream(command + ' ' + path, conn);
}


function Remote(opts) {
  if (typeof opts.path !== 'string' || !opts.path.trim() ||
     typeof opts.host !== 'string' || !opts.host.trim() ||
     typeof opts.user !== 'string' || !opts.user.trim())
    throw new Error('SSH transport requires host, path, user and key');

  this.path = opts.path;
  this.host = opts.host;
  this.user = opts.user;
  this.key = opts.key;
  this.password = opts.password
}

Remote.prototype.fetch = function() {
  var stream = getStream(
    'git-upload-pack', this.host, SSH_PORT, this.path, this.user, this.key,
      this.password);

  return new packfile.Fetch(stream, stream, stream);
};

Remote.prototype.push = function() {
  var stream = getStream(
    'git-receive-pack', this.host, SSH_PORT, this.path, this.user, this.key,
      this.password);

  return new packfile.Push(stream, stream, stream);
};


function SSHStream(command, conn) {
  var _this = this;

  this.constructor.super_.call(this);

  conn.on('ready', function() {
    conn.exec(command, function (err, stream) {
      _this._inner = stream;
      stream.on('data', function(data) {
        _this.emit('data', data);
      });
      stream.on('end', function() {
        _this.emit('end', arguments);
      });
      stream.on('close', function() {
        _this.emit('close', arguments);
      });
    });
  });
  
}
util.inherits(SSHStream, Stream);

SSHStream.prototype.write = function() {
  this._inner.write.apply(this._inner, arguments);
};

SSHStream.prototype.end = function() {
  this._inner.end.apply(this._inner, arguments);
};

SSHStream.prototype.pause = function() {
  this._inner.pause.apply(this._inner, arguments);
};

SSHStream.prototype.setEncoding = function() {
  this._inner.setEncoding.apply(this._inner, arguments);
};

SSHStream.prototype.destroy = function() {
  this._inner.destroy.apply(this._inner, arguments);
};

SSHStream.prototype.destroySoon = function() {
  this._inner.destroySoon.apply(this._inner, arguments);
};

SSHStream.prototype.pipe = function() {
  this._inner.pipe.apply(this._inner, arguments);
};

SSHStream.prototype.__defineGetter__('writable', function() {
  return this._inner.writable;
});

SSHStream.prototype.__defineGetter__('readable', function() {
  return this._inner.readable;
});


module.exports = Remote;
