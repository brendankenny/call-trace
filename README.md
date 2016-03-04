# call-trace.js

Instruments a JavaScript file to record its call graph and (optionally) time spent in each function. When the file is run in the browser, a trace can be converted to the Chrome CPU profile format for viewing in DevTools.

_**Super buggy and doesn't work for most fairly normal code. Don't actually use this :)**_

#### Usage:

```
./call-trace.js input.js --time > output.js
```
When the output is loaded and then run, a global variable `_$wɔk` is created containing a trace through the code you just ran.

A CPU profile can be generated from the trace:
```
copy(JSON.stringify(_$wɔk.getReport()))
```
Then save your clipboard contents and load in Chrome DevTools.

![image](https://cloud.githubusercontent.com/assets/39191/13341642/5fa65768-dbef-11e5-8ae9-5d0896e2c895.png)

#### Exploring the data

The global variable `_$wɔk` also has the following properties:
- `file`: the full path of the original source file.
- `fns`: a list of all functions found in the file.
- `t`: a record of the call graph. Positive values represent entering a function (with the value indicating a function in `f`) and negative values represent exiting a function (with the absolute value indexing `f`).
- `d`: a record of timestamps for every entry in `t`. Only created if the `--time` option was specified.
