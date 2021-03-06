/***/
var path = require('path'), fs = require('fs'), _ = require('grunt-runner')._;
var taskname = _.taskname(__dirname); // run

module.exports = function(grunt) {
  var tmes = 'Grunt Runner test: ' + taskname;
  grunt.registerTask(taskname, tmes, function() {
    gruntRunnerTest(grunt, _.mixedConfigure(grunt, taskname), this);
  });
};
function gruntRunnerTest(grunt, conf, gtask) {
  var line = [], done = gtask.async();
  line.push(function() {
    grunt.log.writeln('[' + gtask.name + '] done.'), done();
  });
  _.micropipe(line);
}
