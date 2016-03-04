/* jshint node:true, esnext: true */
'use strict';

module.exports = createProfile;

/**
 * Create a Chrome debugging CPUProfile object from a trace object.
 * https://chromedevtools.github.io/debugger-protocol-viewer/Profiler/#type-CPUProfile
 * @param {!TraceInfo} traceInfo
 * @return {!CPUProfile}
 */
function createProfile(traceInfo) {
  /**
   * Creates an individual Chrome debugging CPUProfileNode.
   * https://chromedevtools.github.io/debugger-protocol-viewer/Profiler/#type-CPUProfileNode
   * @param {string} fileName
   * @param {string} fnName
   * @param {number} callUID
   * @param {number} id
   * @return {!CPUProfileNode}
   */
  function createCPUProfileNode(fileName, fnName, callUID, id) {
    var fnDesc = /^(.+)_(\d+)_(\d+)$/.exec(fnName);

    return {
      functionName: fnDesc[1],
      // TODO(bckenny): assumes a single file
      scriptId: '0',
      url: fileName,
      lineNumber: parseInt(fnDesc[2], 10),
      columnNumber: parseInt(fnDesc[3], 10),
      hitCount: 0,
      callUID: callUID,
      children: [],
      deoptReason: '',
      id: id,
      positionTicks: []
    };
  }

  /**
   * Follows all function entrances and exits in trace from current cursor until
   * current node is exited, recording them as profile samples and adding adding
   * called functions to node's children.
   * @param {!CPUProfileNode} node
   * @param {!Object} walkState
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
        childNode = createCPUProfileNode(walkState.fileName,
            walkState.functionMap[childCallUid], childCallUid,
            walkState.currentNodeId++);
        node.children.push(childNode);
      }

      // Register a sample hit for child entry.
      childNode.hitCount++;
      walkState.profileSamples.push(childNode.id);
      var childEnterμs;
      if (walkState.traceTimestamps) {
        childEnterμs = walkState.traceTimestamps[walkState.traceCursor] * 1000;
      } else {
        childEnterμs = walkState.timestampCounter++ * 1000;
      }
      walkState.profileTimestamps.push(Math.floor(childEnterμs));

      // Enter child in trace.
      walkState.traceCursor++;

      // Walk down children's children's great-great-grandchildren or whatever.
      walkTraceNode(childNode, walkState);

      // If timestamps are available, register a sample hit for child exit and
      // then another for self node back on top.
      // TODO(bckenny): is this necessary? Or does it assume child goes until
      // parent is sampled again?
      if (walkState.traceTimestamps) {
        childNode.hitCount++;
        walkState.profileSamples.push(childNode.id);
        var childExitμs = walkState.traceTimestamps[walkState.traceCursor] * 1000;
        walkState.profileTimestamps.push(Math.floor(childExitμs));

        // Exit child in trace.
        walkState.traceCursor++;

        // Register a sample 1 μs after exit of child for parent node.
        node.hitCount++;
        walkState.profileSamples.push(node.id);
        var selfReentryμs = childExitμs + 1;
        walkState.profileTimestamps.push(Math.floor(selfReentryμs));
      } else {
        // Exit child in trace.
        walkState.traceCursor++;
      }
    }
  }


  // Head uses unique `callUID` greater than all existing unique trace ids.
  var head = createCPUProfileNode('', '(root)_0_0', traceInfo.fns.length, 1);

  var walkState = {
    traceCursor: 0,
    // TODO(bckenny): assumes a single file
    fileName: traceInfo.file,
    trace: traceInfo.t,
    functionMap: traceInfo.fns,
    // Start with `id` 2 since head already uses `id` 1.
    currentNodeId: 2,

    // Used if trace included timestamps.
    traceTimestamps: traceInfo.d ? traceInfo.d: null,

    // Used if no timestamps, using call counts as a replacement.
    timestampCounter: 0,

    profileSamples: [],
    profileTimestamps: []
  };

  walkTraceNode(head, walkState);

  var startTime;
  var endTime;
  if (traceInfo.d) {
    // Use actual timestamps.
    startTime = traceInfo.d[0];
    endTime = traceInfo.d[traceInfo.d.length - 1];
  } else {
    startTime = 0;
    endTime = walkState.timestampCounter;
  }

  // Chrome debugging CPUProfile object
  return {
    head: head,
    // startTime and endTime are in seconds
    startTime: startTime / 1000,
    endTime: endTime / 1000,
    samples: walkState.profileSamples,
    // timestamps are in microseconds
    timestamps: walkState.profileTimestamps
  };
}
