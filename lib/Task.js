/***/
var crypto = require('crypto');
module.exports = Task;

var Map = {};
function Task(pkg, commands, rank, timeout, workdir) {
  var tsk = this;
  tsk._state = 'pending';
  tsk._pkg = pkg, tsk._commands = commands, tsk._rank = rank;
  tsk._timeout = timeout, tsk._workdir = workdir;
  Map[tsk._id = getId()] = tsk;
}

Task.idGen = getId;
Task.getById = function(_id) {
  return Map[_id];
};
Task.forEachTask = function(fn) {
  for( var i in Map) fn(Map[i]);
};
Task.countAlives = function() {
  return Object.keys(Map).length;
};

var TaskProtos = {
  read: read,
  rank: rank,
  timeout: timeout,
  workdir: workdir,
  state: state,
  timer: timer,
  destroy: destroy
};
for( var i in TaskProtos)
  Task.prototype[i] = TaskProtos[i];

function read() {
  var tsk = this;
  return {
    pkg: tsk._pkg,
    cmd: tsk._commands,
    workdir: tsk._workdir
  };
}

function state(v) {
  return v && (this._state = v), this._state;
}

function timer(v) {
  return v && (this._timer = v), (Date.now() - this._timer.getTime());
}

function rank() {
  return this._rank;
}

function timeout() {
  return this._timeout;
}

function workdir() {
  return this._workdir;
}

function destroy() {
  delete Map[this._id];
}

var time = null, cnt = 0;
function getId() {
  if(time != Date.now())
    time = Date.now(), cnt = 0;
  return crypto.createHash('md5').update([time, cnt++].join('')).digest('hex');
}
