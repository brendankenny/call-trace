#!/usr/bin/env node

/*
 * Use the Closure Compiler Service API to minify create-profile.js and write to
 * create-profile.min.js for use by call-trace.
 */

/* jshint node:true, esnext: true */
'use strict';

var fs = require('fs');

var ClosureCompiler = require('google-closure-compiler').compiler;

var closureCompiler = new ClosureCompiler({
  js: 'create-profile.js',
  externs: 'create-profile-externs.js',
  compilation_level: 'ADVANCED',
  warning_level: 'VERBOSE',
  language_out: 'ECMASCRIPT5_STRICT',
  env: 'CUSTOM',
  js_output_file: 'create-profile.min.js'
});

var compilerProcess = closureCompiler.run(function(exitCode, stdOut, stdErr) {
  if (stdOut) {
    console.log(stdOut);
  }
  if (stdErr) {
    console.error(stdErr);
  }

  process.exit(exitCode);
});
