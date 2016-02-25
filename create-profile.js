/* jshint node:true, esnext: true */
'use strict';

// module.exports = createProfile;

/**
 * Create a Chrome debugging CPUProfile object from a trace object.
 * https://chromedevtools.github.io/debugger-protocol-viewer/Profiler/#type-CPUProfile
 * @param {{file: string, fns: !Array<string>, t: !Array<number>, d: Array<number>}} traceInfo
 * @return {!CPUProfile}
 */
function createProfile(traceInfo) {
  // Head uses unique `callUID` greater than all existing unique trace ids.
  var head = new CPUProfileNode('', '(root)_0_0', traceInfo.fns.length, 1);

  var walkState = {
    traceCursor: 0,
    // TODO(bckenny): assumes a single file
    fileName: traceInfo.file,
    trace: traceInfo.t,
    functionMap: traceInfo.fns,
    // Start with `id` 2 since head already uses `id` 1.
    currentNodeId: 2,
    timestamps: traceInfo.d,

    profileSamples: [],
    profileTimestamps: []
  };

  walkTraceNode(head, walkState);

  // Chrome debugging CPUProfile object
  return {
    head: head,
    // startTime and endTime are in seconds
    startTime: traceInfo.d[0] / 1000,
    endTime: traceInfo.d[traceInfo.d.length - 1] / 1000,
    samples: walkState.profileSamples,
    // timestamps are in microseconds
    timestamps: walkState.profileTimestamps
  };
}

/**
 * Creates an individual Chrome debugging CPUProfileNode.
 * https://chromedevtools.github.io/debugger-protocol-viewer/Profiler/#type-CPUProfileNode
 * @constructor
 * @struct
 * @param {string} fileName
 * @param {string} fnName
 * @param {number} callUID
 * @param {number} id
 */
function CPUProfileNode(fileName, fnName, callUID, id) {
  var fnDesc = /^(.+)_(\d+)_(\d+)$/.exec(fnName);

  this.functionName = fnDesc[1];
  // TODO(bckenny): assumes a single file
  this.scriptId = '0';
  this.url = fileName;
  this.lineNumber = parseInt(fnDesc[2], 10);
  this.columnNumber = parseInt(fnDesc[3], 10);
  this.hitCount = 0;
  this.callUID = callUID;
  this.children = [];
  this.deoptReason = '';
  this.id = id;
  this.positionTicks = [];
}

/**
 * Follows all function entrances and exits in trace from current cursor until
 * current node is exited, recording them as profile samples and adding adding
 * called functions to node's children.
 * @param {!CPUProfileNode} node
 * @param {!TraceWalkState} walkState
 */
function walkTraceNode(node, walkState) {
  // Walk children until told otherwise. If head node, exit at end of trace. If
  // non-head node, exit when trace exits this node (negative callUID in trace).
  while (!(node.id === 1 && walkState.traceCursor >= walkState.trace.length) &&
      walkState.trace[walkState.traceCursor] !== -node.callUID) {
    if (walkState.traceCursor >= walkState.trace.length) {
      throw new Error('trace ended before exiting all entered functions');
    }

    var childCallUid = walkState.trace[walkState.traceCursor];
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
      childNode = new CPUProfileNode(walkState.fileName,
          walkState.functionMap[childCallUid], childCallUid,
          walkState.currentNodeId++);
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
    walkTraceNode(childNode, walkState);

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
