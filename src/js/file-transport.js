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

module.exports = Remote;
