#!/usr/bin/env node

/* jshint node:true, esnext: true */
'use strict';

var fs = require('fs');

var profileReporter = require('./create-profile.min.js');

var acorn = require('acorn');
var walk = require('acorn/dist/walk');

var TRACE_VAR = '_$wɔk';

var argv = require('yargs')
    .usage('Usage: call-trace <file> [--time]')
    .demand(1, 1)
    .strict()
    .option('time', {
      alias: 't',
      boolean: true,
      default: false,
      describe: 'Track function execution time.'
    })
    .argv;

var src = fs.readFileSync(argv._[0], 'utf8');
console.log(instrumentCode(src));

// Adapted from acorn.walk.ancestor to do pre-order visits and track more state.
function walkAST(node, visitors, state) {
  var base = walk.base;
  state = state || {};
  if (!state.ancestors) {
    state.ancestors = [];
  }

  (function c(node, state, override) {
    // Create a new shallow copy of state if not reusable for this node.
    var ancestors = state.ancestors;
    if (node !== ancestors[ancestors.length - 1]) {
      state = Object.assign({}, state);
      state.ancestors = ancestors.slice();
      state.ancestors.push(node);
    }

    var type = override || node.type;

    // Call any supplied visitor for node type. This visits the parent node
    // before children.
    if (visitors[type]) {
      visitors[type](node, state);
    }

    // Let acorn.walk.base handle walking the tree.
    base[type](node, state, c);
  })(node, state);
}

/**
 * Extract a function identifier from the LHS of an assignment.
 * @param {!Object} node
 * @return {string}
 */
function functionIdFromAssignment(node) {
  if (node.type === 'Identifier') {
    return node.name;
  }

  if (node.type !== 'MemberExpression') {
    throw new Error('unhandled AssignmentExpression LHS form');
  }

  var propertyName = '';
  if (!node.computed) {
    propertyName = node.property.name;
  } else {
    // Property is some type of expression. Only handling literals for now.
    if (node.property.type === 'Literal') {
      // TODO(bckenny): reject some literals (e.g. ones containing '.')
      propertyName = node.property.value;
    } else {
      propertyName = '(anonymous)';
    }
  }

  // Recursively parse object.
  var id = functionIdFromAssignment(node.object) + '.' + propertyName;

  // Strip out any 'prototype' before returning.
  return id.replace('prototype.', '');
}

function extractFunctionInfo(code, node, parent) {
  var fnInfo = {
    range: node.range,
    lineNumber: node.loc.start.line,
    columnNumber: node.loc.start.column,
    blockStart: node.body.range[0],
    blockEnd: node.body.range[1]
  };

  // TODO(bckenny): ArrowFunctionExpression
  if (node.type === 'ArrowFunctionExpression') {
    throw new Error('arrow functions not yet supported.');
  }

  if (node.type === 'FunctionDeclaration') {
    fnInfo.name = node.id.name;
    return fnInfo;
  }

  if (node.type === 'FunctionExpression') {
    // If function expression has an identifier, just use that.
    if (node.id && node.id.name) {
      fnInfo.name = node.id.name;
      return fnInfo;
    }

    if (parent.type === 'VariableDeclarator') {
      fnInfo.name = parent.id.name;
      return fnInfo;
    }

    if (parent.type === 'AssignmentExpression') {
      fnInfo.name = functionIdFromAssignment(parent.left);
      return fnInfo;
    }

    // Anonymous function instances
    if (parent.type === 'ReturnStatement' || parent.type === 'CallExpression') {
      fnInfo.name = '(anonymous)';
      return fnInfo;
    }

    throw new Error('unhandled type of FunctionExpression at line ' + node.loc.start.line);
  }
}

function isFunction(node) {
  return node.type === 'FunctionDeclaration' ||
      node.type === 'FunctionExpression' ||
      node.type === 'ArrowFunctionExpression';
}

/**
 * Generate unique(ish) name for function based on name and position in source.
 * @param {!Object} fnInfo
 */
function fnMapName(fnInfo) {
  return fnInfo.name + '_' + fnInfo.lineNumber + '_' + fnInfo.columnNumber;
}

function functionVisitor(node, state) {
  var parent = state.ancestors[state.ancestors.length - 2];
  var fnInfo = extractFunctionInfo(src, node, parent);

  // For every function, add an entry, an exit, and the function name to state.
  state.entryList.push({
    index: state.functionList.length,
    loc: fnInfo.blockStart + 1,
    needReturnVar: false
  });
  // TODO(bckenny): don't add an exit if function explicitly returns.
  state.exitList.push({
    index: state.functionList.length,
    loc: fnInfo.blockEnd - 1,
    type: 'END'
  });

  state.functionList.push(fnMapName(fnInfo));
}

