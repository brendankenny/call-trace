/**
 * @fileoverview Externs for create-profile.js for the Closure Compiler.
 * @externs
 */

/**
 * @const
 */
var module;

module.exports;

/** @typedef {{
  file: string,
  fns: !Array<string>,
  t: !Array<number>,
  d: Array<number>
}} */
var TraceInfo;

/** @typedef {{
  functionName: string, 
  scriptId: string,
  url: string,
  lineNumber: number,
  columnNumber: number,
  hitCount: number,
  callUID: number,
  children: !Array<!CPUProfileNode>,
  deoptReason: string,
  id: number,
  positionTicks: !Array<number>
}} */
var CPUProfileNode;

/** @typedef {{
  head: !CPUProfileNode, 
  startTime: number,
  endTime: number,
  samples: !Array<number>,
  timestamps: !Array<number>
}} */
var CPUProfile;
