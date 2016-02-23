# call-trace.js

Super buggy and doesn't work for most fairly normal code. Don't actually use this :)

Instruments a JavaScript file to record its call graph and (optionally) time spent in each function.

Usage:
```
./call-trace.js input.js --time > output.js
```

When the output is loaded and then run, a global variable `wɔk` is created with the following properties:
- `file`: the full path of the original source file.
- `fns`: a list of all functions found in the file.
- `t`: a record of the call graph. Positive values represent entering a function (with the value indicating a function in `f`) and negative values represent exiting a function (with the absolute value indexing `f`).
- `d`: a record of timestamps for every entry in `t`. Only created if the `--time` option was specified.