function returnVisitor(node, state) {
  // Find containing function up ancestor chain.
  var ancestors = state.ancestors;
  for (var i = ancestors.length - 2; i >= 0 && !isFunction(ancestors[i]); i--) {}

  var containingInfo = extractFunctionInfo(src, ancestors[i], ancestors[i - 1]);
  var containingIndex = state.functionList.indexOf(fnMapName(containingInfo));
  if (containingIndex === -1) {
    throw new Error('containing function ' + containingInfo.name + ' not found');
  }

  // Exit insertion depends on if returning a value.
  if (!node.argument) {
    state.exitList.push({
      index: containingIndex,
      loc: node.range[1] - 1,
      type: 'RETURN_EMPTY'
    });
  } else {
    // If returning a value, we need a temp var inserted for return magic.
    state.entryList[containingIndex].needReturnVar = true;

    // Make *two* exit entries, on either side of the returned value.
    state.exitList.push({
      index: containingIndex,
      loc: node.argument.range[0],
      type: 'RETURN_PRE_VALUE'
    });
    state.exitList.push({
      index: containingIndex,
      loc: node.argument.range[1],
      type: 'RETURN_POST_VALUE'
    });
  }
}

function createEntryTrace(entry) {
  var traceIn = `\n${TRACE_VAR}.in(${entry.index});`;
  // var traceIn = `\n${TRACE_VAR}.t.push(id);`;
  if (entry.needReturnVar) {
    traceIn += ` var ${TRACE_VAR}Var;`;
  }

  return traceIn;
}

function createExitTrace(exit) {
  if (exit.type === 'RETURN_EMPTY') {
    return ` ${TRACE_VAR}.out(${exit.index}), void 0`;

  // PRE and POST surround existing argument:
  // `return val;` -> `return wɔkVar = val, wɔk.out(index), wɔkVar`;
  } else if (exit.type === 'RETURN_PRE_VALUE') {
    return `${TRACE_VAR}Var = `;

  } else if (exit.type === 'RETURN_POST_VALUE') {
    return `, ${TRACE_VAR}.out(${exit.index}), ${TRACE_VAR}Var`;
  }

  return `${TRACE_VAR}.out(${exit.index});\n`;
}

function instrumentCode(src) {
  var ast = acorn.parse(src, {
    allowHashBang: true,
    ranges: true,
    locations: true
  });

  // Dummy first function entry so that all functions have non-zero indices.
  var walkerState = {
    entryList: [{index: 0, loc: -1, needReturnVar: false}],
    exitList: [],
    functionList: [''],
    ancestors: []
  };

  walkAST(ast, {
    ArrowFunctionExpression: functionVisitor,
    FunctionDeclaration: functionVisitor,
    FunctionExpression: functionVisitor,

    ReturnStatement: returnVisitor
  }, walkerState);

  walkerState.exitList.sort((a, b) => a.loc - b.loc);

  // Move from end of the source to beginning, inserting traces along the way.
  var i = walkerState.entryList.length - 1;
  var j = walkerState.exitList.length - 1;
  while (true) {
    var fnEntry = i > 0 ? walkerState.entryList[i] : null;
    var fnExit = j > -1 ? walkerState.exitList[j] : null;
    if (!fnEntry && !fnExit) {
      break;
    }

    var trace;
    var loc;
    if (!fnExit || fnEntry.loc > fnExit.loc) {
      trace = createEntryTrace(fnEntry);
      loc = fnEntry.loc;
      i--;
    } else {
      trace = createExitTrace(fnExit);
      loc = fnExit.loc;
      j--;
    }

    src = src.slice(0, loc) + trace + src.slice(loc);
  }

  // Finally, add instrumentation preamble.
  var output = `var ${TRACE_VAR} = {\n` +
    `  file: '${argv._[0]}',\n` +
    `  fns: ['${walkerState.functionList.join('\',\'')}'],\n` +
    '  t: [],\n';

  if (argv.time) {
    output +=
      '  d: [],\n' +
      '  in: function(id) {this.t.push(id); this.d.push(performance.now());},\n' +
      '  out: function(id) {this.t.push(-id); this.d.push(performance.now());},\n';
  } else {
    output +=
      '  in: function(id) {this.t.push(id);},\n' +
      '  out: function(id) {this.t.push(-id);},\n';
  }
  output += '  getReport: function() {return this._createProfile(this);},\n' +
      '  _createProfile: ' + profileReporter.toString() + '\n';
  return output + '};\n' + src;
}
