/***/
var NULL = null, TRUE = true, FALSE = false;
var cluster = require('cluster');
var gr = require('grunt-runner'), _ = gr._;
var eventBinding = require('./eventBinding.js');

var exit_targets = [];
module.exports = cluster.isMaster ? WorkerGroup: eventBinding();

function WorkerGroup(num, callback) {

  var wg = this;
  if(!(this instanceof WorkerGroup)) {
    return new WorkerGroup(num, callback);
  }

  wg.workers = [], wg.num = num;
  wg.numOfOnline = 0, wg.onlineCallback = callback;

  var execArgv = [].concat(process.execArgv).filter(function(v) {
    return !/--debug/.test(v);
  });

  // Set cluster for using this file as a start file
  cluster.setupMaster({
    exec: __filename,
    execArgv: execArgv
  });

  while (num--) {
    wg.fork();
  }

  exit_targets.push(wg);
  if(cluster.listeners('exit').length === 0) {
    cluster.on('exit', onClusterExit);
  }

}
var WGProtos = {
  fork: fork,
  close: close
};
for( var i in WGProtos)
  WorkerGroup.prototype[i] = WGProtos[i]

function onClusterExit(worker, code, signal) {

  var wg = NULL, i, idx = -1;
  for(i = 0; i < exit_targets.length; i++)
    if((idx = exit_targets[i].workers.indexOf(worker)) != -1) {
      wg = exit_targets[i];
      break;
    }

  if(!wg || idx == -1) // already closed
  return;

  _.assert('worker #' + worker.process.pid + ' died (' + (signal || code)
    + '). restarting...');

  wg.workers.splice(i, 1), wg.numOfOnline--;
  _.assert('worker queue size is ' + wg.workers.length + ' before fork.');
  wg.fork();

}

function fork() {

  var wg = this;
  var worker = cluster.fork();

  worker.on('online', function() {
    _.assert('Worker #' + this.id + ' is online.');
    if(++wg.numOfOnline == wg.num) wg.onlineCallback(NULL, wg.workers);
  });

  worker.on('error', function(e) {
    _.assert('WorkerGroup catches an error of worker.');
    _.assert(e);
  });

  wg.workers.push(worker);

}

function close() {

  var wg = this, idx = exit_targets.indexOf(wg);

  ~idx && exit_targets.splice(idx, 1); // escape from cluster exit
  wg.workers.forEach(function(worker) {
    worker.kill();
  });

}
