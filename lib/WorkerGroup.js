/***/
var util = require('util'), cluster = require('cluster');
var gr = require('grunt-runner'), _ = gr._;

var exit_targets = [];
module.exports = cluster.isMaster ? WorkerGroup: eventBinding();

function WorkerGroup(num, callback) {

  if(!(this instanceof WorkerGroup))
    return new WorkerGroup(num, callback);

  this.workers = [], this.num = num;
  this.numOfOnline = 0, this.onlineCallback = callback;

  var execArgv = [].concat(process.execArgv).filter(function(v) {
    return !/--debug/.test(v);
  });

  cluster.setupMaster({
    exec: __filename,
    execArgv: execArgv
  });

  while(num--)
    this.fork();

  exit_targets.push(this);
  if(cluster.listeners('exit').length === 0)
    cluster.on('exit', onClusterExit);

}
var WGProtos = {
  fork: fork,
  close: close
};
for( var i in WGProtos)
  WorkerGroup.prototype[i] = WGProtos[i]

function eventBinding() {

  _.assert('Woke up worker PID#' + process.pid);
  var data = {};

  process.on('uncaughtException', function(e) {
    send(null, 'error', [e.message, null, e.stack]);
  });

  process.on('message', function(msg) {
    switch(msg.cmd) {

    case 'taskProgress':
      taskProgress(msg.task_id, msg._id);
      break;

    default:
      taskRun(msg.task_id, msg.task);

    }
  });

  function taskProgress(task_id, _cid) {
    send(task_id, _cid, data[task_id]);
  }

  function taskRun(task_id, task_read) {

    var pkg_json = task_read.pkg, wd = task_read.workdir, pid = process.pid;
    _.assert('Task package "' + pkg_json + '@'
      + (wd && wd.split('/').slice(-2).join('/')) + '" start on PID#' + pid
      + '.');

    gr.run(task_read.workdir, pkg_json, task_read.cmd).on('start', onStart).on(
      'error', onError).on('data', onData).on('finish', onFinish).on('end',
      onEnd);

    function onStart(taskList) {
      !data[task_id] && (data[task_id] = {
        finished: [],
        taskList: taskList
      });
      send(task_id, 'start', taskList);
    }
    function onError(e, task) {
      if(e instanceof Error)
        return send(task_id, 'error', [e.message, task, e.stack]);
      send(task_id, 'error', [e, task]);
    }
    function onData(args) {
      send(task_id, args.shift(), args);
    }
    function onFinish() {
      !!data[task_id] && data[task_id].finished.push(arguments[0]);
      send(task_id, 'finish', _.toArray(arguments));
    }
    function onEnd() {
      send(task_id, 'end', data[task_id]), delete data[task_id];
    }

  }

  function send(task_id, type, data) {
    process.send({
      t_id: task_id,
      type: type,
      data: data
    });
  }

}

function onClusterExit(worker, code, signal) {

  var wg = null, idx = -1;
  for( var i = 0; i < exit_targets.length; i++)
    if((idx = exit_targets[i].workers.indexOf(worker)) != -1) {
      wg = exit_targets[i];
      break;
    }

  if(!wg || idx == -1) //already closed
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
    if(++wg.numOfOnline == wg.num)
      wg.onlineCallback(null, wg.workers);
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
