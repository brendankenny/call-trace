/* jshint node:true, esnext: true */
'use strict';

// module.exports = createProfile;

function createProfile(info) {
  var timestamps = info.d;
  var traces = info.t;
  var functionMap = info.fns;

  var walkState = {
    traceCursor: 0,
    // TODO(bckenny): assumes a single file
    fileName: info.file,
    traces,
    functionMap,
    currentNodeId: 1
  };

  // Chrome Debugging CPUProfileNode
  // https://chromedevtools.github.io/debugger-protocol-viewer/Profiler/#type-CPUProfileNode
  var head = {
    functionName: '(root)',
    scriptId: '0',
    url: '',
    lineNumber: 0,
    columnNumber: 0,
    hitCount: 0,
    callUID: functionMap.length,
    children: [],
    deoptReason: '',
    id: walkState.currentNodeId++,
    positionTicks: []
  };

  // Enter children calls until running out of trace. Children handle actual
  // trace traversal (including incrementing traceCursor).
  while (walkState.traceCursor < walkState.traces.length) {
    var nextCallUid = walkState.traces[walkState.traceCursor];
    if (nextCallUid < 0) {
      throw new Error('next function id from head should always be positive');
    }

    // Check if children array already contains this function.
    // Linear search, but in practice very few children per node.
    var childNode = null;
    for (var i = 0; i < head.children.length; i++) {
      if (head.children[i].callUID === nextCallUid) {
        childNode = head.children[i];
        break;
      }
    }
    if (!childNode) {
      var fnDesc = walkState.functionMap[nextCallUid];
      childNode = {
        functionName: getFunctionName(fnDesc),
        // TODO(bckenny): assumes a single file
        scriptId: '0',
        url: walkState.fileName,
        lineNumber: getLineNumber(fnDesc),
        columnNumber: getColumnNumber(fnDesc),
        hitCount: 0,
        callUID: nextCallUid,
        children: [],
        deoptReason: '',
        id: walkState.currentNodeId++,
        positionTicks: []
      };
      head.children.push(childNode);
    }
    childNode.hitCount++;
    // TODO(bckenny): CPUProfile samples/timestamps

    // Walk down children's children's great-great-grandchildren or whatever.
    walkTraceNode(walkState, childNode);
  }

  // Chrome Debugging CPUProfile object
  // https://chromedevtools.github.io/debugger-protocol-viewer/Profiler/#type-CPUProfile
  return {
    head,
    startTime: timestamps[0] / 1000,
    endTime: timestamps[timestamps.length - 1] / 1000
    // TODO(bckenny): CPUProfile samples/timestamps
  };
}

function walkTraceNode(walkState, node) {
  if (node.callUID !== walkState.traces[walkState.traceCursor]) {
    throw new Error('entered node doesn\'t match current point in trace');
  }
  walkState.traceCursor++;

  // Walk children until exiting self.
  while (walkState.traces[walkState.traceCursor] !== -node.callUID) {
    if (walkState.traceCursor >= walkState.traces.length) {
      throw new Error('trace ended before exiting all entered functions');
    }

    var nextCallUid = walkState.traces[walkState.traceCursor];

    // Check if children array already contains this function.
    // Linear search, but in practice very few children per node.
    var childNode = null;
    for (var i = 0; i < node.children.length; i++) {
      if (node.children[i].callUID === nextCallUid) {
        childNode = node.children[i];
        break;
      }
    }
    if (!childNode) {
      var fnDesc = walkState.functionMap[nextCallUid];
      childNode = {
        functionName: getFunctionName(fnDesc),
        // TODO(bckenny): assumes a single file
        scriptId: '0',
        url: walkState.fileName,
        lineNumber: getLineNumber(fnDesc),
        columnNumber: getColumnNumber(fnDesc),
        hitCount: 0,
        callUID: nextCallUid,
        children: [],
        deoptReason: '',
        id: walkState.currentNodeId++,
        positionTicks: []
      };
      node.children.push(childNode);
    }
    childNode.hitCount++;
    // TODO(bckenny): CPUProfile samples/timestamps

    walkTraceNode(walkState, childNode);
  }

  // Move past self exit before returning back to parent node.
  walkState.traceCursor++;
}

function getFunctionName(nameString) {
  return /^(.+)_(\d+)_(\d+)$/.exec(nameString)[1];
}

function getColumnNumber(nameString) {
  // CPUProfileNode Column number is 1 based.
  return parseInt(/^(.+)_(\d+)_(\d+)$/.exec(nameString)[3], 10) + 1;
}

function getLineNumber(nameString) {
  return parseInt(/^(.+)_(\d+)_(\d+)$/.exec(nameString)[2], 10);
}
