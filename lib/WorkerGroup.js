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

  cluster.setupMaster({
    exec: __filename
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
    send('taskProgress', data[task_id] || {}, _cid);
  }

  function taskRun(task_id, task_read) {

    util.log('Task "' + task_read.pkg + '" start on PID#' + process.pid + '.');
    gr.run(task_read.workdir, task_read.pkg, task_read.cmd)
        .on('start', onStart).on('error', onError).on('data', onData).on(
          'finish', onFinish).on('end', onEnd);

    function onStart(taskList) {
      !data[task_id] && (data[task_id] = {
        finished: [],
        taskList: taskList
      });
      send('start', _.toArray(arguments));
    }
    function onError(e, task) {
      send('error', [e, task]);
    }
    function onData(args) {
      send(args.shift(), args);
    }
    function onFinish() {
      !!data[task_id] && data[task_id].finished.push(arguments[0]);
      send('finish', _.toArray(arguments));
    }
    function onEnd() {
      send('end', [task_id, data[task_id]]), delete data[task_id];
    }

  }

  function send(type, data, _cid) {
    process.send(_cid ? {
      type: type,
      _cid: _cid,
      data: data
    }: {
      type: type,
      args: data
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

  util.log('worker #' + worker.process.pid + ' died (' + (signal || code)
    + '). restarting...');

  wg.workers.splice(i, 1), wg.numOfOnline--;
  util.log('worker queue size is ' + wg.workers.length + ' before fork.');
  wg.fork();

}

function fork() {

  var cw = this;
  var worker = cluster.fork().on('online', function(worker) {
    _.assert('Worker #' + this.id + ' is online.');
    if(++cw.numOfOnline == cw.num)
      cw.onlineCallback(null, cw.workers);
  });

  cw.workers.push(worker.on('error', function(e) {
    _.assert.error(e);
  }));

}

function close() {
  exit_targets.splice(exit_targets.indexOf(this), 1);
  this.workers.forEach(function(worker) {
    worker.kill();
  });
}
