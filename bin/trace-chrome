#!/usr/bin/env node

'use strict';

const chromeRemoteInterface = require('chrome-remote-interface');
const {program} = require('commander');
const fs = require('node:fs');

program
    .option('-H, --host <host>', 'Remote debugging protocol host', 'localhost')
    .option('-p, --port <port>', 'Remote debugging protocool port', '9876')
    .option('-s, --showcategories', 'Show categories')
    .option('-O, --output <path>', 'Output file', '')
    .option('-c, --categories <categories>', 'Set categories', '')
    .option('-e, --excludecategories <categories>', 'Exclude categories', '')
    .option('--systrace', 'Enable systrace')
    .option('--memory_dump_mode <mode>', 'Memory dump mode', '')
    .option('--memory_dump_interval <interval_in_ms>',
        'Memory dump interval in ms', 2000)
    .option('--dump_memory_at_stop')
    .parse(process.argv);

const cliOptions = program.opts();

const criOptions = {
  'host': cliOptions.host,
  'port': cliOptions.port,
};

function showCategories() {
  chromeRemoteInterface(criOptions, (client) => {
    const {Tracing} = client;
    Tracing.getCategories((message, result) => {
      result.categories.forEach((category) => {
        console.log(category);
      });
      client.close();
    });
  }).on('error', (err) => {
    console.error(err);
  });
}

function traceConfigFromCliOptions(opts) {
  const result = {
    dump_memory_mode: opts.memory_dump_mode,
    dump_memory_at_stop: opts.dump_memory_at_stop,
    dump_memory_interval: opts.memory_dump_interval,
    output_file: opts.output,
    trace_params: {traceConfig: {}, streamFormat: 'json'},
  };

  if (opts.categories) {
    console.error('Categories: ' + opts.categories);
    result.trace_params.traceConfig['includedCategories'] =
      opts.categories.split(',');
  }
  if (opts.excludecategories) {
    console.error('Excluded categories: ' + opts.excludecategories);
    result.trace_params.traceConfig['excludedCategories'] =
      opts.excludecategories.split(',');
  }
  if (opts.systrace) {
    console.error('Systrace enabled');
    result.trace_params.traceConfig['enableSystrace'] = true;
  }
  if (opts.memory_dump_mode) {
    console.error('Memory dump enabled. Mode ' + opts.memory_dump_mode +
      '. Interval ' + opts.memory_dump_interval + 'ms');
    if (!result.trace_params.traceConfig['includedCategories']) {
      result.trace_params.traceConfig['includedCategories'] = ['*'];
    }
    result.trace_params.traceConfig['includedCategories'].push(
        'disabled-by-default-memory-infra');
  }
  return result;
}

function dumpMemory(tracing, traceConfig) {
  const dumpOptions = {levelOfDetail: traceConfig.dump_memory_mode};
  tracing.requestMemoryDump(dumpOptions)
      .then(
          function(result) {
            console.error(`Memory dump ${result.success ? 'done' : 'failed'}`);
          },
          function() {
            console.error('Memory dump failed');
          });
}

function startMemoryDump(tracing, traceConfig) {
  return setInterval(function() {
    dumpMemory(tracing, traceConfig);
  },
  traceConfig.dump_memory_interval);
}

async function captureTrace(traceConfig) {
  chromeRemoteInterface(criOptions, (client) => {
    const {Tracing} = client;
    const data = {'traceEvents': []};

    let dumpIntervalId;

    client.on('Tracing.dataCollected', (message) => {
      data.trace_events = data.traceEvents =
        data.traceEvents.concat(message.value);
    });

    client.on('Tracing.tracingComplete', (message) => {
      const stringifiedData = JSON.stringify(data);
      if (traceConfig.output_file != '') {
        try {
          fs.writeFileSync(traceConfig.output_file, stringifiedData);
        } catch (err) {
          console.error(err);
        }
      } else {
        console.log(stringifiedData);
      }
      if (message.dataLossOcurred) {
        console.error('Some data has been lost');
      }
      client.close();
    });

    if (traceConfig.dump_memory_mode != '') {
      dumpIntervalId = startMemoryDump(Tracing, traceConfig);
    }

    console.error('Traceconfig is ' + JSON.stringify(traceConfig));
    Tracing.start(traceConfig.trace_params);
    process.on('SIGINT', function() {
      if (dumpIntervalId) {
        clearInterval(dumpIntervalId);
      }
      if (cliOptions.dump_memory_at_stop) {
        console.error('Dumping memory at stop');
        dumpMemory(Tracing, traceConfig);
      }
      Tracing.end();
    });
  }).on('error', (err) => console.error(err));
}

if (cliOptions.showcategories) {
  showCategories();
} else {
  const traceConfig = traceConfigFromCliOptions(cliOptions);
  captureTrace(traceConfig);
}
