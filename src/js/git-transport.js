var net = require('net'),
    packfile = require('./packfile-protocol'),
    DAEMON_DEFAULT_PORT = 9418;

function Remote(opts) {
    if (typeof opts.path !== 'string' || !opts.path.trim() ||
        typeof opts.host !== 'string' || !opts.host.trim())
        throw new Error('Git transport requires URL and path');

    this.path = opts.path;
    this.host = opts.host;
}

function getStream(command, host, port, path) {
    var socket = net.connect({
        host: host,
        port: port
    });

    socket.once('connect', function() {
        packfile.sendPktLine(socket, Buffer.concat([
            new Buffer(command + ' /' + path), packfile.NULL, new Buffer('host=' + host), packfile.NULL
        ]));
    });

    return socket;
}

Remote.prototype.fetch = function() {
    var stream = getStream(
        'git-upload-pack', this.host, DAEMON_DEFAULT_PORT, this.path);

    return new packfile.Fetch(stream, stream, stream);
};

Remote.prototype.push = function() {
    var stream = getStream(
        'git-receive-pack', this.host, DAEMON_DEFAULT_PORT, this.path);

    return new packfile.Push(stream, stream, stream);
};

module.exports = Remote;
