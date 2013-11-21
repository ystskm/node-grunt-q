/***/
var path = require('path'), fs = require('fs'), _ = require('grunt-runner')._;
var taskname = _.taskname(__dirname); // error

module.exports = function(grunt) {
  var tmes = 'Grunt Runner test: ' + taskname;
  grunt.registerTask(taskname + '-sub1', tmes, function() {
    _.processor(function(){
      throw new Error('Task throws error');
    });
  });
  grunt.registerTask(taskname + '-sub2', tmes, _.caught(function() {
    setTimeout(function(){
      throw new Error('Throws error and "grunt.fail" will kill his worker.');
    }, 1000);
  }, grunt.fail));
  grunt.registerTask(taskname, [taskname + '-sub1', taskname + '-sub2']);
};
