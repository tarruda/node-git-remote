var spawn = require('child_process').spawn
  , Stream = require('stream')
  , packfile = require('./packfile-protocol');

function Remote(opts) {
  if (typeof opts.path !== 'string' || !opts.path.trim())
    throw new Error('File transport requires the repository path');

  this.path = opts.path;
}

Remote.prototype.fetch = function() {
  var gitUpload = spawn('git-upload-pack', [this.path]);

  return new packfile.Fetch(gitUpload.stdin, gitUpload.stdout,
                            gitUpload.stderr);
};

Remote.prototype.push = function() {
  var gitReceive = spawn('git-receive-pack', [this.path]);

  return new packfile.Push(gitReceive.stdin, gitReceive.stdout,
                            gitReceive.stderr);
};

module.exports = Remote;
