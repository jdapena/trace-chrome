# trace-chrome

Status: maintained, MIT licensed. Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

`trace-chrome` is a NodeJS script for obtaining a running Chrome browser
instance trace.

This is the same kind of traces you obtain using
[chrome://tracing](chrome://tracing)).

## Prepare

Fetch the repository, and on its root run:

	npm install

It should fetch chrome-remote-interface.

## Run

Run chrome with remote debugging port enabled:

	google-chrome --remote-debugging-port=9222

Take into account Chrome only allows local access to the debugging port. Set up
tunnels if needed if you connect to a remote browser.

Then, again on the root of the trace-chrome folder do:

	nodejs bin/trace-chrome.js -H localhost -p 9222 > yourtrace.json

When the tracing session is finished, press ctrl+c, and it will dump the
resulting JSON.

Check parameters allowed with

	nodejs bin/trace-chrome.js --help

## Web UI

Instead of driving capture from the command line, you can run a small local
web UI to configure and control tracing from the browser:

	nodejs bin/trace-chrome.js -p 9222 --ui

The UI listens on `http://127.0.0.1:9223/` by default. Pass `--ui 8080` to
choose a different port, or `--ui-host 0.0.0.0` to bind on all interfaces
(this exposes start/stop control to the network — only use it on trusted
networks).

The page lets you set the Chrome remote-debug host and port (prefilled from
`-H`/`-p` if you passed them), pick categories (with a few presets matching
Chromium's `about://tracing`, plus a "Show available" button that lists
categories from the connected Chrome in two columns), set memory-dump
options, then **Start** and either **Stop & Download** or **Stop, Download
& Open in Perfetto**. The latter saves the trace locally and pushes it
into [ui.perfetto.dev](https://ui.perfetto.dev/) via its `postMessage`
handshake.

Only one trace can be running at a time. Press Ctrl+C to stop the server.

# Examples

## Trace chromium on desktop

If you want to trace chromium on desktop with this tool, first enable remote
debugging port on running it:

	path/to/chromium --remote-debugging-port=9222

Then connect to it in the same machine:

	nodejs bin/trace-chrome.js -p 9222 > yourtrace.json

## Trace chromium on remote device

On running chromium, enable remote debugging port:

	chromium --remote-debugging-port=9876

As Chromium sets as incoming address 127.0.0.1, remote access to the
debugging port is not allowed. So a tunnel is needed to access device
port from host machine. SSH can be used for that:

	ssh root@DEVICE_IP -L 9876:localhost:9876

This will tunnel 9876 port on device to host 9876 port.

Now tracing tool can be used from host:

	nodejs bin/trace-chrome.js -p 9876 > yourtrace.json

