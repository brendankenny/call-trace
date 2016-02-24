/* jshint node:true, esnext: true */
'use strict';

module.exports = createProfile;

function createProfile(info) {
  var timestamps = info.d;
  var traces = info.t;
  var functionMap = info.fns;

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
    id: 1,
    positionTicks: []
  };

  var walkState = {
    traceCursor: 0,
    // TODO(bckenny): assumes a single file
    fileName: info.file,
    traces,
    functionMap,
    currentNodeId: 2
  };

  walkTraceNode(walkState, head);

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
  // For non-head nodes, check we're in the right spot and enter ourselves.
  if (node.id > 1) {
    if (node.callUID !== walkState.traces[walkState.traceCursor]) {
      throw new Error('entered node doesn\'t match current point in trace');
    }
    walkState.traceCursor++;
  }

  // Walk children until told otherwise.
  while (true) {
    // If node is the head, exit at the end of the trace.
    if (walkState.traceCursor >= walkState.traces.length) {
      if (node.id === 1) {
        return;
      } else {
        throw new Error('trace ended before exiting all entered functions');
      }
    }

    // If non-head node, exit when trace exits this node.
    if (walkState.traces[walkState.traceCursor] === -node.callUID) {
      // Move past self exit before returning back to parent node.
      walkState.traceCursor++;
      return;
    }

    var childCallUid = walkState.traces[walkState.traceCursor];
    if (childCallUid < 0) {
      throw new Error('invalid trace: exiting function not currently inside');
    }

    // Grab the child node for the next call, either already in the children
    // array or created new.
    var childNode = null;
    // Linear search, but in practice very few children per node.
    for (var i = 0; i < node.children.length; i++) {
      if (node.children[i].callUID === childCallUid) {
        childNode = node.children[i];
        break;
      }
    }
    if (!childNode) {
      var fnDesc = /^(.+)_(\d+)_(\d+)$/.exec(walkState.functionMap[childCallUid]);
      childNode = {
        functionName: fnDesc[1],
        // TODO(bckenny): assumes a single file
        scriptId: '0',
        url: walkState.fileName,
        lineNumber: parseInt(fnDesc[2], 10),
        columnNumber: parseInt(fnDesc[3], 10),
        hitCount: 0,
        callUID: childCallUid,
        children: [],
        deoptReason: '',
        id: walkState.currentNodeId++,
        positionTicks: []
      };
      node.children.push(childNode);
    }
    childNode.hitCount++;
    // TODO(bckenny): CPUProfile samples/timestamps

    // Walk down children's children's great-great-grandchildren or whatever.
    walkTraceNode(walkState, childNode);
  }
}
