var FileRemote = require('./file-transport')
  , SSH_REL = /^\s*(.+)@(.+)\:(.+)\s*$/
  , SSH_ABS = /^\s*(ssh\:\/\/)(.+)@(.+)\/(.+)\s*$/
  , GIT = /^\s*(git\:\/\/)(.+)\/(.+)\s*$/
  , FILE = /^\s*(?:file\:\/\/)?(.+)\s*$/;

function connect(url, opts) {
  var match, k
    , remoteOpts = {};

  for (k in opts) {
    remoteOpts[k] = opts[k];
  }

  if (match = SSH_REL.exec(url)) {
    throw new Error('Not implemented');
  } else if (match = SSH_ABS.exec(url)) {
    throw new Error('Not implemented');
  } else if (match = GIT.exec(url)) {
    throw new Error('Not implemented');
  } else if (match = FILE.exec(url)) {
    remoteOpts.path = match[1];
    return new FileRemote(remoteOpts);
  } else {
    throw new Error('Invalid repository URL');
  }

}

module.exports = connect;
