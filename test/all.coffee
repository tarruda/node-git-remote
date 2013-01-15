fs = require 'fs'
path = require 'path'
temp = require 'temp'
zlib = require 'zlib'
glob = require 'glob'
wrench = require 'wrench'
{spawn} = require 'child_process'
{expect} = require 'chai'
{Blob, Tree, Commit, Tag, Pack} = require 'git-core'
FileRemote = require '../src/js/file-transport'


createGitRepo = (done) ->
  temp.mkdir 'test-repo', (err, path) =>
    @path = path
    git = spawn 'git', ['init', path]
    git.on 'exit', ->
      done()

deleteGitRepo = -> wrench.rmdirSyncRecursive(@path, true)

captureOutput = (child, cb) ->
  out = []
  err = []
  child.stdout.setEncoding 'utf8'
  child.stderr.setEncoding 'utf8'
  child.stdout.on 'data', (chunk) ->
    out.push chunk
  child.stderr.on 'data', (chunk) ->
    err.push chunk
  child.stderr.on 'end', ->
    cb(out.join(''), err.join(''))
  
writeGitGraph = (repo, root, refName, cb) ->
  count = 0
  writeCb = ->
    count--
    cb() if !count
  head = root.serialize (serialized) ->
    count++
    writeGitObject(repo, serialized, writeCb)
  if refName
    if head.getType() == 'tag'
      refType = 'tags'
    else
      refType = 'heads'
    refPath = path.join(repo, '.git', 'refs', refType, refName)
    fs.writeFileSync(refPath, head.getHash(), 'utf8')
      
writeGitObject = (repo, serialized, cb) ->
  hash = serialized.getHash()
  dir = path.join(repo, '.git', 'objects', hash.slice(0, 2))
  fs.mkdir dir, ->
    bufferPath = path.join(dir, hash.slice(2))
    bufferFile = fs.createWriteStream(bufferPath, mode: 0o444)
    deflate = zlib.createDeflate()
    deflate.pipe(bufferFile)
    bufferFile.on 'open', ->
      deflate.end(serialized.getData())
      if typeof cb == 'function' then bufferFile.on('close', cb)
    bufferFile.on 'error', (err) ->
      if typeof cb == 'function' then cb()

testObjects = ->
  d1 = new Date 1000000000
  d2 = new Date 2000000000
  d3 = new Date 3000000000
  d4 = new Date 4000000000
  str = ''
  for i in [0...1000]
    str += 'test content/test content2/test content3\n'
  @b1 = new Blob str
  # this encode second blob as a delta of the first in packfiles
  @b2 = new Blob str + 'append'
  @b3 = new Blob 'subdir test content\n'
  @t1 = new Tree {
    'file-under-tree': @b3
  }
  @t2 = new Tree {
    'some-file.txt': @b2
    'some-file2.txt': @b1
    'sub-directory.d': @t1
  }
  @t3 = new Tree {
    'another-file.txt': @b1
  }
  @c1 = new Commit {
    tree: @t1
    author:
      name: 'Git Author'
      email: 'author@git.com'
      date: d1
    message: 'Artificial commit 1'
  }
  @c2 = new Commit {
    tree: @t2
    author:
      name: 'Git Author'
      email: 'author@git.com'
      date: d2
    message: 'Artificial commit 2'
    parents: [@c1]
  }
  @c3 = new Commit {
    tree: @t3
    author:
      name: 'Git User'
      email: 'user@domain.com'
      date: d3
    committer:
      name: 'Git Commiter'
      email: 'committer@git.com'
      date: d4
    message: 'Artificial commit 3'
    parents: [@c2]
  }
  @tag = new Tag {
    object: @c2
    name: 'v0.0.1'
    tagger:
      name: 'Git Tagger'
      email: 'tagger@git.com'
    date: d2
    message: 'Tag second commit'
  }


suite 'smart protocol', ->

  suiteSetup createGitRepo

  # suiteTeardown deleteGitRepo

  setup (done) ->
    testObjects.call @
    # write objects to the repository
    writeGitGraph @path, @c3, 'master', =>
      writeGitGraph @path, @tag, @tag.name, done

  test 'reference discovery on fetch', (done) ->
    remote = new FileRemote path: @path
    remote.fetch (err, discovery) =>
      refs = discovery.refs
      expect(refs.HEAD.sha1).to.equal @c3.serialize().getHash()
      expect(refs.master.sha1).to.equal @c3.serialize().getHash()
      expect(refs['v0.0.1'].sha1).to.equal @tag.serialize().getHash()
      expect(refs['v0.0.1'].peeled).to.equal @c2.serialize().getHash()
      done()

