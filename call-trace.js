#!/usr/bin/env node

/* jshint node:true, esnext: true */
'use strict';

var fs = require('fs');

var acorn = require('acorn');
var walk = require('acorn/dist/walk');

var TRACE_VAR = 'wɔk';

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

function extractFunctionInfo(code, node, parent) {
  var fnInfo = {
    range: node.range,
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
      // TODO(bckenny): more sophisticated function name extraction from LHS.
      fnInfo.name = code.slice(parent.left.range[0], parent.left.range[1]);
      return fnInfo;
    }

    // Anonymous function instances
    if (parent.type === 'ReturnStatement' || parent.type === 'CallExpression') {
      fnInfo.name = '[Anonymous]';
      return fnInfo;
    }

    throw new Error('unknown FunctionExpression at line ' + node.loc.start.line);
  }
}

function isFunction(node) {
  return node.type === 'FunctionDeclaration' ||
      node.type === 'FunctionExpression' ||
      node.type === 'ArrowFunctionExpression';
}

function fnMapName(fnInfo) {
  return fnInfo.name + '_' + fnInfo.blockStart;
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
  var ast = acorn.parse(src, {ranges: true, locations: true});

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

  // Move from the end of the source to the end, inserting traces along the way.
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
    '  f: ' + JSON.stringify(walkerState.functionList) + ',\n' +
    '  t: [],\n';

  if (argv.time) {
    output += '  d: [],\n' +
      '  in: function(id) {this.t.push(id); this.d.push(performance.now());},\n' +
      '  out: function(id) {this.t.push(-id); this.d.push(performance.now());}\n';
  } else {
    output +=
      '  in: function(id) {this.t.push(id);},\n' +
      '  out: function(id) {this.t.push(-id);}\n';
  }
  return output + '};\n' + src;
}
