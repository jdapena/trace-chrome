'use strict';

const chromeRemoteInterface = require('chrome-remote-interface');
const fs = require('node:fs');

const criOptions = {
  'host': 'localhost',
  'port': 9876,
};

exports.setCriOptions = function(host, port) {
  criOptions.host = host || criOptions.host;
  criOptions.port = port || criOptions.port;
};

exports.showCategories = function() {
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
};

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

exports.captureTrace = async function(traceConfig) {
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
      if (traceConfig.dump_memory_at_stop) {
        console.error('Dumping memory at stop');
        dumpMemory(Tracing, traceConfig);
      }
      Tracing.end();
    });
  }).on('error', (err) => console.error(err));
};

