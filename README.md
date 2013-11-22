#grunt-q
  
[![Version](https://badge.fury.io/js/grunt-q.png)](https://npmjs.org/package/grunt-q)
[![Build status](https://travis-ci.org/ystskm/node-grunt-q.png)](https://travis-ci.org/ystskm/node-grunt-q)
  
Support for queueing grunt task with using cluster.  
Ranked queue is also supported.

## Install

Install with [npm](http://npmjs.org/):

    npm install grunt-q

## Example code
An exsample for creating task run server.
```js
var q = require('grunt-q')(4);
require('http').createServer(function(req, res) {
req.on('readable', function(){
  var p = JSON.parse(req.read().toString());
  switch(p['request-type'])) {
  
  case 'queuing':
    q.enqueue(p['grunt-task-params']).on('end', function(task_id, task) {
      res.send('Task is in-queue as #' + task_id);
    });
    break;
    
  case 'stat':
    res.send(q.confirm(p['grunt-task-id']));
    break;
    
  case 'cancel':
    q.dequeue(p['grunt-task-id']), res.send('Task is canceled');
    break;
    
  default:
    res.send('No such operation');
  
  }
});
});
```

## API - creating queues
###Query
```js
q = gruntQ([options])
```

###Arguments  
**options** ( Number | Array | Object ) `{q:1}` optional  
Options for creating queues.  
_If a Number or an Array is given, it treats as value of **q**_  
- __q__ (Number|Object|Array): statuses of queue(s) creating  
    `4`	Create four queues with from rank 0 (lowest) to rank 3 (high)  
    `{ maxQueue: 8 }`	Create a queue  with rank 0, max queue count 8.  
    `[{}, { maxQueue: 4 }]`	A queue with rank 0, unlimited queue count and a queue with rank 1, max queue count 4 will be created.  
  
- __maxWorker__ (Number|Boolean): max worker count for execute tasks. it is limited by the number of cpus.
    `2`	two workers will be created if the number of cpus >= 2.  
    `true`, `null` or `undefined`	`require('os').cpus()` workers will be created.  
    `false`	not using child_process to execute task.  

###Events  
A grunt-q is an instance of EventEmitter.  
  
type `ready`  
  Emits when queue(s) are ready.  
  ```
  q.on('ready', function(){ ... } );
  ```
  
type `progress`  
  Emits when progress to next task.  
  ```
  q.on('progress', function(task_id, task){ ... } );
  ```
type `error`  
  Emits when some error occurs.  
  ```
  q.on('error', function(err, [task]){ ... } );
  ```
  
Other events are bridged from __grunt-runner__ as type `data`.  
type `data`
  Emits when some error occurs.  
  ```
  q.on('data', function(type, args){ ... } );
  ```
  
See [readme](https://github.com/ystskm/node-grunt-runner/blob/master/README.md) for more information about other events.

## API - enqueue a task
###Query
```js
q.enqueue([pkg_file_path,] task_configuration [, options][, callback]);
```
_Note that you can `.enqueue()` without waiting event `ready`._  
_Before ready, tasks are waiting ready automatically._  
  
###Arguments
**pkg_file_path** ( String ) `package.json` _optional_  
Specify the task package file. It's _optional_ because it's not required that you
 take a time for writing `package.json`.  
```js
q.enqueue('package-for-task1.json', {(some configuration)});
/* contents of package-for-task1.json:
  { "name": "task1", "taskList": ["subtask1", "subtask2"] }
*/
```
or, you can write this alternatively
```js
q.enqueue({
    pkg: {name: 'task1', taskList: ['subtask1', 'subtask2']}
  , (some configuration)
});
```
  
## API - confirm task state
###Query
```js
q.confirm(task_id[,raw]);
```
The return value value is `'pending'`, `'processing'` or `'finished'`.
If you set `true` to the **raw**, you can get Task object and use the functions. (e.g. `.status()`, `.rank()` )  
  
## API - confirm task progress
```js
q.progress(task_id[,callback]);
```
Check the progress of *task_id*.  
The return value is an object `{ state: (task state), progress: (task progress) }  
task state:= `not-in-queue` | `error` | `pending` | `processing` | `finished` | `memory trash`  
task progress:=  
  case `not-in-queue` value = `undefined`  
  case `error`        value = Object `Error`  
  case `pending`      value = `0`  
  case `processing`   value = { finished: Array `finished task names`, taskList: Array `task names` }  
  case `finished`     value = `100`  
  case `memory-trash` value = `undefined` This case occurs when lost worker. Rare case but no way to save the task, now.  
  
You can get data eventDrive/callback  
```
q.progress(task_id).on('error', function(err){ ... }).on('end', function(status_value){ ... });
```
,or  
```
q.progress(task_id, function(err, status_value){ ... });
```
  
## API - dequeue and remove task
###Query
```js
q.dequeue(task_id);
```
You can remove the status of a Task, release from taskmap, and saving memory use.  
After that, you cannot `.confirm()` for the task any more, if you do that, an error will be thrown.  
  
