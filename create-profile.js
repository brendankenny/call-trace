/* jshint node:true, esnext: true */
'use strict';

// module.exports = createProfile;

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
    // Start with `id` 2 since head is already 1.
    currentNodeId: 2,
    timestamps,

    profileSamples: [],
    profileTimestamps: []
  };

  walkTraceNode(walkState, head);

  // Chrome Debugging CPUProfile object
  // https://chromedevtools.github.io/debugger-protocol-viewer/Profiler/#type-CPUProfile
  return {
    head,
    // startTime and endTime are in seconds
    startTime: timestamps[0] / 1000,
    endTime: timestamps[timestamps.length - 1] / 1000,
    samples: walkState.profileSamples,
    // timestamps are in microseconds
    timestamps: walkState.profileTimestamps
  };
}

function walkTraceNode(walkState, node) {
  // Walk children until told otherwise. If head node, exit at end of trace. If
  // non-head node, exit when trace exits this node (negative callUID in trace).
  while (!(node.id === 1 && walkState.traceCursor >= walkState.traces.length) &&
      walkState.traces[walkState.traceCursor] !== -node.callUID) {
    if (walkState.traceCursor >= walkState.traces.length) {
      throw new Error('trace ended before exiting all entered functions');
    }

    var childCallUid = walkState.traces[walkState.traceCursor];
    if (childCallUid < 0) {
      throw new Error('invalid trace: exit of function not currently inside.');
    }

    // Grab the child node for the next call.
    var childNode = null;
    // Linear search of children array (in practice very few children per node).
    for (var i = 0; i < node.children.length; i++) {
      if (node.children[i].callUID === childCallUid) {
        childNode = node.children[i];
        break;
      }
    }
    // No existing child node, so create a new one.
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

    // TODO(bckenny): CPUProfile samples/timestamps when no timestamps

    // Register a sample hit for child entry.
    childNode.hitCount++;
    walkState.profileSamples.push(childNode.id);
    var childEnterμs = walkState.timestamps[walkState.traceCursor] * 1000;
    walkState.profileTimestamps.push(Math.floor(childEnterμs));

    // Enter child in trace.
    walkState.traceCursor++;

    // Walk down children's children's great-great-grandchildren or whatever.
    walkTraceNode(walkState, childNode);

    // Register a sample hit for child exit.
    // TODO(bckenny): is this necessary? Or does it assume child goes until
    // parent is sampled again?
    childNode.hitCount++;
    walkState.profileSamples.push(childNode.id);
    var childExitμs = walkState.timestamps[walkState.traceCursor] * 1000;
    walkState.profileTimestamps.push(Math.floor(childExitμs));

    // Exit child in trace.
    walkState.traceCursor++;

    // Child exit puts self back on top, so register a sample 1 μs after exit.
    node.hitCount++;
    walkState.profileSamples.push(node.id);
    var selfReentryμs = childExitμs + 1;
    walkState.profileTimestamps.push(Math.floor(selfReentryμs));
  }
}
