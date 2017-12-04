/***/
var NULL = null, TRUE = true, FALSE = false;
var cluster = require('cluster');
var gr = require('grunt-runner'), _ = gr._;
module.exports = function eventBinding(proc, bind, talk) {

  var data = {};
  if(proc == NULL) {
    proc = process;
  }

  // Default bindings
  if(bind == NULL) {
    bind = function(func) {
      proc.on('message', func)
    };
  }
  if(talk == NULL) {
    talk = function(m) {
      proc.send(m);
    };
  }

  var send = function(task_id, type, data) {
    talk({
      t_id: task_id,
      type: type,
      data: data
    });
  };

  if(proc === process) proc.on('uncaughtException', function(e) {
    send(NULL, 'error', [e.message, NULL, e.stack]);
  });

  bind(function(msg) {

    // Filter the message (from another interaction, such as cluster function)
    // console.log('(eventBinding) receive a message:', msg)
    if(msg == NULL || msg.task_id == NULL) return;
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

    var pkg_json = task_read.pkg, wd = task_read.workdir, pid = proc.pid;
    var dir = String(wd).split('/').slice(-2).join('/');
    // console.log('Task package "' + pkg_json + '@' + dir + '"');
    // console.log('    (start on PID#' + pid + '.)');

    var ee = gr.run(task_read.workdir, pkg_json, task_read.cmd);
    ee.on('start', onStart);
    ee.on('error', onError);
    ee.on('data', onData);
    ee.on('finish', onFinish);
    ee.on('end', onEnd);

    function onStart(taskList) {
      if(data[task_id] == NULL) {
        data[task_id] = {
          finished: [],
          taskList: taskList
        };
      }
      send(task_id, 'start', taskList);
    }
    function onError(e, task) {
      if(e instanceof Error) {
        return send(task_id, 'error', [e.message, task, e.stack]);
      }
      send(task_id, 'error', [e, task]);
    }
    function onData(args) {
      send(task_id, args.shift(), args);
    }
    function onFinish() {
      if(data[task_id] != NULL) {
        data[task_id].finished.push(arguments[0]);
      }
      send(task_id, 'finish', _.toArray(arguments));
    }
    function onEnd() {
      send(task_id, 'end', data[task_id]);
      delete data[task_id];
    }

  }

}
